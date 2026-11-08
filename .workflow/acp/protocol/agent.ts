/**
 * ACP Service Boundary — translation seam between the ACP protocol (handled
 * by @agentclientprotocol/sdk) and the provider-neutral driver layer.
 *
 * One `session/prompt` turn maps to exactly one `driver.execute(...)`. The
 * boundary sends the agent's text as it arrives (once at the end for a driver
 * that cannot stream), through one per-prompt sink that keeps order, shows every
 * tool call as a card whose title ends with how governance decided it, surfaces
 * governance asks as a detail update on that card sent BEFORE the approval request,
 * answers every tool call the driver reports through governance (an ask goes
 * to the user; anything that goes wrong denies),
 * enforces reject-with-retry concurrency, and maps provider / session-collapse
 * outcomes to distinct, actionable ACP error stops. LLM providers stay
 * ACP-agnostic; they are reached only through the injected driver catalog.
 */
import {
   Driver,
   DriverResult,
   ExecuteOptions,
   ToolCallDecision,
   ToolCallReport,
   declaresToolCallGovernance,
} from '../drivers/governed-driver.js';
import { join } from 'node:path';
import type { DriverCatalog } from '../drivers/driver-catalog.js';
import { GovernanceEngine, askDetails } from '../governance/engine.js';
import { Decision } from '../governance/types.js';
import type { DispatchResolver } from '../modelResolver/resolver.js';
import type { DispatchResult, DispatchSubstitution } from '../modelResolver/types.js';
import { Logger } from '../shared/logger.js';
import { redact } from '../shared/redact.js';
import { AskDetails } from '../shared/types.js';
import type {
   PromptRequest,
   ContentBlock,
   NewSessionRequest,
   RequestPermissionResponse,
   StopReason,
} from '@agentclientprotocol/sdk';
import {
   TurnInProgressError,
   DriverGovernanceUnsupportedError,
   boundaryErrorKind,
} from './errors.js';
import {
   ABNORMAL_END_EVENT, END_LINE, END_STOP_REASON, abnormalEnd,
} from './turn-end.js';
import { AskCard, Cards, Outcome, createCards, ownCard } from './cards.js';
import { UpdateSink, UpdateSlot, createUpdateSink } from './update-sink.js';
import {
   HANDOFF_PATH, MESSAGE_PATH, ProfileNames, detectActivation, readChangeoverTarget,
} from './workflow-command.js';

/**
 * Minimal subset of the SDK's AgentContext the boundary uses to reach the
 * client: streaming notifications and the permission request/response.
 */
export interface ClientContext {
   notify(method: string, params: unknown): Promise<void> | void;
   request(method: string, params: unknown): Promise<unknown> | unknown;
}

import { SessionRecord, SessionStore } from './session-store.js';

export interface AgentDeps {
   catalog:         DriverCatalog;
   resolver:        DispatchResolver;
   sessionStore:    SessionStore;
   logger:          Logger;
   governance:      GovernanceEngine;
   /** The profile names and aliases a prompt may activate. */
   profileNames:    ProfileNames;
   /** Where the changeover files are read from. Default: the working directory of the process. */
   workDir?:        string;
   protocolVersion: number;
}

const SESSION_UPDATE     = 'session/update';
const REQUEST_PERMISSION = 'session/request_permission';

/** How the IDE answered an approval request. `invalid` is anything unrecognized. */
type AskAnswer = 'allow' | 'reject' | 'cancelled' | 'invalid';

/** What governance decided, and the outcome the call's card shows. */
interface Decided { decision: ToolCallDecision; outcome: Outcome }

/** Shown with the details when governance could not evaluate a report. */
const GOVERNANCE_UNAVAILABLE_NOTE = 'governance could not evaluate this action';

/** An `agent_message_chunk` update carrying `text`. */
const textUpdate = (text: string) => ({
   sessionUpdate: 'agent_message_chunk',
   content:       { type: 'text', text },
});

/** Extracts the concatenated text of an ACP prompt content array. */
function promptText(params: PromptRequest): string {
   if (!Array.isArray(params.prompt)) { return ''; }
   return params.prompt
      .filter((block: ContentBlock): block is Extract<ContentBlock, { type: 'text' }> =>
         'text' === block.type)
      .map(block => block.text)
      .join('\n')
      .trim();
}

/** The one chat line that says a profile did not get what it asked for. */
function substitutionLine(profile: string, used: DispatchResult, substitution: DispatchSubstitution): string
{
   const { asked, reason } = substitution;
   const askedDriver = undefined === asked.driver ? '' : `driver "${asked.driver}", `;
   return `Profile "${profile}" asks for ${askedDriver}model "${asked.model}"; ` +
      `using driver "${used.driver}", model "${used.model}" (${reason}).`;
}

export function createAgent(deps: AgentDeps) {
   const { catalog, resolver, sessionStore, logger, governance, profileNames, protocolVersion } = deps;
   const workDir = deps.workDir ?? process.cwd();
   let sessionSeq = 0;
   let callSeq    = 0;
   let turnSeq    = 0;
   let initialized = false;

   function newSessionId(): string {
      return `acp-sess-${++sessionSeq}`;
   }

   /**
    * Keeps the driver's session id for the IDE session. A new or changed id is
    * logged once, as the join between the two ids.
    */
   function linkDriverSession(record: SessionRecord, sessionId: string, driverSessionId: string): void {
      const changed = driverSessionId !== record.driverSessionId;
      record.driverSessionId = driverSessionId;
      if (changed && '' !== driverSessionId) {
         logger.info('agent_session_linked', { sessionId, agentSessionId: driverSessionId });
      }
   }

   /** Ends the process behind the record's driver session. A failure is logged by kind only. */
   async function releaseDriverSession(record: SessionRecord): Promise<void> {
      const id = record.driverSessionId;
      if (undefined === id || '' === id) { return; }
      try { await catalog.get(record.driver as string).release(id); }
      catch (err) {
         logger.warn('release_failed', {
            sessionId: record.sessionId, failureKind: boundaryErrorKind(err) ?? 'internal',
         });
      }
   }

   /**
    * Applies the profile a command activates: the driver and model it resolves to. The profile
    * is the name typed after `as` (or a shortcut's), or, for `@start` and `@receive`, the one
    * the changeover file names, read now and never cached. A different driver releases the old
    * session first and starts a new one. A resolution that throws leaves the record as it was.
    * Does not touch the active-turn flag.
    */
   async function applyActivation(record: SessionRecord, command: string): Promise<void> {
      const activation = detectActivation(command);
      if (undefined === activation) { return; }

      // The path never comes from the command text.
      const changeover = 'changeover' === activation.kind;
      const file       = 'start' === activation.command ? HANDOFF_PATH : MESSAGE_PATH;
      const name       = changeover ? readChangeoverTarget(join(workDir, file)) : activation.name;
      const profile    = undefined === name ? undefined : profileNames.resolve(name);
      if (undefined === profile) {
         // The word is free text from the user: redacted, then capped.
         logger.info('profile_unknown', {
            sessionId: record.sessionId,
            source:    changeover ? 'changeover' : 'prompt',
            reason:    undefined === name ? 'no target' : 'unknown name',
            ...(undefined === name ? {} : { word: redact(name).slice(0, 64) }),
         });
         return;
      }

      const result = resolver.resolve(profile);
      const { driver, model, substitution } = result;
      if (driver !== record.driver) {
         await releaseDriverSession(record);
         record.driverSessionId = undefined;
      }
      const previous = record.profile;
      record.driver  = driver;
      record.model   = model;
      record.profile = profile;
      // Set at every resolution. A profile that got what it asked for has no notice; one with
      // no entry gets the catalog notice again.
      if (undefined !== substitution) { record.notice = substitutionLine(profile, result, substitution); }
      else { record.notice = 'registry-default' === result.source ? catalog.notice : undefined; }

      // Logged only now, after the activation was applied.
      const fields = { sessionId: record.sessionId, profile };
      if (changeover) { logger.info('profile_activated', { ...fields, source: 'changeover' }); }
      else if (undefined !== previous) {
         logger.warn('profile_reactivated', { ...fields, previous });
         if (previous !== profile) { logger.warn('profile_switched', { ...fields, previous }); }
      }
   }

   function requireInitialized(): void {
      // The stable ACP SDK does not police initialize-ordering, so the
      // boundary rejects requests that arrive before `initialize`. Throwing
      // inside a handler becomes a JSON-RPC error response, not a crash.
      if (!initialized) {
         throw new Error('received request before initialize');
      }
   }

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

   /**
    * One turn: the notice, one `execute`, and the text the driver did not stream. Everything
    * it sends goes through the prompt's sink. Returns the ACP stop reason.
    */
   async function runTurn(turn: {
      sessionId: string; record: SessionRecord; driver: Driver; command: string;
      signal: AbortSignal; sink: UpdateSink; cx: ClientContext;
   }): Promise<{ stopReason: StopReason }> {
      const { sessionId, record, driver, command, signal, sink, cx } = turn;
      // Card state lives for this turn only.
      const cards = createCards(++turnSeq);
      // Until a turn of this session ends normally, its turns lead with the notice.
      if (undefined !== record.notice) { void sink.send(textUpdate(record.notice)); }

      let sawText = false;
      const options: ExecuteOptions = {
         signal,
         model:      record.model,
         onToolCall: report => handleToolCall(sessionId, report, cx, signal, sink, cards),
         onUpdate:   update => {
            if ('text' !== update.type) { void sink.send(cards.render(update)); return; }
            sawText = true;
            void sink.send(textUpdate(update.text));
         },
      };
      if (record.driverSessionId) { options.sessionId = record.driverSessionId; }

      // A driver that did not stream sends its text now, once; streamed text is never repeated.
      const sendUnstreamed = (text: string) => {
         if (!sawText && '' !== text) { void sink.send(textUpdate(text)); }
      };

      let result: DriverResult;
      try { result = await driver.execute(command, options); }
      catch (err) {
         if (!signal.aborted) { throw err; }
         // A failure after a cancel is part of the cancel: log the kind only.
         logger.info('turn_cancelled', {
            sessionId, failureKind: boundaryErrorKind(err) ?? 'internal',
         });
         return { stopReason: 'cancelled' as const };
      }

      // An abnormal end is logged whether or not the turn was cancelled; a cancel wins.
      const abnormal = abnormalEnd(result.end);
      if (undefined !== abnormal) { logger.info(ABNORMAL_END_EVENT, { sessionId, end: abnormal }); }

      if (result.cancelled || signal.aborted) {
         if ('' !== result.sessionId) { linkDriverSession(record, sessionId, result.sessionId); }
         sendUnstreamed(result.text);
         logger.info('turn_cancelled', { sessionId });
         return { stopReason: 'cancelled' as const };
      }

      linkDriverSession(record, sessionId, result.sessionId);
      sendUnstreamed(result.text);
      // The line follows the turn's text. An abnormal end is not a normal end: the notice stays.
      if (undefined !== abnormal) {
         void sink.send(textUpdate(END_LINE[abnormal]));
         return { stopReason: END_STOP_REASON[abnormal] };
      }
      record.notice = undefined;
      return { stopReason: 'end_turn' as const };
   }

   return {
      async initialize(_params: { protocolVersion: number }) {
         initialized = true;
         logger.info('connect', {});
         return {
            protocolVersion,
            agentCapabilities: { loadSession: true },
         };
      },

      async newSession(_params: NewSessionRequest) {
         requireInitialized();
         // Resolved first: if this throws, no session id is used and no record exists.
         const { driver, model } = resolver.resolve();
         const sessionId = newSessionId();
         const record    = sessionStore.create(sessionId);
         record.driver   = driver;
         record.model    = model;
         record.notice   = catalog.notice;
         logger.info('session_mapped', {
            sessionId,
            workflowId: record.workflowId,
         });
         return { sessionId };
      },

      async loadSession(params: { sessionId: string; workflowId: string }) {
         const { driver, model } = resolver.resolve();
         const record = sessionStore.load(params.sessionId, params.workflowId);
         record.driver = driver;
         record.model  = model;
         record.notice = catalog.notice;
         logger.info('session_mapped', {
            sessionId:  record.sessionId,
            workflowId: record.workflowId,
            resumed:    true,
         });
         return {};
      },

      async prompt(params: PromptRequest, cx: ClientContext) {
         requireInitialized();
         const record = sessionStore.get(params.sessionId);
         if (!record) {
            throw new Error(`unknown session: ${params.sessionId}`);
         }

         if (sessionStore.hasActiveTurn(params.sessionId)) {
            logger.info('turn_in_progress', { sessionId: params.sessionId });
            throw new TurnInProgressError(params.sessionId);
         }

         const command = promptText(params);
         if ('' === command) {
            throw new Error('prompt must contain non-empty text content');
         }

         const controller = new AbortController();
         const { signal } = controller;
         sessionStore.setActiveTurn(params.sessionId, true, controller);
         let sink: UpdateSink | undefined;
         try {
            // The active-turn flag holds the profile, the release and the turn as one step.
            await applyActivation(record, command);
            const driver = catalog.get(record.driver as string);
            if (!declaresToolCallGovernance(driver)) {
               logger.error('driver_governance_unsupported', {
                  sessionId: params.sessionId,
                  driver:    driver.name ?? 'unnamed',
               });
               throw new DriverGovernanceUnsupportedError(driver.name);
            }
            sink = createUpdateSink({
               deliver:   update => cx.notify(SESSION_UPDATE, { sessionId: params.sessionId, update }),
               logger,
               sessionId: params.sessionId,
            });
            const response = await runTurn({
               sessionId: params.sessionId, record, driver, command, signal, sink, cx,
            });
            // The prompt resolves only after every update was delivered.
            await sink.flush();
            return response;
         }
         catch (err) {
            // Nothing was sent before the turn: a rejection before it is just the error.
            if (undefined === sink) { throw err; }
            // What the turn produced reaches the IDE before the failure does.
            await sink.flush();
            // The ACP `PromptResponse.stopReason` enum has no `error` value, so
            // provider quota/auth, session collapse, and generic mid-turn
            // failures are surfaced as JSON-RPC errors: the SDK converts a
            // thrown error into an error response the client sees, without
            // crashing the server. The distinct `kind` (carried on the error)
            // keeps quota/auth/collapse actionable and resumable.
            const kind = boundaryErrorKind(err);
            logger.error('prompt_failed', {
               sessionId: params.sessionId,
               kind:      kind ?? 'internal',
            });
            throw err;
         }
         finally {
            sink?.close();
            sessionStore.setActiveTurn(params.sessionId, false);
         }
      },

      async cancel(params: { sessionId: string }) {
         // session/cancel is the only interrupt. It aborts the turn but does
         // not free the session: prompt's finally does, once the driver has
         // settled. No active turn, an unknown session, or a second cancel
         // is a no-op.
         if (sessionStore.abortTurn(params.sessionId)) {
            logger.info('cancel_requested', { sessionId: params.sessionId });
         }
      },

      ask,
      applyActivation,

      /**
       * Abort every turn, close every driver in the catalog, then release all
       * session mappings on disconnect / stdin EOF (no leaks). When the drivers
       * could not all be closed, everything else is still done and the first
       * close error is thrown last.
       */
      async onDisconnect() {
         sessionStore.abortAllTurns();
         let failure: { error: unknown } | undefined;
         try { await catalog.closeAll(); }
         catch (err) {
            logger.warn('close_failed', { failureKind: boundaryErrorKind(err) ?? 'internal' });
            failure = { error: err };
         }
         sessionStore.closeAll();
         logger.info('disconnect', {});
         if (undefined !== failure) { throw failure.error; }
      },
   };
}
