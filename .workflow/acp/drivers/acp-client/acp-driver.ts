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
   type SessionConfigOption,
   type SessionConfigSelectGroup,
   type SessionConfigSelectOption,
   type Stream,
} from '@agentclientprotocol/sdk';
import { Driver, DriverResult, ExecuteOptions, validateExecuteArgs } from '../governed-driver.js';
import { AUTO_MODEL } from '../../modelResolver/resolver.js';
import { SessionCollapseError } from '../../protocol/errors.js';
import { endAgent } from './ending.js';
import { AgentSetupTimeoutError, ModelUnavailableError } from './errors.js';
import type { AcpDriverDeps, AgentHandle } from './types.js';

/** How long each setup step (connect, initialize, session/new) may take before the agent is ended. */
export const SETUP_TIMEOUT_MS = 30000;

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

/** The text of the turn in progress, collected from the agent's message chunks. */
interface Turn {
   text: string;
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
}

/**
 * The client side of one agent connection. It collects message text and
 * allows nothing; every request it does not register gets an error response.
 */
function connectClient(stream: Stream, turn: Turn): ClientConnection {
   return client({ name: 'acp-driver' })
      // Fail closed: no permission request is ever allowed here.
      .onRequest(methods.client.session.requestPermission, () => ({ outcome: { outcome: 'cancelled' as const } }))
      .onNotification(methods.client.session.update, ({ params }) => {
         const { update } = params;
         if ('agent_message_chunk' === update.sessionUpdate && 'text' === update.content.type) {
            turn.text += update.content.text;
         }
      })
      .connect(stream);
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
   await proc.connection.agent.request(methods.agent.session.setConfigOption, {
      sessionId: proc.sessionId, configId: option.id, value: model,
   });
   proc.model = model;
}

export function createAcpDriver(deps: AcpDriverDeps): Driver {
   const { name, connect, launch, logger } = deps;
   const procs    = new Set<Proc>();
   const sessions = new Map<string, Proc>();
   let closing: Promise<void> | undefined;

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
         void launched.then(late => endAgent(late), () => undefined);
         throw err;
      }
      const turn: Turn = { text: '' };
      const connection = connectClient(handle.stream, turn);
      const proc: Proc = { handle, connection, turn, sessionId: '', model: undefined, options: [] };
      procs.add(proc);
      if (signal?.aborted) { void endAgent(handle); return undefined; }
      try {
         await bounded('initialize', connection.agent.request(methods.agent.initialize, {
            protocolVersion: PROTOCOL_VERSION, clientCapabilities: {},
         }));
         if (signal?.aborted) { void endAgent(handle); return undefined; }
         const created = await bounded('session/new', connection.agent.request(methods.agent.session.new, {
            cwd: process.cwd(), mcpServers: [],
         }));
         if (signal?.aborted) { void endAgent(handle); return undefined; }
         proc.sessionId = created.sessionId;
         proc.options   = created.configOptions ?? [];
         proc.model     = findModelOption(proc.options)?.currentValue;
      }
      catch (err) { void endAgent(handle); throw err; }
      sessions.set(proc.sessionId, proc);
      return proc;
   }

   async function execute(command: string, options: ExecuteOptions = {}): Promise<DriverResult> {
      validateExecuteArgs(command, options);
      const { signal } = options;
      if (signal?.aborted) { return cancelledResult(); }
      let proc: Proc;
      if (undefined === options.sessionId) {
         const started = await start(signal).catch((err: unknown) => {
            if (signal?.aborted) { return undefined; }
            throw err;
         });
         if (undefined === started) { return cancelledResult(); }
         proc = started;
         try { if (undefined !== options.model) { await selectModel(proc, options.model); } }
         catch (err) { sessions.delete(proc.sessionId); void endAgent(proc.handle); throw err; }
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
      const context = options.context;
      const text    = undefined === context || '' === context ? command : `${context}\n\n${command}`;
      const response = await proc.connection.agent.request(methods.agent.session.prompt, {
         sessionId: proc.sessionId, prompt: [{ type: 'text', text }],
      });
      if ('cancelled' === response.stopReason) {
         logger.info('agent_cancel_unrequested', { agentSessionId: proc.sessionId });
      }
      return { text: proc.turn.text, sessionId: proc.sessionId, toolCalls: [] };
   }

   /** Ends every process the driver started, once, however often it is called. */
   function close(): Promise<void> {
      if (undefined === closing) {
         closing = Promise.all([...procs].map(proc => endAgent(proc.handle))).then(() => undefined);
      }
      return closing;
   }

   return { name, supportsToolCallGovernance: true, execute, close };
}
