import { createAgent } from '../agent.js';
import { createSessionStore } from '../session-store.js';
import { createGovernanceEngine } from '../../governance/engine.js';
import { createFakeGovernedDriver } from '../../drivers/__tests__/fake-governed-driver.js';
import { DriverNotInCatalogError } from '../../drivers/errors.js';
import type { DriverCatalog } from '../../drivers/driver-catalog.js';
import type { ToolCallReport } from '../../drivers/governed-driver.js';
import type { DispatchResult } from '../../modelResolver/types.js';

export const PROTOCOL_VERSION = 1;

export interface LogEntry { level: string; event: string; data: any }

/**
 * Records the ordered stream of outbound client calls the agent makes
 * through the ACP context: session/update notifications and
 * session/request_permission requests. `permission` decides how the
 * client answers a request_permission call.
 */
export function createCx(
   { permission = { outcome: 'selected', optionId: 'allow' }, respond, failDetail = false }:
   {
      permission?: { outcome: string; optionId?: string };
      /** Overrides the answer to the Nth approval request (0-based). */
      respond?:    (params: any, index: number) => unknown;
      /** Makes the detail update (and only that update) throw. */
      failDetail?: boolean;
   } = {},
)
{
   const calls: Array<{ kind: string; method: string; params: any }> = [];
   return {
      calls,
      notify: async (method: string, params: any) => {
         calls.push({ kind: 'notify', method, params });
         if (failDetail && 'tool_call' === params?.update?.sessionUpdate) {
            throw new Error('connection lost');
         }
      },
      request: async (method: string, params: any) => {
         const index = calls.filter(c => 'request' === c.kind).length;
         calls.push({ kind: 'request', method, params });
         if (respond) { return respond(params, index); }
         return { outcome: permission };
      },
   };
}

export function createDriverSpy(
   result: any = { text: 'ok', sessionId: 'drv-sess' }, name = 'fake',
)
{
   const seen: Array<{ command: string; options: any }> = [];
   return {
      seen,
      name:                       name,
      supportsToolCallGovernance: true,
      execute: async (command: string, options: any = {}) => {
         seen.push({ command, options });
         if ('function' === typeof result) { return result(command, options); }
         return result;
      },
      close: async () => {},
   };
}

export function createLogger()
{
   const entries: LogEntry[] = [];
   return {
      entries,
      debug: (event: string, data: any = {}) => { entries.push({ level: 'debug', event, data }); },
      info:  (event: string, data: any = {}) => { entries.push({ level: 'info',  event, data }); },
      warn:  (event: string, data: any = {}) => { entries.push({ level: 'warn',  event, data }); },
      error: (event: string, data: any = {}) => { entries.push({ level: 'error', event, data }); },
   };
}

/**
 * A catalog over fake drivers by name. A name it does not hold throws, as the
 * real one does.
 */
export function catalogOf(drivers: Record<string, any>, notice?: string): DriverCatalog
{
   const first = Object.keys(drivers)[0];
   return {
      get(name) {
         if (!Object.hasOwn(drivers, name))
         { throw new DriverNotInCatalogError(name, Object.keys(drivers)); }
         return drivers[name];
      },
      names:    () => Object.keys(drivers),
      closeAll: async () => {
         await Promise.all(Object.values(drivers).map(async driver => driver.close()));
      },
      resolverConfig: { drivers: {} },
      preferred:      { name: first, inUse: first, inUseModel: 'auto', flagged: false },
      ...(undefined !== notice ? { notice } : {}),
   };
}

/** A catalog holding the one driver, under its own name. */
export const oneDriverCatalog = (driver: any, notice?: string) =>
   catalogOf({ [driver.name]: driver }, notice);

/** The answer a resolver gives: the driver, and a model (default auto). */
export const resolved = (driver: string, model = 'auto'): DispatchResult =>
   ({ driver, model, source: 'registry-default' });

/**
 * A resolver whose answer to the Nth call (0-based) the test scripts: a result,
 * or an error to throw. It records the profile argument of every call.
 */
export function createResolverStub(answer: (call: number) => DispatchResult | Error)
{
   const calls: Array<string | undefined> = [];
   return {
      calls,
      resolve(profile?: string): DispatchResult {
         const made = answer(calls.length);
         calls.push(profile);
         if (made instanceof Error) { throw made; }
         return made;
      },
   };
}

export interface Deferred<T> {
   promise: Promise<T>;
   resolve: (value: T) => void;
   reject:  (reason?: unknown) => void;
}

export function deferred<T = void>(): Deferred<T>
{
   let resolve!: (value: T) => void;
   let reject!:  (reason?: unknown) => void;
   const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
   return { promise, resolve, reject };
}

/** Lets already-settled promises react, without timers. */
export async function flush()
{
   for (let i = 0; i < 20; i++) { await Promise.resolve(); }
}

/**
 * A driver whose turns end only when the test releases them, so a test can
 * cancel, prompt again or disconnect while a turn is in flight. It ignores
 * the signal, like a driver that does not support cancellation.
 */
export function createHeldDriver()
{
   const starts: Array<Deferred<void>> = [];
   const holds:  Array<Deferred<any>>  = [];
   let count   = 0;
   let running = 0;
   let peak    = 0;
   const startOf = (n: number) => {
      while (starts.length <= n) { starts.push(deferred()); }
      return starts[n];
   };
   const driver = createDriverSpy(async () => {
      const n = count++;
      holds[n] = deferred();
      running += 1;
      peak     = Math.max(peak, running);
      startOf(n).resolve();
      try { return await holds[n].promise; }
      finally { running -= 1; }
   });
   return {
      driver,
      started: (n: number) => startOf(n).promise,
      release: (n: number, result: any = { text: 'ok', sessionId: 'drv-held', toolCalls: [] }) =>
         holds[n].resolve(result),
      fail:    (n: number, err: unknown) => holds[n].reject(err),
      peak:    () => peak,
   };
}

/** Opens a session and starts a turn on it without awaiting the turn. */
export async function startTurn(agent: ReturnType<typeof makeAgent>['agent'], cx: any = createCx(), text = 'go')
{
   const s    = await agent.newSession(newSessionArgs());
   const turn = agent.prompt({ sessionId: s.sessionId, ...textParam(text) }, cx);
   return { sessionId: s.sessionId, turn };
}

export function makeAgent(overrides: any = {})
{
   const driver       = overrides.driver       ?? createDriverSpy();
   const catalog      = overrides.catalog      ?? oneDriverCatalog(driver);
   const resolver     = overrides.resolver     ?? createResolverStub(() => resolved(driver.name));
   const logger       = overrides.logger       ?? createLogger();
   const sessionStore = overrides.sessionStore ??
      createSessionStore({ newWorkflowId: (() => { let n = 0; return () => `wf-${++n}`; })() });
   const governance = overrides.governance ?? createGovernanceEngine({
      config: { rules: overrides.rules ?? [], default: overrides.defaultAction ?? 'ask' },
      logger,
   });
   const agent = createAgent({
      catalog, resolver, sessionStore, logger, governance, protocolVersion: PROTOCOL_VERSION,
   });
   // Most tests operate on an initialized boundary. `initialize` flips the
   // internal flag synchronously (before its first await), so the guard tests
   // that pass `init: false` reliably observe an un-initialized agent.
   if (false !== overrides.init) { void agent.initialize({ protocolVersion: PROTOCOL_VERSION }); }
   return { agent, driver, catalog, resolver, logger, sessionStore, governance };
}

export function textParam(text: string)
{
   return { prompt: [{ type: 'text' as const, text }] };
}

/** SDK-conformant NewSessionRequest args for tests. */
export function newSessionArgs()
{
   return { cwd: '/repo', mcpServers: [] };
}

// Groups 11-14: tool-call governance handler --------------------------------

export const readReport: ToolCallReport = { kind: 'read', title: 'Read a.ts', paths: ['/repo/a.ts'] };
export const editReport: ToolCallReport = {
   kind: 'edit', title: 'Edit a.ts', paths: ['/repo/a.ts'], diff: '- a\n+ b',
   rawInput: { path: '/repo/a.ts' },
};

export const allow  = { outcome: 'selected', optionId: 'allow'  };
export const reject = { outcome: 'selected', optionId: 'reject' };

export type Cx = ReturnType<typeof createCx>;

export const requestsOf = (cx: Cx) => cx.calls.filter(c => 'session/request_permission' === c.method);
export const detailsOf  = (cx: Cx) => cx.calls.filter(c => 'tool_call' === c.params?.update?.sessionUpdate);
export const eventsOf   = (logger: { entries: LogEntry[] }, event: string) =>
   logger.entries.filter(e => event === e.event);

/** Runs one governed turn: scripts `reports` on a fake driver, then prompts. */
export async function runTurn(
   reports: ToolCallReport[],
   options: { cx?: Cx; [key: string]: any } = {},
) {
   const { cx = createCx(), ...overrides } = options;
   const fake = createFakeGovernedDriver();
   fake.script(reports);
   const made = makeAgent({ driver: fake.driver, ...overrides });
   const s    = await made.agent.newSession(newSessionArgs());
   await made.agent.prompt({ sessionId: s.sessionId, ...textParam('go') }, cx);
   return { ...made, fake, cx, sessionId: s.sessionId };
}

/** Every way an approval can end in a deny, with the outcome entry it logs. */
export const denials: Array<[string, () => Cx, Record<string, unknown>]> = [
   ['the user rejects',
      () => createCx({ permission: reject }),
      { action: 'deny', answeredBy: 'user' }],
   ['the IDE answers cancelled',
      () => createCx({ permission: { outcome: 'cancelled' } }),
      { action: 'deny', answeredBy: 'user', reason: 'cancelled' }],
   ['the IDE answers with nothing',
      () => createCx({ respond: () => undefined }),
      { action: 'deny', answeredBy: 'failure', reason: 'invalid_answer' }],
   ['the IDE answers with an error response',
      () => createCx({ respond: () => ({ error: { code: -32603, message: 'SECRET-ERR' } }) }),
      { action: 'deny', answeredBy: 'failure', reason: 'invalid_answer' }],
   ['the IDE selects an unknown option',
      () => createCx({ permission: { outcome: 'selected', optionId: 'weird' } }),
      { action: 'deny', answeredBy: 'failure', reason: 'invalid_answer' }],
   ['the IDE selects no option',
      () => createCx({ permission: { outcome: 'selected' } }),
      { action: 'deny', answeredBy: 'failure', reason: 'invalid_answer' }],
   ['the approval request throws',
      () => createCx({ respond: () => { throw new Error('SECRET-ERR lost connection'); } }),
      { action: 'deny', answeredBy: 'failure', reason: 'ask_failed' }],
   ['the detail update fails',
      () => createCx({ failDetail: true }),
      { action: 'deny', answeredBy: 'failure', reason: 'ask_failed' }],
];
