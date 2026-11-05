/**
 * The shared ACP driver core: a governed `Driver` over any ACP agent.
 * One agent process per downstream session, launched at the first prompt.
 * What differs per agent (how to start it) is passed in.
 */
import {
   client,
   methods,
   PROTOCOL_VERSION,
   RequestError,
   type ClientConnection,
   type RequestPermissionRequest,
   type RequestPermissionResponse,
   type SessionConfigOption,
   type SessionConfigSelectGroup,
   type SessionConfigSelectOption,
   type Stream,
} from '@agentclientprotocol/sdk';
import {
   Driver, DriverResult, ExecuteOptions, ToolCallOutcome, TurnEnd, TurnUpdate,
   gateToolCall, validateExecuteArgs,
} from '../governed-driver.js';
import { loggedPath } from '../../governance/engine.js';
import { AUTO_MODEL } from '../../modelResolver/resolver.js';
import { SessionCollapseError, boundaryErrorKind } from '../../protocol/errors.js';
import { TguDiiltError } from '../../shared/errors.js';
import { type Logger, printErrorMessage } from '../../shared/logger.js';
import { type EndStage, endAgent, exitsWithin } from './ending.js';
import {
   AgentCancelTimeoutError, AgentProtocolError, AgentRefusedError, AgentSetupTimeoutError,
   AgentStopReasonError, ModelUnavailableError,
   AGENT_FAILURE_KIND, type AgentFailureKind,
   exitFailure, failureKind, launchFailure, requestFailure, summaryOf, withRecordLine,
} from './errors.js';
import {
   answerFor, cancelledAnswer, createToolCallTable, turnUpdateOf, type ToolCallTable,
} from './permissions.js';
import { type StderrTail, createStderrTail } from './stderr-tail.js';
import type { AcpDriverDeps, AgentExit, AgentHandle, UnsafeSetting } from './types.js';
import { refusalFor, unsafeSettingsOn, warningFor } from './unsafe-settings.js';

/** How long each setup step (connect, initialize, session/new) may take before the agent is ended. */
export const SETUP_TIMEOUT_MS = 30000;

/** How long the agent has to answer a cancel before it is ended. It counts from the abort. */
export const CANCEL_DEADLINE_MS = 5000;

/** How long an agent has to exit after its output ended before the connection counts as dead. */
export const OUTPUT_END_GRACE_MS = 500;

/** Why the driver ended a process: the `reason` of its `agent_process_ended` entry. */
type EndReason =
   | 'deadline' | 'setup_timeout' | 'aborted_during_setup' | 'launch_failure' | 'crash'
   | 'protocol_failure' | 'handler_failure' | 'model_unavailable' | 'verify_refused' | 'disconnect'
   | 'release';

/** Ending a process for these reasons is the driver's own choice, not a loss. */
const NOT_A_LOSS: readonly EndReason[] = ['aborted_during_setup', 'disconnect', 'release'];

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

/** What each stop reason for a finished turn means. Any other value is a failure. */
const END_OF = new Map<string, TurnEnd>([
   ['end_turn', 'completed'], ['max_tokens', 'output_limit'],
   ['max_turn_requests', 'request_limit'], ['refusal', 'refused'],
]);

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
   options:   ExecuteOptions;
   /** One outcome per permission request, in request order; `deny` until the handler answers. */
   outcomes:  ToolCallOutcome[];
   /** True once the turn's abort has been seen. */
   aborted:   boolean;
   /** Settles when the abort is seen, so a wait on the handler ends at once. */
   abortSeen: Promise<void>;
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
   /** The unsafe settings the agent has on now. */
   unsafeOn:   readonly string[];
   /** Settings switched on between turns, to be told at the start of the next turn. */
   warnings:   string[];
   /** What the agent printed on stderr, bounded. */
   stderr:     StderrTail;
   /** True once the connection is dead: nothing is answered on it any more. */
   dead:       boolean;
   /** Rejects when the connection dies, so that every wait on the agent ends. */
   failed:     Promise<never>;
   /** Kills the connection: `failed` rejects with `err`. */
   reject:     (err: unknown) => void;
   /** How the process exited; undefined while it runs. */
   exit:       AgentExit | undefined;
   /** True once a failure of this process has been recorded. */
   reported:   boolean;
   /** Records a failure of this process, unless the driver caused it. At most one per process. */
   report:     (err: unknown, kind?: AgentFailureKind) => void;
}

/** A `Proc` before its connection exists: what the connection's handlers read. */
type ProcState = Omit<Proc, 'connection'>;

/** The fields of a record that come from the process. A field that does not apply is left out. */
function processFields(proc: ProcState) {
   const { exit } = proc;
   return {
      pid: proc.handle.pid,
      ...('' === proc.sessionId ? {} : { agentSessionId: proc.sessionId }),
      ...(undefined === exit || null === exit.code ? {} : { exitCode: exit.code }),
      ...(undefined === exit || null === exit.signal ? {} : { signal: exit.signal }),
      ...(undefined === proc.model ? {} : { model: proc.model }),
   };
}

/**
 * Reports an update to the turn's callback, only while a turn runs. The callback belongs to
 * that turn; a throw is ignored, because the turn must not depend on who is listening.
 */
function emit(proc: ProcState, update: TurnUpdate | undefined): void {
   const onUpdate = proc.turn.active?.options.onUpdate;
   if (undefined === update || undefined === onUpdate) { return; }
   try { onUpdate(update); }
   catch { /* a callback that throws never fails the turn */ }
}

/** Adds the unsafe-setting warning to the turn's text, as its own paragraph, and reports it. */
function tellWarning(proc: ProcState, names: readonly string[]): void {
   const { turn } = proc;
   const lead = '' === turn.text || turn.text.endsWith('\n\n') ? '' : '\n\n';
   const paragraph = `${lead}${warningFor(names)}\n\n`;
   turn.text += paragraph;
   emit(proc, { type: 'text', text: paragraph });
}

/**
 * The client side of one agent connection. It collects message text, records
 * the tool calls the stream shows, and answers permission requests through the
 * turn's handler. It allows nothing else: every request it does not register
 * gets an error response.
 */
function connectClient(
   stream: Stream, proc: ProcState, unsafe: readonly UnsafeSetting[], logger: Logger, fail: (err: unknown) => void,
): ClientConnection {
   return client({ name: 'acp-driver' })
      // Notifications first: handlers are tried in this order, so a tool call
      // reaches the table before a permission request sent right after it.
      .onNotification(methods.client.session.update, ({ params }) => {
         // An update naming another session is not this turn's. The agent is an untrusted peer.
         if (params.sessionId !== proc.sessionId) { return; }
         const { update } = params;
         if ('agent_message_chunk' === update.sessionUpdate && 'text' === update.content.type) {
            proc.turn.text += update.content.text;
            if ('' !== update.content.text) { emit(proc, { type: 'text', text: update.content.text }); }
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
            emit(proc, turnUpdateOf(update));
         }
         else if ('config_option_update' === update.sessionUpdate) {
            const switchedOn = unsafeSettingsOn(unsafe, update.configOptions);
            const added = switchedOn.filter(name => !proc.unsafeOn.includes(name));
            for (const setting of added) {
               logger.warn('agent_setting_changed', { agentSessionId: proc.sessionId, setting });
            }
            proc.unsafeOn = switchedOn;
            if (0 < added.length) {
               if (undefined === proc.turn.active) { proc.warnings.push(...added); }
               else                                { tellWarning(proc, added); }
            }
         }
      })
      .onRequest(methods.client.session.requestPermission, ({ params }) => answerPermission(proc, params, logger, fail))
      .connect(stream);
}

/**
 * Answers one permission request. The handler is asked once, and the answer is
 * sent only after it settles. A request for another session, with no turn in
 * flight, after the turn's abort, or on a dead connection is cancelled and never
 * reaches the handler. An abort cancels a request still waiting on the handler
 * at once, and the handler's late answer, approve included, is discarded. A
 * handler that fails fails the turn and gets a cancelled answer; so does a
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
   if (proc.dead || undefined === active || active.aborted) { return cancelledAnswer(); }

   const report  = proc.turn.calls.report(params.toolCall);
   const outcome: ToolCallOutcome = { report, decision: 'deny' };
   active.outcomes.push(outcome);
   const gated = await Promise.race([
      gateToolCall(active.options, report).then(decision => ({ decision }), (err: unknown) => ({ err })),
      active.abortSeen.then(() => undefined),
   ]);
   if (undefined === gated || active.aborted) { return cancelledAnswer(); }
   if ('err' in gated) { fail(gated.err); return cancelledAnswer(); }
   outcome.decision = gated.decision;
   if (proc.dead) { return cancelledAnswer(); }
   return answerFor(params.options, outcome.decision, wanted =>
      logger.warn('permission_option_fallback', { agentSessionId: proc.sessionId, wanted }));
}

/**
 * What a failed request means: our own errors pass through; an agent that has
 * exited failed by exiting; anything else is explained with the agent's output.
 * A connection that closed (not an error answer) may be an agent that is just
 * exiting: its output ends before the exit is reported, so the exit is awaited.
 */
async function explain(proc: ProcState, method: string, err: unknown): Promise<unknown> {
   if (err instanceof TguDiiltError) { return err; }
   if (!(err instanceof RequestError) && !proc.handle.hasExited()) {
      await exitsWithin(proc.handle, OUTPUT_END_GRACE_MS);
   }
   const tail = proc.stderr.tail();
   if (proc.handle.hasExited()) { return exitFailure(await proc.handle.exited, tail); }
   return requestFailure(method, err, tail);
}

/** Awaits a request to the agent. Its failure is explained, and the connection dying ends the wait. */
function call<T>(proc: ProcState, method: string, request: Promise<T>): Promise<T> {
   const explained = request.catch(async (err: unknown) => {
      const failure = await explain(proc, method, err);
      proc.report(failure);
      throw failure;
   });
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
   const { name, connect, launch, policy, unsafeSettings = [], logger, diagnostics } = deps;
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
    * Records a failure of the agent in the diagnostic log and ends the error's message with the
    * line that names the file. One record per process; a failure the driver caused (a process it
    * is already ending) is not one. The record is written before the failure is thrown. Nothing
    * here may change the failure itself.
    */
   function reportFailure(proc: ProcState | undefined, err: unknown, kind = failureKind(err)): void {
      if (undefined === kind) { return; }
      if (undefined !== proc) {
         if (proc.reported || endings.has(proc.handle)) { return; }
         proc.reported = true;
      }
      try {
         const tail = proc?.stderr.tail() ?? '';
         diagnostics.record({
            kind, message: summaryOf(printErrorMessage(err)), driver: name,
            ...(undefined === proc ? {} : processFields(proc)),
            ...('' === tail ? {} : { tail }),
         });
         if (undefined !== diagnostics.path) { withRecordLine(err, diagnostics.path); }
      }
      catch { /* a record must never change the failure it describes */ }
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
      proc.report(err, 'handler_failure' === reason ? AGENT_FAILURE_KIND.handlerFailed : undefined);
      proc.reject(err);
      void end(proc.handle, reason, proc.sessionId);
   }

   /** An abort, or a close, was seen while setting up: the agent is ended and the turn settles cancelled. */
   function abandon(proc: Proc, step: string): undefined {
      logger.info('agent_setup_aborted', { step, pid: proc.handle.pid });
      void end(proc.handle, 'aborted_during_setup');
      return undefined;
   }

   /**
    * Launches an agent and runs initialize and session/new, each step bounded by
    * SETUP_TIMEOUT_MS. An abort, or a close, is seen when a step returns, not
    * before; then the agent is ended and nothing is returned.
    */
   async function start(signal?: AbortSignal): Promise<Proc | undefined> {
      const stopped = () => true === signal?.aborted || undefined !== closing;
      const launched = connect({ command: launch.command, args: launch.args, cwd: process.cwd() });
      let handle: AgentHandle;
      try { handle = await bounded('connect', launched); }
      catch (err) {
         // A launch that completes after its timeout must not leave a process behind.
         void launched.then(late => end(late, 'setup_timeout'), () => undefined);
         lost = err instanceof AgentSetupTimeoutError ? 'setup_timeout' : 'launch_failure';
         const failure = launchFailure(launch.command, err);
         reportFailure(undefined, failure);
         throw failure;
      }
      // The driver was closed while this agent was starting: end it at once.
      if (undefined !== closing) { void end(handle, 'disconnect'); return undefined; }
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
         handle, turn, sessionId: '', model: undefined, options: [], unsafeOn: [], warnings: [],
         stderr, dead: false, failed, reject, exit: undefined, reported: false,
         report: (err, kind) => reportFailure(proc, err, kind),
      };
      const proc: Proc = Object.assign(state, {
         connection: connectClient(
            handle.stream, state, unsafeSettings, logger, err => failProc(proc, err, 'handler_failure'),
         ),
      });
      procs.add(proc);
      // An exit we did not ask for kills the connection; the message carries the agent's last words.
      void handle.exited.then(exit => {
         proc.exit = exit;
         if (endings.has(handle)) { return; }
         failProc(proc, exitFailure(exit, stderr.tail()), '' === proc.sessionId ? 'launch_failure' : 'crash');
      });
      // The agent's output ended while it still runs: nothing can be answered on it any more.
      void proc.connection.closed.then(async () => {
         if (endings.has(handle) || await exitsWithin(handle, OUTPUT_END_GRACE_MS) || endings.has(handle)) { return; }
         failProc(
            proc,
            new AgentProtocolError('the agent closed its output but did not exit', stderr.tail()),
            'protocol_failure',
         );
      });

      if (stopped()) { return abandon(proc, 'launch'); }
      try {
         const init = await bounded('initialize', call(proc, 'initialize', proc.connection.agent.request(
            methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })));
         if (stopped()) { return abandon(proc, 'initialize'); }
         if (PROTOCOL_VERSION !== init.protocolVersion) {
            throw new AgentProtocolError(
               `the agent speaks ACP version ${String(init.protocolVersion)}, not ${PROTOCOL_VERSION}`, stderr.tail());
         }
         const refusedAfterInitialize = policy?.verifyInitialize?.(init);
         if (undefined !== refusedAfterInitialize) { throw new AgentRefusedError(refusedAfterInitialize); }
         const created = await bounded('session/new', call(proc, 'session/new', proc.connection.agent.request(
            methods.agent.session.new, { cwd: process.cwd(), mcpServers: [] })));
         if (stopped()) { return abandon(proc, 'session_new'); }
         if ('string' !== typeof created.sessionId || '' === created.sessionId) {
            throw new AgentProtocolError('the agent did not name a session', stderr.tail());
         }
         const offered    = Array.isArray(created.configOptions) ? created.configOptions : [];
         const switchedOn = unsafeSettingsOn(unsafeSettings, offered);
         if (0 < switchedOn.length) { throw new AgentRefusedError(refusalFor(switchedOn)); }
         const refusedAfterSession = policy?.verifySession?.(created);
         if (undefined !== refusedAfterSession) { throw new AgentRefusedError(refusedAfterSession); }
         proc.sessionId = created.sessionId;
         proc.options   = offered;
         proc.model     = findModelOption(proc.options)?.currentValue;
      }
      catch (err) {
         proc.report(err);
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
            if (signal?.aborted || undefined !== closing) { return undefined; }
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
      let markAborted!: () => void;
      const active: ActiveTurn = {
         options, outcomes: [], aborted: false,
         abortSeen: new Promise<void>(resolve => { markAborted = () => { active.aborted = true; resolve(); }; }),
      };
      proc.turn.active = active;
      // Settings found between turns are told first: the first text of this turn.
      const pending = [...new Set(proc.warnings.splice(0))];
      if (0 < pending.length) { tellWarning(proc, pending); }
      let deadline: ReturnType<typeof setTimeout> | undefined;
      /** The abort: ask the agent to stop and give it CANCEL_DEADLINE_MS to answer. Acts once. */
      const onAbort = () => {
         if (active.aborted) { return; }
         markAborted();
         if (proc.dead) { return; }
         void proc.connection.agent.notify(methods.agent.session.cancel, { sessionId: proc.sessionId })
            .catch(() => undefined);
         deadline = setTimeout(() => {
            logger.warn('agent_cancel_deadline', {
               agentSessionId: proc.sessionId, pid: proc.handle.pid, deadlineMs: CANCEL_DEADLINE_MS,
            });
            failProc(proc, new AgentCancelTimeoutError(CANCEL_DEADLINE_MS), 'deadline');
         }, CANCEL_DEADLINE_MS);
      };
      const result = (end?: TurnEnd): DriverResult => ({
         text:      proc.turn.text,
         sessionId: proc.sessionId,
         toolCalls: active.outcomes,
         ...(active.aborted ? { cancelled: true } : {}),
         ...(undefined === end ? {} : { end }),
      });
      try {
         const context = options.context;
         const text    = undefined === context || '' === context ? command : `${context}\n\n${command}`;
         const prompt = proc.connection.agent.request(
            methods.agent.session.prompt, { sessionId: proc.sessionId, prompt: [{ type: 'text', text }] });
         signal?.addEventListener('abort', onAbort);
         if (signal?.aborted) { onAbort(); }
         const response = await call(proc, 'session/prompt', prompt);
         // Our abort wins over whatever the agent says. Otherwise only the four known reasons are an
         // answer: the agent cancelling by itself, or any other value, fails the turn but not the process.
         const stopReason: unknown = response.stopReason;
         const known = 'string' === typeof stopReason ? END_OF.get(stopReason) : undefined;
         if (!active.aborted && undefined === known) { throw new AgentStopReasonError(stopReason); }
         return result(undefined !== known && 'completed' !== known ? known : undefined);
      }
      catch (err) {
         if (!active.aborted) { throw err; }
         // The deadline is the driver's own doing and has its own entry.
         if (!(err instanceof AgentCancelTimeoutError)) {
            logger.info('agent_failure_after_cancel', {
               agentSessionId: proc.sessionId, failureKind: boundaryErrorKind(err) ?? 'internal',
            });
         }
         return result();
      }
      finally {
         signal?.removeEventListener('abort', onAbort);
         clearTimeout(deadline);
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

   /**
    * Ends the process that serves one session, once. The id leaves `sessions` first, so a turn
    * that follows collapses without waiting. An unknown or released id resolves and does nothing.
    */
   function release(sessionId: string): Promise<void> {
      const proc = sessions.get(sessionId);
      if (undefined === proc) { return Promise.resolve(); }
      sessions.delete(sessionId);
      return end(proc.handle, 'release', sessionId).then(() => undefined);
   }

   return { name, supportsToolCallGovernance: true, execute, close, release };
}
