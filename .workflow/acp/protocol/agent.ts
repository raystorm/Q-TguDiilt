/**
 * ACP Service Boundary — translation seam between the ACP protocol (handled
 * by @agentclientprotocol/sdk) and the provider-neutral driver layer.
 *
 * One `session/prompt` turn maps to exactly one `driver.execute(...)`. The
 * boundary streams a `session/update` before the final response, surfaces
 * governance asks as a detail update sent BEFORE the approval request,
 * enforces reject-with-retry concurrency, and maps provider / session-collapse
 * outcomes to distinct, actionable ACP error stops. LLM providers stay
 * ACP-agnostic; they are reached only through the injected driver.
 */
import { ExecuteOptions } from '../drivers/driver.js';
import { DriverResult } from '../drivers/kiro-driver.js';
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
   boundaryErrorKind,
} from './errors.js';

/** The driver seam. Structurally matches `createKiroDriver(...)`'s result. */
export interface Driver {
   execute(command: string, options?: ExecuteOptions): DriverResult;
}

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
   protocolVersion: number;
}

const SESSION_UPDATE     = 'session/update';
const REQUEST_PERMISSION = 'session/request_permission';

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
   const { driver, sessionStore, logger, protocolVersion } = deps;
   let sessionSeq = 0;
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

         sessionStore.setActiveTurn(params.sessionId, true);
         try {
            // Stream at least one update before the final response.
            await cx.notify(SESSION_UPDATE, {
               sessionId: params.sessionId,
               update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: { type: 'text', text: 'Working on it...' },
               },
            });

            const options: ExecuteOptions = {};
            if (record.driverSessionId) { options.sessionId = record.driverSessionId; }

            const result = driver.execute(command, options);
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
         // session/cancel is the only interrupt: free the session. Cancelling
         // with no active turn is an idempotent no-op.
         sessionStore.setActiveTurn(params.sessionId, false);
      },

      /**
       * Ask: emit a detail `session/update` carrying the full
       * specifics (command, paths, diff, params) BEFORE the approval request,
       * correlated by ACP session id. Returns `{ approved }`. Denial or
       * cancellation fail safe as not-approved and leave the session usable.
       */
      async ask(
         target: { sessionId: string },
         specifics: AskDetails,
         cx: ClientContext,
      ): Promise<{ approved: boolean }> {
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

         const outcome  = response?.outcome;
         const approved = 'selected' === outcome?.outcome && 'allow' === outcome.optionId;
         return { approved };
      },

      /** Release all session mappings on disconnect / stdin EOF (no leaks). */
      onDisconnect() {
         sessionStore.closeAll();
         logger.info('disconnect', {});
      },
   };
}
