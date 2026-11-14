/**
 * The tool calls of a turn. Governance decides each call a driver reports: approve and deny map
 * straight through, and an ask goes to the user as a detail update followed by a permission
 * request. Anything that goes wrong denies. The service never answers an ask itself.
 */
import { ToolCallDecision, ToolCallReport } from '../../drivers/governed-driver.js';
import { GovernanceEngine, askDetails } from '../../governance/engine.js';
import { Decision } from '../../governance/types.js';
import { Logger } from '../../shared/logger.js';
import { AskDetails } from '../../shared/types.js';
import type { RequestPermissionResponse } from '@agentclientprotocol/sdk';
import { AskCard, Cards, Outcome, ownCard } from '../cards.js';
import type { UpdateSink, UpdateSlot } from '../update-sink.js';
import type { ClientContext } from './index.js';

export const SESSION_UPDATE = 'session/update';
const REQUEST_PERMISSION = 'session/request_permission';

/** How the IDE answered an approval request. `invalid` is anything unrecognized. */
export type AskAnswer = 'allow' | 'reject' | 'cancelled' | 'invalid';

/** What governance decided, and the outcome the call's card shows. */
interface Decided { decision: ToolCallDecision; outcome: Outcome }

/** Shown with the details when governance could not evaluate a report. */
const GOVERNANCE_UNAVAILABLE_NOTE = 'governance could not evaluate this action';

/** What the boundary needs to decide the tool calls of its turns. The counter of calls lives here. */
export function createToolCalls({ governance, logger }: { governance: GovernanceEngine; logger: Logger }) {
   let callSeq = 0;

   /**
    * Ask: emit the detail `session/update` (the specifics: command, paths, diff, params, on
    * the call's card) BEFORE the approval request, which names that card and is correlated
    * by ACP session id. Returns `{ approved, answer }`. Anything
    * but an explicit allow is not approved; an unrecognized answer is
    * reported as `invalid` so the caller can tell it from a user's rejection.
    * Denial or cancellation leave the session usable.
    */
   async function askVia(
      target: { sessionId: string },
      card: AskCard,
      cx: ClientContext,
      sendDetail: (update: unknown) => Promise<boolean>,
      issued: () => void,
   ): Promise<{ approved: boolean; answer: AskAnswer }> {
      const sent = await sendDetail(card.update);
      if (!sent) { throw new Error('the ask detail was not delivered'); }

      const pending = cx.request(REQUEST_PERMISSION, {
         sessionId: target.sessionId,
         ...(undefined !== card.toolCallId ? { toolCall: { toolCallId: card.toolCallId } } : {}),
         options: [
            { kind: 'allow_once',  name: 'Allow',  optionId: 'allow'  },
            { kind: 'reject_once', name: 'Reject', optionId: 'reject' },
         ],
      });
      issued();
      const response = await pending as RequestPermissionResponse;

      const outcome = response?.outcome;
      if ('selected' === outcome?.outcome) {
         if ('allow'  === outcome.optionId) { return { approved: true,  answer: 'allow'  }; }
         if ('reject' === outcome.optionId) { return { approved: false, answer: 'reject' }; }
      }
      else if ('cancelled' === outcome?.outcome) { return { approved: false, answer: 'cancelled' }; }
      return { approved: false, answer: 'invalid' };
   }

   /** The ask with its detail sent straight to the client, outside any turn's sink. */
   async function ask(
      target: { sessionId: string },
      specifics: AskDetails,
      cx: ClientContext,
   ): Promise<{ approved: boolean; answer: AskAnswer }> {
      return askVia(target, { update: ownCard(specifics) }, cx, async update => {
         await cx.notify(SESSION_UPDATE, { sessionId: target.sessionId, update });
         return true;
      }, () => undefined);
   }

   /**
    * Asks the user about one tool call and logs how it ended. A throw (the
    * detail update or the request failed) or an unrecognized answer denies,
    * logged; the IDE's error text is never logged.
    */
   async function askForApproval(
      context: { sessionId: string; callId: number },
      card: AskCard,
      cx: ClientContext,
      signal: AbortSignal,
      slot: UpdateSlot,
   ): Promise<Decided> {
      // Anything that ends an open ask after the abort is part of the cancel.
      const denyCancelled = (answeredBy: string, cause?: string): Decided => {
         const outcome: Record<string, unknown> = { ...context, action: 'deny', answeredBy, reason: 'cancelled' };
         if (undefined !== cause) { outcome.cause = cause; }
         logger.info('governance_outcome', outcome);
         return { decision: 'deny', outcome: 'cancelled' };
      };
      let result: { approved: boolean; answer: AskAnswer };
      try {
         result = await askVia(
            { sessionId: context.sessionId }, card, cx,
            update => slot.send(update), () => slot.release(),
         );
      }
      catch {
         if (signal.aborted) { return denyCancelled('cancel', 'ask_failed'); }
         logger.warn('governance_outcome', {
            ...context, action: 'deny', answeredBy: 'failure', reason: 'ask_failed',
         });
         return { decision: 'deny', outcome: 'errored' };
      }

      if ('invalid' === result.answer) {
         if (signal.aborted) { return denyCancelled('cancel', 'invalid_answer'); }
         logger.warn('governance_outcome', {
            ...context, action: 'deny', answeredBy: 'failure', reason: 'invalid_answer',
         });
         return { decision: 'deny', outcome: 'errored' };
      }

      // A late answer, Allow included, never becomes an approve.
      if (signal.aborted) { return denyCancelled('user'); }

      const outcome: Record<string, unknown> = {
         ...context, action: result.approved ? 'approve' : 'deny', answeredBy: 'user',
      };
      if ('cancelled' === result.answer) { outcome.reason = 'cancelled'; }
      logger.info('governance_outcome', outcome);
      if ('cancelled' === result.answer) { return { decision: 'deny', outcome: 'cancelled' }; }
      return result.approved
         ? { decision: 'approve', outcome: 'allowed' }
         : { decision: 'deny',    outcome: 'rejected' };
   }

   /**
    * Decides one tool call a driver reports, and says how its card shows it. Governance
    * decides: approve and deny map straight through; an ask goes to the user. If governance
    * itself fails the failure is logged and the call falls back to an ask
    * (noting that governance could not evaluate it). Built per turn over that
    * turn's session and context, so concurrent reports share no state.
    */
   async function decideToolCall(
      sessionId: string,
      report: ToolCallReport,
      cx: ClientContext,
      signal: AbortSignal,
      slot: UpdateSlot,
      cards: Cards,
   ): Promise<Decided> {
      const context = { sessionId, callId: ++callSeq };

      // After the abort: no evaluation, no detail update, no approval request.
      if (signal.aborted) {
         logger.info('governance_outcome', {
            ...context, action: 'deny', answeredBy: 'cancel', reason: 'cancelled',
         });
         return { decision: 'deny', outcome: 'cancelled' };
      }

      let decision: Decision;
      let note: string | undefined;
      try { decision = governance.evaluateToolCall(report, context); }
      catch {
         logger.warn('governance_decision', {
            ...context, kind: report.kind, action: 'ask', reason: 'evaluation_error',
         });
         decision = { action: 'ask', details: { ...askDetails(report), command: report.command } };
         note     = GOVERNANCE_UNAVAILABLE_NOTE;
      }

      if ('approve' === decision.action) { return { decision: 'approve', outcome: 'approved' }; }
      if ('deny'    === decision.action) { return { decision: 'deny',    outcome: 'denied'   }; }

      // The title is agent-supplied display text: shown, labelled, never a command.
      const specifics: AskDetails = { ...decision.details, kind: report.kind, agentTitle: report.title };
      if (undefined !== note) { specifics.note = note; }
      return askForApproval(context, cards.askCard(report.id, specifics), cx, signal, slot);
   }

   /**
    * Takes the call's place in the sink's order at once, so agent updates that arrive while
    * governance and the user decide leave after the ask detail and its request. A call whose
    * card was never sent announces it first. When the call is decided its card gets the
    * outcome. A call that needs no ask releases the place as it returns.
    */
   async function handleToolCall(
      sessionId: string,
      report: ToolCallReport,
      cx: ClientContext,
      signal: AbortSignal,
      sink: UpdateSink,
      cards: Cards,
   ): Promise<ToolCallDecision> {
      const slot = sink.reserve();
      try {
         const { id } = report;
         if (undefined !== id) {
            const card = cards.announce(id, report);
            if (undefined !== card) { void slot.send(card); }
         }
         const { decision, outcome } = await decideToolCall(
            sessionId, report, cx, signal, slot, cards,
         );
         // Updates that arrived while the call was decided are already queued; the outcome follows.
         slot.release();
         if (undefined !== id) { void sink.send(cards.outcome(id, outcome)); }
         return decision;
      }
      finally { slot.release(); }
   }

   /** The answer to a tool call a driver reports after its turn ended: deny, logged, never evaluated. */
   function denyAfterTurn(sessionId: string): Promise<ToolCallDecision> {
      logger.info('governance_outcome', {
         sessionId, callId: ++callSeq, action: 'deny', answeredBy: 'failure', reason: 'turn_ended',
      });
      return Promise.resolve('deny');
   }

   return { ask, handleToolCall, denyAfterTurn };
}

export type ToolCalls = ReturnType<typeof createToolCalls>;
