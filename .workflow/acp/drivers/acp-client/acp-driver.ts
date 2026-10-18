/**
 * The shared ACP-client core: a governed `Driver` over any ACP agent.
 * One agent process per downstream session, launched at the first prompt.
 * What differs per agent (how to start it) is passed in.
 */
import {
   client,
   methods,
   PROTOCOL_VERSION,
   type ClientConnection,
   type RequestPermissionRequest,
   type RequestPermissionResponse,
   type SessionConfigOption,
   type SessionConfigSelectGroup,
   type SessionConfigSelectOption,
   type Stream,
} from '@agentclientprotocol/sdk';
import {
   Driver, DriverResult, ExecuteOptions, ToolCallOutcome, gateToolCall, validateExecuteArgs,
} from '../governed-driver.js';
import { loggedPath } from '../../governance/engine.js';
import { AUTO_MODEL } from '../../modelResolver/resolver.js';
import { SessionCollapseError } from '../../protocol/errors.js';
import { TguDiiltError } from '../../shared/errors.js';
import type { Logger } from '../../shared/logger.js';
import { type EndStage, endAgent } from './ending.js';
import {
   AgentProtocolError, AgentRefusedError, AgentSetupTimeoutError, ModelUnavailableError,
   exitFailure, launchFailure, requestFailure,
} from './errors.js';
import { answerFor, cancelledAnswer, createToolCallTable, type ToolCallTable } from './permissions.js';
import { type StderrTail, createStderrTail } from './stderr-tail.js';
import type { AcpDriverDeps, AgentHandle } from './types.js';

/** How long each setup step (connect, initialize, session/new) may take before the agent is ended. */
export const SETUP_TIMEOUT_MS = 30000;

/** Why the driver ended a process: the `reason` of its `agent_process_ended` entry. */
type EndReason =
   | 'deadline' | 'setup_timeout' | 'aborted_during_setup' | 'launch_failure' | 'crash'
   | 'protocol_failure' | 'handler_failure' | 'model_unavailable' | 'verify_refused' | 'disconnect';

/** Ending a process for these reasons is the driver's own choice, not a loss. */
const NOT_A_LOSS: readonly EndReason[] = ['aborted_during_setup', 'disconnect'];

/** Resolves with `promise`, or rejects with a timeout error naming `step`. Leaves no timer behind. */
function bounded<T>(step: string, promise: Promise<T>): Promise<T> {
   return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new AgentSetupTimeoutError(step, SETUP_TIMEOUT_MS)), SETUP_TIMEOUT_MS);
      promise.then(
         value => { clearTimeout(timer); resolve(value); },
         err   => { clearTimeout(timer); reject(err); },
      );
   });
}

/** The result of a turn cancelled before the agent had a session to name. */
function cancelledResult(): DriverResult {
   return { text: '', sessionId: '', toolCalls: [], cancelled: true };
}

/** The agent's select option that holds its model (category `model`). */
type ModelOption = Extract<SessionConfigOption, { type: 'select' }>;

/** The turn in progress on one process: what the agent said, and who is waiting. */
interface Turn {
   /** The text collected from the agent's message chunks. */
   text:   string;
   /** The tool calls the stream has shown this turn. */
   calls:  ToolCallTable;
   /** The prompt in flight; undefined between turns. */
   active: ActiveTurn | undefined;
}

/** A prompt in flight. */
interface ActiveTurn {
   options:  ExecuteOptions;
   /** One outcome per permission request, in request order; `deny` until the handler answers. */
   outcomes: ToolCallOutcome[];
}

/** One running agent and the single downstream session it serves. */
interface Proc {
   handle:     AgentHandle;
   connection: ClientConnection;
   turn:       Turn;
   /** The agent's session id; '' until `session/new` has returned. */
   sessionId:  string;
   /** The model currently selected in the agent, when it offers a model option. */
   model:      string | undefined;
   /** The config options the agent offered with `session/new`. */
   options:    readonly SessionConfigOption[];
   /** What the agent printed on stderr, bounded. */
   stderr:     StderrTail;
   /** True once the connection is dead: nothing is answered on it any more. */
   dead:       boolean;
   /** Rejects when the connection dies, so that every wait on the agent ends. */
   failed:     Promise<never>;
   /** Kills the connection: `failed` rejects with `err`. */
   reject:     (err: unknown) => void;
}

/** A `Proc` before its connection exists: what the connection's handlers read. */
type ProcState = Omit<Proc, 'connection'>;

/**
 * The client side of one agent connection. It collects message text, records
 * the tool calls the stream shows, and answers permission requests through the
 * turn's handler. It allows nothing else: every request it does not register
 * gets an error response.
 */
function connectClient(
   stream: Stream, proc: ProcState, logger: Logger, fail: (err: unknown) => void,
): ClientConnection {
   return client({ name: 'acp-driver' })
      // Notifications first: handlers are tried in this order, so a tool call
      // reaches the table before a permission request sent right after it.
      .onNotification(methods.client.session.update, ({ params }) => {
         const { update } = params;
         if ('agent_message_chunk' === update.sessionUpdate && 'text' === update.content.type) {
            proc.turn.text += update.content.text;
         }
         else if ('tool_call' === update.sessionUpdate || 'tool_call_update' === update.sessionUpdate) {
            const unasked = proc.turn.calls.note(update, 'tool_call' === update.sessionUpdate);
            if (undefined !== unasked) {
               logger.warn('governance_unrequested', {
                  agentSessionId: proc.sessionId,
                  toolCallId:     unasked.toolCallId,
                  kind:           unasked.kind,
                  ...(0 < unasked.paths.length ? { paths: unasked.paths.map(path => loggedPath(path)) } : {}),
               });
            }
         }
      })
      .onRequest(methods.client.session.requestPermission, ({ params }) => answerPermission(proc, params, logger, fail))
      .connect(stream);
}

/**
 * Answers one permission request. The handler is asked once, and the answer is
 * sent only after it settles. A request for another session, with no turn in
 * flight, or on a dead connection is cancelled and never reaches the handler.
 * A handler that fails fails the turn and gets a cancelled answer; so does a
 * request still open when the connection dies.
 */
async function answerPermission(
   proc: ProcState, params: RequestPermissionRequest, logger: Logger, fail: (err: unknown) => void,
): Promise<RequestPermissionResponse> {
   if (params.sessionId !== proc.sessionId) {
      logger.warn('permission_unknown_session', { agentSessionId: params.sessionId, pid: proc.handle.pid });
      return cancelledAnswer();
   }
   const { active } = proc.turn;
   if (proc.dead || undefined === active) { return cancelledAnswer(); }

   const report  = proc.turn.calls.report(params.toolCall);
   const outcome: ToolCallOutcome = { report, decision: 'deny' };
   active.outcomes.push(outcome);
   try { outcome.decision = await gateToolCall(active.options, report); }
   catch (err) { fail(err); return cancelledAnswer(); }
   if (proc.dead) { return cancelledAnswer(); }
   return answerFor(params.options, outcome.decision, wanted =>
      logger.warn('permission_option_fallback', { agentSessionId: proc.sessionId, wanted }));
}

/**
 * What a failed request means: our own errors pass through; an agent that has
 * exited failed by exiting; anything else is explained with the agent's output.
 */
async function explain(proc: ProcState, method: string, err: unknown): Promise<unknown> {
   if (err instanceof TguDiiltError) { return err; }
   const tail = proc.stderr.tail();
   if (proc.handle.hasExited()) { return exitFailure(await proc.handle.exited, tail); }
   return requestFailure(method, err, tail);
}

/** Awaits a request to the agent. Its failure is explained, and the connection dying ends the wait. */
function call<T>(proc: ProcState, method: string, request: Promise<T>): Promise<T> {
   const explained = request.catch(async (err: unknown) => { throw await explain(proc, method, err); });
   return Promise.race([explained, proc.failed]);
}

function findModelOption(options: readonly SessionConfigOption[]): ModelOption | undefined {
   return options.find((o): o is ModelOption => 'model' === o.category && 'select' === o.type);
}

/** Every value the option offers, grouped or not. */
function offeredValues(option: ModelOption): string[] {
   return (option.options as Array<SessionConfigSelectOption | SessionConfigSelectGroup>)
      .flatMap(entry => 'group' in entry ? entry.options : [entry])
      .map(entry => entry.value);
}

/**
 * Selects `model` through the agent's model config option. Choosing the
 * model is the dispatcher's job: this only applies it. `auto` is never an
 * error. Any other model the agent does not offer is.
 */
async function selectModel(proc: Proc, model: string): Promise<void> {
   const option = findModelOption(proc.options);
   if (undefined === option || !offeredValues(option).includes(model)) {
      if (AUTO_MODEL === model) { return; }
      throw new ModelUnavailableError(model);
   }
   if (model === proc.model) { return; }
   await call(proc, 'session/set_config_option', proc.connection.agent.request(methods.agent.session.setConfigOption, {
      sessionId: proc.sessionId, configId: option.id, value: model,
   }));
   proc.model = model;
}

export function createAcpDriver(deps: AcpDriverDeps): Driver {
   const { name, connect, launch, policy, logger } = deps;
   const procs    = new Set<Proc>();
   const sessions = new Map<string, Proc>();
   const endings  = new WeakMap<AgentHandle, Promise<EndStage>>();
   let closing: Promise<void> | undefined;
   /** Why the most recent process was lost; the next launch replaces it. */
   let lost: EndReason | undefined;

   /**
    * Ends the agent and logs it, once; the first reason wins. Any reason but the
    * driver's own choices means a process was lost.
    */
   function end(handle: AgentHandle, reason: EndReason, agentSessionId = ''): Promise<EndStage> {
      let ending = endings.get(handle);
      if (undefined === ending) {
         if (!NOT_A_LOSS.includes(reason)) { lost = reason; }
         ending = endAgent(handle).then(stage => {
            logger.info('agent_process_ended', {
               pid: handle.pid, ...('' === agentSessionId ? {} : { agentSessionId }), reason, stage,
            });
            return stage;
         });
         endings.set(handle, ending);
      }
      return ending;
   }

   /**
    * The connection is dead: whatever waits on the agent fails with `err`, the
    * session is gone (a later prompt on it is a session collapse) and the
    * process is ended.
    */
   function failProc(proc: Proc, err: unknown, reason: EndReason): void {
      if (proc.dead) { return; }
      proc.dead = true;
      sessions.delete(proc.sessionId);
      proc.reject(err);
      void end(proc.handle, reason, proc.sessionId);
   }

   /** An abort was seen while setting up: the agent is ended and the turn settles cancelled. */
   function abandon(proc: Proc, step: string): undefined {
      logger.info('agent_setup_aborted', { step, pid: proc.handle.pid });
      void end(proc.handle, 'aborted_during_setup');
      return undefined;
   }

   /**
    * Launches an agent and runs initialize and session/new, each step bounded by
    * SETUP_TIMEOUT_MS. An abort is seen when a step returns, not before; then the
    * agent is ended and nothing is returned.
    */
   async function start(signal?: AbortSignal): Promise<Proc | undefined> {
      const launched = connect({ command: launch.command, args: launch.args, cwd: process.cwd() });
      let handle: AgentHandle;
      try { handle = await bounded('connect', launched); }
      catch (err) {
         // A launch that completes after its timeout must not leave a process behind.
         void launched.then(late => end(late, 'setup_timeout'), () => undefined);
         lost = err instanceof AgentSetupTimeoutError ? 'setup_timeout' : 'launch_failure';
         throw launchFailure(launch.command, err);
      }
      if (undefined !== lost) {
         logger.info('agent_relaunched', { pid: handle.pid, after: lost });
         lost = undefined;
      }

      const stderr = createStderrTail();
      handle.onStderr(text => stderr.add(text));
      let reject!: (err: unknown) => void;
      const failed = new Promise<never>((_, rej) => { reject = rej; });
      failed.catch(() => undefined);

      const turn: Turn = { text: '', calls: createToolCallTable(), active: undefined };
      const state: ProcState = {
         handle, turn, sessionId: '', model: undefined, options: [], stderr, dead: false, failed, reject,
      };
      const proc: Proc = Object.assign(state, {
         connection: connectClient(handle.stream, state, logger, err => failProc(proc, err, 'handler_failure')),
      });
      procs.add(proc);
      // An exit we did not ask for kills the connection; the message carries the agent's last words.
      void handle.exited.then(exit => {
         if (endings.has(handle)) { return; }
         failProc(proc, exitFailure(exit, stderr.tail()), '' === proc.sessionId ? 'launch_failure' : 'crash');
      });

      if (signal?.aborted) { return abandon(proc, 'launch'); }
      try {
         const init = await bounded('initialize', call(proc, 'initialize', proc.connection.agent.request(
            methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })));
         if (signal?.aborted) { return abandon(proc, 'initialize'); }
         if (PROTOCOL_VERSION !== init.protocolVersion) {
            throw new AgentProtocolError(
               `the agent speaks ACP version ${String(init.protocolVersion)}, not ${PROTOCOL_VERSION}`, stderr.tail());
         }
         const refusedAfterInitialize = policy?.verifyInitialize?.(init);
         if (undefined !== refusedAfterInitialize) { throw new AgentRefusedError(refusedAfterInitialize); }
         const created = await bounded('session/new', call(proc, 'session/new', proc.connection.agent.request(
            methods.agent.session.new, { cwd: process.cwd(), mcpServers: [] })));
         if (signal?.aborted) { return abandon(proc, 'session_new'); }
         if ('string' !== typeof created.sessionId || '' === created.sessionId) {
            throw new AgentProtocolError('the agent did not name a session', stderr.tail());
         }
         const refusedAfterSession = policy?.verifySession?.(created);
         if (undefined !== refusedAfterSession) { throw new AgentRefusedError(refusedAfterSession); }
         proc.sessionId = created.sessionId;
         proc.options   = created.configOptions ?? [];
         proc.model     = findModelOption(proc.options)?.currentValue;
      }
      catch (err) {
         void end(handle, err instanceof AgentSetupTimeoutError ? 'setup_timeout'
            : err instanceof AgentRefusedError ? 'verify_refused' : 'protocol_failure');
         throw err;
      }
      sessions.set(proc.sessionId, proc);
      return proc;
   }

   async function execute(command: string, options: ExecuteOptions = {}): Promise<DriverResult> {
      validateExecuteArgs(command, options);
      const { signal } = options;
      if (signal?.aborted) {
         logger.info('agent_setup_aborted', { step: 'entry' });
         return cancelledResult();
      }
      let proc: Proc;
      if (undefined === options.sessionId) {
         const started = await start(signal).catch((err: unknown) => {
            if (signal?.aborted) { return undefined; }
            throw err;
         });
         if (undefined === started) { return cancelledResult(); }
         proc = started;
         try { if (undefined !== options.model) { await selectModel(proc, options.model); } }
         catch (err) {
            failProc(proc, err, err instanceof ModelUnavailableError ? 'model_unavailable' : 'protocol_failure');
            throw err;
         }
      }
      else {
         const known = sessions.get(options.sessionId);
         if (undefined === known) {
            throw new SessionCollapseError(
               `the agent session ${options.sessionId} is no longer available; start a new session`);
         }
         proc = known;
         if (undefined !== options.model) { await selectModel(proc, options.model); }
      }

      proc.turn.text = '';
      proc.turn.calls.clear();
      const active: ActiveTurn = { options, outcomes: [] };
      proc.turn.active = active;
      try {
         const context = options.context;
         const text    = undefined === context || '' === context ? command : `${context}\n\n${command}`;
         const response = await call(proc, 'session/prompt', proc.connection.agent.request(
            methods.agent.session.prompt, { sessionId: proc.sessionId, prompt: [{ type: 'text', text }] }));
         if ('cancelled' === response.stopReason) {
            logger.info('agent_cancel_unrequested', { agentSessionId: proc.sessionId });
         }
         return { text: proc.turn.text, sessionId: proc.sessionId, toolCalls: active.outcomes };
      }
      finally {
         proc.turn.active = undefined;
         proc.turn.calls.clear();
      }
   }

   /** Ends every process the driver started, once, however often it is called. */
   function close(): Promise<void> {
      if (undefined === closing) {
         closing = Promise.all([...procs].map(proc => end(proc.handle, 'disconnect', proc.sessionId)))
            .then(() => undefined);
      }
      return closing;
   }

   return { name, supportsToolCallGovernance: true, execute, close };
}
