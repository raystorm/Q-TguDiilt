/**
 * ACP Service Boundary — translation seam between the ACP protocol (handled
 * by @agentclientprotocol/sdk) and the provider-neutral driver layer.
 *
 * One `session/prompt` turn maps to exactly one `driver.execute(...)`. The
 * boundary streams a `session/update` before the final response, surfaces
 * governance asks as a detail update sent BEFORE the approval request,
 * answers every tool call the driver reports through governance (an ask goes
 * to the user; anything that goes wrong denies),
 * enforces reject-with-retry concurrency, and maps provider / session-collapse
 * outcomes to distinct, actionable ACP error stops. LLM providers stay
 * ACP-agnostic; they are reached only through the injected driver.
 */
import {
   Driver,
   DriverResult,
   ExecuteOptions,
   ToolCallDecision,
   ToolCallReport,
   declaresToolCallGovernance,
} from '../drivers/governed-driver.js';
import { GovernanceEngine, askDetails } from '../governance/engine.js';
import { Decision } from '../governance/types.js';
import { Logger } from '../shared/logger.js';
import { AskDetails } from '../shared/types.js';
import type {
   PromptRequest,
   ContentBlock,
   NewSessionRequest,
   RequestPermissionResponse,
} from '@agentclientprotocol/sdk';
import {
   TurnInProgressError,
   DriverGovernanceUnsupportedError,
   boundaryErrorKind,
} from './errors.js';

/**
 * Minimal subset of the SDK's AgentContext the boundary uses to reach the
 * client: streaming notifications and the permission request/response.
 */
export interface ClientContext {
   notify(method: string, params: unknown): Promise<void> | void;
   request(method: string, params: unknown): Promise<unknown> | unknown;
}

import { SessionStore } from './session-store.js';

export interface AgentDeps {
   driver:          Driver;
   sessionStore:    SessionStore;
   logger:          Logger;
   governance:      GovernanceEngine;
   protocolVersion: number;
}

const SESSION_UPDATE     = 'session/update';
const REQUEST_PERMISSION = 'session/request_permission';

/** How the IDE answered an approval request. `invalid` is anything unrecognized. */
type AskAnswer = 'allow' | 'reject' | 'cancelled' | 'invalid';

/** Shown with the details when governance could not evaluate a report. */
const GOVERNANCE_UNAVAILABLE_NOTE = 'governance could not evaluate this action';

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

export function createAgent(deps: AgentDeps) {
   const { driver, sessionStore, logger, governance, protocolVersion } = deps;
   let sessionSeq = 0;
   let callSeq    = 0;
   let initialized = false;

   function newSessionId(): string {
      return `acp-sess-${++sessionSeq}`;
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
    * Ask: emit a detail `session/update` carrying the full
    * specifics (command, paths, diff, params) BEFORE the approval request,
    * correlated by ACP session id. Returns `{ approved, answer }`. Anything
    * but an explicit allow is not approved; an unrecognized answer is
    * reported as `invalid` so the caller can tell it from a user's rejection.
    * Denial or cancellation leave the session usable.
    */
   async function ask(
      target: { sessionId: string },
      specifics: AskDetails,
      cx: ClientContext,
   ): Promise<{ approved: boolean; answer: AskAnswer }> {
      await cx.notify(SESSION_UPDATE, {
         sessionId: target.sessionId,
         update: {
            sessionUpdate: 'tool_call',
            status:        'pending',
            title:         specifics.command ?? 'Requested action',
            rawInput:      specifics,
         },
      });

      const response = await cx.request(REQUEST_PERMISSION, {
         sessionId: target.sessionId,
         options: [
            { kind: 'allow_once',  name: 'Allow',  optionId: 'allow'  },
            { kind: 'reject_once', name: 'Reject', optionId: 'reject' },
         ],
      }) as RequestPermissionResponse;

      const outcome = response?.outcome;
      if ('selected' === outcome?.outcome) {
         if ('allow'  === outcome.optionId) { return { approved: true,  answer: 'allow'  }; }
         if ('reject' === outcome.optionId) { return { approved: false, answer: 'reject' }; }
      }
      else if ('cancelled' === outcome?.outcome) { return { approved: false, answer: 'cancelled' }; }
      return { approved: false, answer: 'invalid' };
   }

   /**
    * Asks the user about one tool call and logs how it ended. A throw (the
    * detail update or the request failed) or an unrecognized answer denies,
    * logged; the IDE's error text is never logged.
    */
   async function askForApproval(
      context: { sessionId: string; callId: number },
      specifics: AskDetails,
      cx: ClientContext,
      signal: AbortSignal,
   ): Promise<ToolCallDecision> {
      // Anything that ends an open ask after the abort is part of the cancel.
      const denyCancelled = (answeredBy: string, cause?: string): ToolCallDecision => {
         const outcome: Record<string, unknown> = { ...context, action: 'deny', answeredBy, reason: 'cancelled' };
         if (undefined !== cause) { outcome.cause = cause; }
         logger.info('governance_outcome', outcome);
         return 'deny';
      };
      let result: { approved: boolean; answer: AskAnswer };
      try { result = await ask({ sessionId: context.sessionId }, specifics, cx); }
      catch {
         if (signal.aborted) { return denyCancelled('cancel', 'ask_failed'); }
         logger.warn('governance_outcome', {
            ...context, action: 'deny', answeredBy: 'failure', reason: 'ask_failed',
         });
         return 'deny';
      }

      if ('invalid' === result.answer) {
         if (signal.aborted) { return denyCancelled('cancel', 'invalid_answer'); }
         logger.warn('governance_outcome', {
            ...context, action: 'deny', answeredBy: 'failure', reason: 'invalid_answer',
         });
         return 'deny';
      }

      // A late answer, Allow included, never becomes an approve.
      if (signal.aborted) { return denyCancelled('user'); }

      const outcome: Record<string, unknown> = {
         ...context, action: result.approved ? 'approve' : 'deny', answeredBy: 'user',
      };
      if ('cancelled' === result.answer) { outcome.reason = 'cancelled'; }
      logger.info('governance_outcome', outcome);
      return result.approved ? 'approve' : 'deny';
   }

   /**
    * Answers one tool call a driver reports. Governance decides: approve and
    * deny map straight through; an ask goes to the user. If governance
    * itself fails the failure is logged and the call falls back to an ask
    * (noting that governance could not evaluate it). Built per turn over that
    * turn's session and context, so concurrent reports share no state.
    */
   async function handleToolCall(
      sessionId: string,
      report: ToolCallReport,
      cx: ClientContext,
      signal: AbortSignal,
   ): Promise<ToolCallDecision> {
      const context = { sessionId, callId: ++callSeq };

      // After the abort: no evaluation, no detail update, no approval request.
      if (signal.aborted) {
         logger.info('governance_outcome', {
            ...context, action: 'deny', answeredBy: 'cancel', reason: 'cancelled',
         });
         return 'deny';
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

      if ('approve' === decision.action) { return 'approve'; }
      if ('deny'    === decision.action) { return 'deny'; }

      // The title is agent-supplied display text: shown, labelled, never a command.
      const specifics: AskDetails = { ...decision.details, kind: report.kind, agentTitle: report.title };
      if (undefined !== note) { specifics.note = note; }
      return askForApproval(context, specifics, cx, signal);
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
         const sessionId = newSessionId();
         const record    = sessionStore.create(sessionId);
         logger.info('session_mapped', {
            sessionId,
            workflowId: record.workflowId,
         });
         return { sessionId };
      },

      async loadSession(params: { sessionId: string; workflowId: string }) {
         const record = sessionStore.load(params.sessionId, params.workflowId);
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

         if (!declaresToolCallGovernance(driver)) {
            logger.error('driver_governance_unsupported', {
               sessionId: params.sessionId,
               driver:    driver.name ?? 'unnamed',
            });
            throw new DriverGovernanceUnsupportedError(driver.name);
         }

         const controller = new AbortController();
         const { signal } = controller;
         sessionStore.setActiveTurn(params.sessionId, true, controller);
         try {
            // Stream at least one update before the final response.
            await cx.notify(SESSION_UPDATE, {
               sessionId: params.sessionId,
               update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: { type: 'text', text: 'Working on it...' },
               },
            });

            const options: ExecuteOptions = {
               signal,
               onToolCall: report => handleToolCall(params.sessionId, report, cx, signal),
            };
            if (record.driverSessionId) { options.sessionId = record.driverSessionId; }

            let result: DriverResult;
            try { result = await driver.execute(command, options); }
            catch (err) {
               if (!signal.aborted) { throw err; }
               // A failure after a cancel is part of the cancel: log the kind only.
               logger.info('turn_cancelled', {
                  sessionId:   params.sessionId,
                  failureKind: boundaryErrorKind(err) ?? 'internal',
               });
               return { stopReason: 'cancelled' as const };
            }

            if (result.cancelled || signal.aborted) {
               if ('' !== result.sessionId) { record.driverSessionId = result.sessionId; }
               if ('' !== result.text) {
                  await cx.notify(SESSION_UPDATE, {
                     sessionId: params.sessionId,
                     update: {
                        sessionUpdate: 'agent_message_chunk',
                        content: { type: 'text', text: result.text },
                     },
                  });
               }
               logger.info('turn_cancelled', { sessionId: params.sessionId });
               return { stopReason: 'cancelled' as const };
            }

            record.driverSessionId = result.sessionId;

            await cx.notify(SESSION_UPDATE, {
               sessionId: params.sessionId,
               update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: { type: 'text', text: result.text },
               },
            });

            return { stopReason: 'end_turn' as const };
         }
         catch (err) {
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

      /**
       * Abort every turn, release the downstream agent, then release all
       * session mappings on disconnect / stdin EOF (no leaks). Never rejects.
       * Without a driver `close` it completes synchronously.
       */
      async onDisconnect() {
         sessionStore.abortAllTurns();
         if (undefined !== driver.close) {
            try { await driver.close(); }
            catch (err) {
               logger.warn('close_failed', { failureKind: boundaryErrorKind(err) ?? 'internal' });
            }
         }
         sessionStore.closeAll();
         logger.info('disconnect', {});
      },
   };
}
