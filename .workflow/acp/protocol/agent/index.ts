/**
 * ACP Service Boundary — translation seam between the ACP protocol (handled
 * by @agentclientprotocol/sdk) and the provider-neutral driver layer.
 *
 * One `session/prompt` runs one turn, a `driver.execute(...)`, and then the automated changeover process: it
 * carries a workflow from one profile to the next with further turns. The
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
import { join } from 'node:path';
import type { DriverCatalog } from '../../drivers/driver-catalog.js';
import { GovernanceEngine } from '../../governance/engine.js';
import type { DispatchResolver } from '../../modelResolver/resolver.js';
import { Logger } from '../../shared/logger.js';
import { redact } from '../../shared/redact.js';
import type { PromptRequest, ContentBlock, NewSessionRequest } from '@agentclientprotocol/sdk';
import { TurnInProgressError, boundaryErrorKind } from '../errors.js';
import { UpdateSink, createUpdateSink } from '../update-sink.js';
import { LoopState, paragraph, stopLine } from './loop-stops.js';
import { SESSION_UPDATE, createToolCalls } from './tool-calls.js';
import { textUpdate, createTurnRunner } from './turn.js';
import { createActivation } from './activation.js';
import { createSideTrip } from './side-trip.js';
import { createLoop } from './loop.js';
import { ProfileNames, detectHandoff, detectSend } from '../workflow-command.js';

/**
 * Minimal subset of the SDK's AgentContext the boundary uses to reach the
 * client: streaming notifications and the permission request/response.
 */
export interface ClientContext {
   notify(method: string, params: unknown): Promise<void> | void;
   request(method: string, params: unknown): Promise<unknown> | unknown;
}

import { SessionStore } from '../session-store.js';

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
   const { catalog, resolver, sessionStore, logger, governance, profileNames, protocolVersion } = deps;
   const workDir = deps.workDir ?? process.cwd();
   let sessionSeq = 0;
   let initialized = false;
   const { ask, handleToolCall, denyAfterTurn } = createToolCalls({ governance, logger });
   const runTurn = createTurnRunner({ logger, handleToolCall, denyAfterTurn });
   const { applyActivation, governedDriver, releaseDriverSession } = createActivation({
      catalog, resolver, logger, profileNames, workDir,
   });
   const sideTrip = createSideTrip({ releaseDriverSession });
   const runLoop = createLoop({
      logger, profileNames, workDir, runTurn, applyActivation, governedDriver, sideTrip,
   });

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
         // A typed handoff or send counts as a command the loop moved on.
         const state: LoopState = {
            moved: detectHandoff(command) || detectSend(command), deliveryFailed: false, profileHop: 0,
            stop: 'failed',
         };
         let sink: UpdateSink | undefined;
         try {
            // A typed handoff is checked against the time the prompt began.
            const startedAt = Date.now();
            // The active-turn flag holds the profile, the release and the turn as one step.
            await applyActivation(record, command);
            const driver = governedDriver(params.sessionId, record);
            sink = createUpdateSink({
               deliver:   async update => {
                  try { await cx.notify(SESSION_UPDATE, { sessionId: params.sessionId, update }); }
                  catch (err) { state.deliveryFailed = true; throw err; }
               },
               logger,
               sessionId: params.sessionId,
            });
            const response = await runLoop({
               sessionId: params.sessionId, record, driver, command, startedAt, signal, sink, cx, state,
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
            const line = stopLine('failed', undefined, state.moved);
            if (undefined !== line) { await sink.send(textUpdate(paragraph(line))); }
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
            // One entry for every prompt whose sink was built; an error means the stop is `failed`.
            if (undefined !== sink) {
               logger.info('loop_stopped', {
                  sessionId: params.sessionId, reason: state.stop, profileHop: state.profileHop,
                  ...(undefined === state.word ? {} : { word: redact(state.word).slice(0, 64) }),
               });
            }
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
