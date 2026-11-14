import { expect } from 'vitest';
import { createAgent } from '../agent/index.js';
import { utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionStore } from '../session-store.js';
import { createGovernanceEngine } from '../../governance/engine.js';
import {
   type FakeStep, createFakeGovernedDriver, say,
} from '../../drivers/__tests__/fake-governed-driver.js';
import { DriverNotInCatalogError } from '../../drivers/errors.js';
import type { DriverCatalog } from '../../drivers/driver-catalog.js';
import {
   gateToolCall,
   type DriverResult, type ExecuteOptions, type ToolCallDecision, type ToolCallOutcome,
   type ToolCallReport, type TurnEnd, type TurnUpdate,
} from '../../drivers/governed-driver.js';
import type { DispatchResult, DispatchSubstitution } from '../../modelResolver/types.js';
import { makeDriver } from '../../drivers/acp-driver-core/__tests__/acp-driver.helpers.js';
import { SESSION } from '../../drivers/acp-driver-core/__tests__/permissions.helpers.js';
import type { UnsafeSetting } from '../../drivers/acp-driver-core/types.js';
import { HANDOFF_PATH, MESSAGE_PATH, STATUS_DIR, parseProfileNames } from '../workflow-command.js';
import { writeFile } from '../../drivers/__tests__/catalog-fixtures.js';
import { PROFILE_FIXTURE } from './profile-fixtures.js';

export { SESSION };

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
   const holds = new Map<number, Deferred<void>>();
   let notifications = 0;
   let failing: { from: number; how: 'rejects' | 'throws' } | undefined;
   return {
      calls,
      /** Holds the Nth notification (0-based) once recorded; the returned function releases it. */
      holdNotify: (n: number) => {
         const held = deferred();
         holds.set(n, held);
         return () => held.resolve();
      },
      /** Makes the Nth notification (0-based) and every later one fail with `SECRET-ERR`. */
      failNotify: (from: number, how: 'rejects' | 'throws' = 'rejects') => {
         failing = { from, how };
      },
      notify: (method: string, params: any): Promise<void> | undefined => {
         const n = notifications++;
         calls.push({ kind: 'notify', method, params });
         if (failDetail && isAskDetail(params?.update)) {
            return Promise.reject(new Error('connection lost'));
         }
         if (undefined !== failing && n >= failing.from) {
            if ('throws' === failing.how) { throw new Error('SECRET-ERR'); }
            return Promise.reject(new Error('SECRET-ERR'));
         }
         return holds.get(n)?.promise;
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
   const released: string[] = [];
   const spy = {
      seen,
      /** The ids `release` was called with, in order. */
      released,
      /** Runs after a release records its id. A test replaces it to hold or fail the release. */
      onRelease: async (_id: string): Promise<void> => {},
      name:                       name,
      supportsToolCallGovernance: true,
      execute: async (command: string, options: any = {}) => {
         seen.push({ command, options });
         if ('function' === typeof result) { return result(command, options); }
         return result;
      },
      close: async () => {},
      release: async (id: string): Promise<void> => { released.push(id); await spy.onRelease(id); },
   };
   return spy;
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

/** The answer a resolver gives: the driver, a model (default auto), and where it came from. */
export const resolved = (
   driver: string, model = 'auto', source: DispatchResult['source'] = 'registry-default',
   substitution?: DispatchSubstitution,
): DispatchResult =>
   ({ driver, model, source, ...(undefined !== substitution ? { substitution } : {}) });

/**
 * A resolver whose answer to the Nth call (0-based) the test scripts: a result,
 * or an error to throw. The answer is given the call number and the profile asked for.
 * It records the profile argument of every call.
 */
export function createResolverStub(answer: (call: number, profile?: string) => DispatchResult | Error)
{
   const calls: Array<string | undefined> = [];
   return {
      calls,
      resolve(profile?: string): DispatchResult {
         const made = answer(calls.length, profile);
         calls.push(profile);
         if (made instanceof Error) { throw made; }
         return made;
      },
   };
}

/**
 * Drivers "alpha" and "beta" behind one catalog, and a resolver that answers the
 * given (driver, model) pairs in turn, the last one for every later call.
 */
export function twoDrivers(...answers: Array<[string, string]>)
{
   const alpha    = createDriverSpy({ text: 'a', sessionId: 'a-1' }, 'alpha');
   const beta     = createDriverSpy({ text: 'b', sessionId: 'b-1' }, 'beta');
   const resolver = createResolverStub(call => resolved(...answers[Math.min(call, answers.length - 1)]));
   const made     = makeAgent({ catalog: catalogOf({ alpha, beta }), resolver });
   return { ...made, alpha, beta };
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
   const profileNames = overrides.profileNames ?? parseProfileNames(PROFILE_FIXTURE, 'fixture');
   // Default: a folder that does not exist, so no changeover file is ever found.
   const workDir = overrides.workDir ?? join(tmpdir(), 'acp-test-no-work-dir');
   const agent = createAgent({
      catalog, resolver, sessionStore, logger, governance, profileNames,
      workDir, protocolVersion: PROTOCOL_VERSION,
   });
   // Most tests operate on an initialized boundary. `initialize` flips the
   // internal flag synchronously (before its first await), so the guard tests
   // that pass `init: false` reliably observe an un-initialized agent.
   if (false !== overrides.init) { void agent.initialize({ protocolVersion: PROTOCOL_VERSION }); }
   return { agent, driver, catalog, resolver, logger, sessionStore, governance, profileNames, workDir };
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
/** The updates that carry ask specifics: the detail on a card, or the card of its own. */
export const detailsOf  = (cx: Cx) => cx.calls.filter(c => isAskDetail(c.params?.update));
export const eventsOf   = (logger: { entries: LogEntry[] }, event: string) =>
   logger.entries.filter(e => event === e.event);

/** A changeover file under `dir` naming `profile` under `## To`. */
export const changeover = (path: string, profile: string, dir: string) =>
   writeFile(join(dir, path), `# Changeover\n\n## To\n${profile}\n\n## From\nBuilder\n`);

/**
 * What the client was sent, one entry per call: `text:<t>`, `card:<id>` (a `tool_call`),
 * `detail:<id>` (a `tool_call_update` that carries ask specifics), `update:<id>` and
 * `request:<id>`. `-` stands for no id.
 */
export function traceOf(cx: Cx): string[] {
   return cx.calls.map(call => {
      if ('session/request_permission' === call.method) {
         return `request:${call.params.toolCall?.toolCallId ?? '-'}`;
      }
      const update = call.params.update;
      if ('agent_message_chunk' === update?.sessionUpdate) { return `text:${update.content.text}`; }
      const id = update?.toolCallId ?? '-';
      if ('tool_call' === update?.sessionUpdate) { return `card:${id}`; }
      return isAskDetail(update) ? `detail:${id}` : `update:${id}`;
   });
}

/** Whether an update carries the specifics of an ask (the service adds `agentTitle` to them). */
export function isAskDetail(update: any): boolean {
   const raw = update?.rawInput;
   return 'object' === typeof raw && null !== raw && 'agentTitle' in raw;
}

/** The ids of the cards (`tool_call` updates) the client was sent, in order. */
export const cardIds = (cx: Cx): string[] => cx.calls
   .map(c => c.params?.update)
   .filter(update => 'tool_call' === update?.sessionUpdate)
   .map(update => update.toolCallId);

/** Every update the client was sent for one card id, in order. */
export const updatesOf = (cx: Cx, id: string): any[] =>
   cx.calls.map(c => c.params?.update).filter(update => id === update?.toolCallId);

/** The last update for the card that set a title; after a decision, the outcome. */
export function lastTitled(cx: Cx, id: string): any {
   const titled = updatesOf(cx, id).filter(update => undefined !== update.title);
   return titled[titled.length - 1];
}

/** `traceOf` with the i-th distinct card id (in order of first sight) named `names[i]`. */
export function namedTrace(cx: Cx, names: string[]): string[] {
   const seen: string[] = [];
   return traceOf(cx).map(entry => {
      const [kind, ...rest] = entry.split(':');
      const id = rest.join(':');
      if ('text' === kind || '-' === id) { return entry; }
      if (!seen.includes(id)) { seen.push(id); }
      return `${kind}:${names[seen.indexOf(id)] ?? id}`;
   });
}

export type ScriptStep =
   | FakeStep
   | { step: 'wait'; label: string }
   | { step: 'act'; fn: () => unknown }
   | { step: 'throw'; error: unknown };
export const wait   = (label: string): ScriptStep => ({ step: 'wait', label });
/** Runs `fn` inside the turn at this point, for example to write a file the turn would write. */
export const act    = (fn: () => unknown): ScriptStep => ({ step: 'act', fn });
export const throws = (error: unknown): ScriptStep => ({ step: 'throw', error });

const whenAborted = (signal?: AbortSignal) => new Promise<void>(resolve => {
   if (undefined === signal) { return; }
   if (signal.aborted) { resolve(); return; }
   signal.addEventListener('abort', () => resolve(), { once: true });
});

/**
 * A driver that plays one queued script per `execute`. Steps are those of the fake governed
 * driver (`say`, `call`, `update`, `gate`, `end`) plus `wait(label)`, which halts the turn
 * until `release(label)` or the abort, `act(fn)`, and `throws(error)`. `overrides` replace fields of the
 * result. `seen` keeps every call's options, so a test can drive `onUpdate` and `onToolCall`
 * itself, or late (`lateUpdate`).
 */
export function createScriptedDriver(name = 'scripted') {
   const seen:      Array<{ command: string; options: ExecuteOptions }> = [];
   const queue:     Array<{ steps: ScriptStep[]; overrides: Partial<DriverResult> }> = [];
   const decisions: ToolCallDecision[] = [];
   const released:  string[] = [];
   const marks = new Map<string, { reached: Deferred<void>; released: Deferred<void> }>();
   const markOf = (label: string) => {
      if (!marks.has(label)) { marks.set(label, { reached: deferred(), released: deferred() }); }
      return marks.get(label)!;
   };
   const driver = {
      name,
      supportsToolCallGovernance: true,
      async execute(command: string, options: ExecuteOptions = {}): Promise<DriverResult> {
         seen.push({ command, options });
         const { steps, overrides } = queue.shift() ?? { steps: [], overrides: {} };
         const said: string[] = [];
         const toolCalls: ToolCallOutcome[] = [];
         let ended: TurnEnd | undefined;
         const finish = (extra: Partial<DriverResult>): DriverResult => ({
            text: said.join(''), sessionId: 'scripted-sess', toolCalls, ...extra, ...overrides,
         });
         for (const item of steps) {
            if (options.signal?.aborted) { return finish({ cancelled: true }); }
            if ('say' === item.step) {
               said.push(item.text);
               options.onUpdate?.({ type: 'text', text: item.text });
            }
            else if ('call' === item.step || 'update' === item.step) {
               const { step, ...fields } = item;
               options.onUpdate?.({ type: 'tool_call', ...fields });
            }
            else if ('gate' === item.step) {
               const decision = await gateToolCall(options, item.report);
               decisions.push(decision);
               toolCalls.push({ report: item.report, decision });
            }
            else if ('end' === item.step) { ended = item.reason; }
            else if ('wait' === item.step) {
               const mark = markOf(item.label);
               mark.reached.resolve();
               await Promise.race([mark.released.promise, whenAborted(options.signal)]);
            }
            else if ('act' === item.step) { await item.fn(); }
            else { throw item.error; }
         }
         if (options.signal?.aborted) { return finish({ cancelled: true }); }
         return finish(undefined === ended ? {} : { end: ended });
      },
      close: async () => {},
      release: async (id: string): Promise<void> => { released.push(id); await handle.onRelease(id); },
   };
   const handle = {
      driver,
      seen,
      decisions,
      /** The ids `release` was called with, in order. */
      released,
      /** Runs after a release records its id. A test replaces it to hold or fail the release. */
      onRelease: async (_id: string): Promise<void> => {},
      script: (steps: ScriptStep[], overrides: Partial<DriverResult> = {}) => {
         queue.push({ steps, overrides });
      },
      reached: (label: string) => markOf(label).reached.promise,
      release: (label: string) => markOf(label).released.resolve(),
      /** Calls the `onUpdate` of the nth `execute`, as a driver would that kept it too long. */
      lateUpdate: (update: TurnUpdate, n = 0) => seen[n].options.onUpdate?.(update),
   };
   return handle;
}

/**
 * A chat for the automated changeover process. `routes` maps each profile to a driver name, or to
 * `[driver, model]`; there is one scripted driver for each name, under `scripted`. The resolver
 * answers by profile. `commands` lists every command any driver received, in order.
 * `writeHandoff` writes the handoff file under `dir` naming a profile, with a modification time
 * `offset` ms from now (ahead by default, so it is fresh whatever the clock grain).
 * `writeStatus` writes the `ready` status file of a profile that hands off to `to`, dated the same way.
 * `writeMessage` writes the message file under `dir` naming a profile, dated the same way.
 */
export function loopRig(
   { routes, dir, ...overrides }:
      { routes: Record<string, string | [string, string]>; dir: string; [key: string]: any },
) {
   const names = [...new Set(Object.values(routes).map(route => 'string' === typeof route ? route : route[0]))];
   const scripted: Record<string, ReturnType<typeof createScriptedDriver>> = {};
   const commands: string[] = [];
   for (const name of names) {
      const each = createScriptedDriver(name);
      const run  = each.driver.execute.bind(each.driver);
      each.driver.execute = (command, options) => { commands.push(command); return run(command, options); };
      scripted[name] = each;
   }
   const resolver = createResolverStub((_call, profile) => {
      if (undefined === profile) { return resolved(names[0]); }
      const route = routes[profile];
      if (undefined === route) { return new Error(`no route for ${profile}`); }
      return 'string' === typeof route ? resolved(route) : resolved(route[0], route[1]);
   });
   const catalog = catalogOf(Object.fromEntries(names.map(name => [name, scripted[name].driver])));
   const made    = makeAgent({ catalog, resolver, workDir: dir, ...overrides });
   const writeHandoff = (profile: string, offset?: number) => handoffFile(dir, profile, offset);
   const writeStatus  = (profile: string, to: string, offset?: number) => readyFile(dir, profile, to, {}, offset);
   const writeMessage = (profile: string, offset?: number) => messageFile(dir, profile, offset);
   return { ...made, scripted, commands, writeHandoff, writeStatus, writeMessage };
}

/**
 * Writes the handoff file under `dir` naming `profile`, with a modification time `offset` ms from
 * now: ahead by default, so it counts as written during the turn whatever the clock grain.
 */
export function handoffFile(dir: string, profile: string, offset = 5000): string
{
   const file    = changeover(HANDOFF_PATH, profile, dir);
   const seconds = (Date.now() + offset) / 1000;
   utimesSync(file, seconds, seconds);
   return file;
}

/** Writes the message file under `dir` naming `profile`, dated as `handoffFile` is. */
export function messageFile(dir: string, profile: string, offset = 5000): string
{
   const file    = changeover(MESSAGE_PATH, profile, dir);
   const seconds = (Date.now() + offset) / 1000;
   utimesSync(file, seconds, seconds);
   return file;
}

/**
 * Writes `content` as `fileName` in the status folder under `dir` (text, or an object as the
 * profiles write a status file), with a modification time `offset` ms from now: ahead by
 * default, as `handoffFile`.
 */
export function statusFile(dir: string, fileName: string, content: string | object, offset = 5000): string
{
   const text    = 'string' === typeof content ? content : `${JSON.stringify(content, null, 2)}\n`;
   const file    = writeFile(join(dir, STATUS_DIR, fileName), text);
   const seconds = (Date.now() + offset) / 1000;
   utimesSync(file, seconds, seconds);
   return file;
}

/** A valid `ready` file of `profile` that hands off to `to`; `overrides` replace top-level fields. */
export function readyFile(
   dir: string, profile: string, to: string, overrides: Record<string, unknown> = {}, offset?: number,
): string
{
   const content = {
      schema: 1, profile, workflowId: 'wf-test', status: 'ready', next: { command: 'handoff', to }, ...overrides,
   };
   return statusFile(dir, `${profile}-wf-test.json`, content, offset);
}

export type LoopRig = ReturnType<typeof loopRig>;

/** Planner and PromptEngineer and Architect on alpha, Enforcer and Doctor on beta. */
export const loopRoutes: Record<string, string | [string, string]> = {
   Planner:        ['alpha', 'm1'],
   PromptEngineer: ['alpha', 'm1'],
   Architect:      ['alpha', 'm1'],
   Enforcer:       ['beta',  'm2'],
   Doctor:         ['beta',  'm2'],
};
export const allOnAlpha = Object.fromEntries(Object.keys(loopRoutes).map(name => [name, 'alpha']));

/** The completion line a profile writes when it suggests one handoff. */
export const nextLine = (profile: string) => `**Next**: Run \`@handoff to=${profile}\``;

export const openChat = async (rig: LoopRig) => (await rig.agent.newSession(newSessionArgs())).sessionId;
export const sendPrompt = (rig: LoopRig, sessionId: string, text: string, cx: Cx = createCx()) =>
   rig.agent.prompt({ sessionId, ...textParam(text) }, cx);

/** A turn that writes the handoff file naming `profile`, then says it did. */
export const handoffTurn = (rig: LoopRig, profile: string) =>
   [act(() => rig.writeHandoff(profile)), say('Handoff written.')];

/** A turn in which `from` marks itself ready, then suggests `to`, as a profile does when its work is done. */
export const suggests = (rig: LoopRig, from: string, to: string) =>
   [act(() => rig.writeStatus(from, to)), say(nextLine(to))];

/** The completion line a profile writes when it suggests one send. */
export const sendLine = (profile: string) => `**Next**: Run \`@send to=${profile}\``;

/** A turn in which `from` marks itself ready for a send to `to`, then suggests it. */
export const suggestsSend = (rig: LoopRig, from: string, to: string) => [
   act(() => readyFile(rig.workDir, from, to, { next: { command: 'send', to } })),
   say(sendLine(to)),
];

/** The turn after `@send to=<to>`: `from` writes the message file naming `to`, marks itself waiting, says so. */
export const sendTurn = (rig: LoopRig, from: string, to: string) => [
   act(() => {
      rig.writeMessage(to);
      readyFile(rig.workDir, from, to, { status: 'waiting', next: undefined });
   }),
   say('Message written.'),
];

/** The last turn of a side trip: `profile` marks itself complete with no next, and says to return to `source`. */
export const closesTrip = (rig: LoopRig, profile: string, source: string) => [
   act(() => readyFile(rig.workDir, profile, source, { status: 'complete', next: undefined })),
   say(`Close this tab and return to ${source}.`),
];

/**
 * A side trip on beta, where Enforcer and Doctor run. Enforcer suggests a send to Doctor and writes the
 * message; Doctor plays `sideTurns` one after another in the driver session `side`; Enforcer plays `back`
 * after the return. Enforcer's turns run in the driver session `enf-1`, so the sessions are told apart.
 */
export function scriptSideTrip(
   rig: LoopRig, sideTurns: ScriptStep[][], back: ScriptStep[] = [say('Resumed.')], side = 'doc-1',
)
{
   const { beta } = rig.scripted;
   beta.script(suggestsSend(rig, 'Enforcer', 'Doctor'), { sessionId: 'enf-1' });
   beta.script(sendTurn(rig, 'Enforcer', 'Doctor'), { sessionId: 'enf-1' });
   for (const turn of sideTurns) { beta.script(turn, { sessionId: side }); }
   beta.script(back, { sessionId: 'enf-1' });
}

/** Doctor's status file, written as `readyFile` writes one, with `overrides`. */
export const doctorFile = (rig: LoopRig, overrides: Record<string, unknown>, offset?: number) =>
   readyFile(rig.workDir, 'Doctor', 'Enforcer', overrides, offset);

/** A turn of Doctor that leaves its file `waiting` and asks the user a question. */
export const asks = (rig: LoopRig): ScriptStep[] => [
   act(() => doctorFile(rig, { status: 'waiting', next: undefined })),
   say('Which file do you mean?'),
];

/**
 * The trip of `scriptSideTrip` is still open: the side profile runs in the session `running` (none
 * when its turn threw before the driver named one), the main one is parked, nothing was released.
 */
export function expectOpen(rig: LoopRig, sessionId: string, running: string | null = 'doc-1')
{
   const record = rig.sessionStore.get(sessionId);
   expect(rig.scripted.beta.released).toEqual([]);
   expect(record?.profile).toBe('Doctor');
   expect(record?.driverSessionId ?? null).toBe(running);
   expect(record?.parked?.driverSessionId).toBe('enf-1');
}

/**
 * How Planner's status file can fail to confirm a handoff to Enforcer, by outcome. Each entry leaves the
 * status folder under `dir` in that state; run it inside the Planner turn that suggests Enforcer.
 */
export const unconfirmed: Array<[string, (rig: LoopRig, dir: string) => void]> = [
   ['missing',   () => {}],
   ['stale',     rig => { rig.writeStatus('Planner', 'Enforcer', -60_000); }],
   ['ambiguous', (rig, dir) => {
      rig.writeStatus('Planner', 'Enforcer');
      statusFile(dir, 'Planner-wf-b.json', 'not json');
   }],
   ['invalid',   (_rig, dir) => { statusFile(dir, 'Planner-wf-test.json', 'not json'); }],
   ['not_ready', (_rig, dir) => {
      readyFile(dir, 'Planner', 'Enforcer', { status: 'started', next: undefined });
   }],
   ['mismatch',  rig => { rig.writeStatus('Planner', 'Architect'); }],
];

/** Scripts a chain on one driver: each profile suggests the next; each handoff turn writes the file. */
export function scriptChain(rig: LoopRig, driver: string, names: string[])
{
   names.forEach((name, at) => {
      const target = names[at + 1];
      const turn   = undefined === target ? `${name} is done.` : `${name} works.\n\n${nextLine(target)}`;
      const ready  = undefined === target ? [] : [act(() => rig.writeStatus(name, target))];
      rig.scripted[driver].script([...ready, say(turn)]);
      if (undefined !== target) { rig.scripted[driver].script(handoffTurn(rig, target)); }
   });
}

/**
 * Planner (session p-1) marks itself ready, suggests Enforcer and writes the handoff; Enforcer
 * (session e-1) answers.
 */
export function plannerToEnforcer(rig: LoopRig, enforcerOn: string)
{
   rig.scripted.alpha.script(suggests(rig, 'Planner', 'Enforcer'), { sessionId: 'p-1' });
   rig.scripted.alpha.script(handoffTurn(rig, 'Enforcer'), { sessionId: 'p-1' });
   rig.scripted[enforcerOn].script([say('Reviewed.')], { sessionId: 'e-1' });
}

/** Holds the release of alpha's session. `reached` settles when it was asked; `hold` lets it go. */
export function holdRelease(rig: LoopRig)
{
   const reached = deferred();
   const hold    = deferred();
   rig.scripted.alpha.onRelease = async () => { reached.resolve(); await hold.promise; };
   return { reached: reached.promise, hold };
}

/** Plays one scripted turn on a new chat, waits for it, and returns the chat and the driver. */
export async function playScript(
   steps: ScriptStep[], options: { cx?: Cx; [key: string]: any } = {},
) {
   const scripted = createScriptedDriver();
   scripted.script(steps);
   const made = await begin(scripted.driver, options);
   await made.turn;
   return { ...made, scripted };
}

/**
 * A driver that announces each id as a card, then asks governance about all of them at once.
 * `decided` holds the decisions, in the order of `ids`, once the turn has ended.
 */
export function createOpenAsksDriver(ids: string[]) {
   const decided: ToolCallDecision[] = [];
   const driver = createDriverSpy(async (_command: string, options: any) => {
      for (const id of ids) {
         options.onUpdate?.({ type: 'tool_call', id, kind: 'edit', title: `Edit ${id}` });
      }
      decided.push(...await Promise.all(
         ids.map(id => options.onToolCall({ ...editReport, id, title: `Edit ${id}` })),
      ));
      return { text: '', sessionId: 'drv', toolCalls: [] };
   });
   return { driver, decided };
}

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

export const textsIn = (cx: Cx) =>
   traceOf(cx).filter(entry => entry.startsWith('text:')).map(entry => entry.slice(5));

/** Opens a session over `driver` and starts its turn without awaiting it. */
export async function begin(
   driver: any,
   { cx = createCx(), ...overrides }: { cx?: Cx; [key: string]: any } = {},
) {
   const made    = makeAgent({ driver, ...overrides });
   const started = await startTurn(made.agent, cx);
   return { ...made, ...started, cx };
}

/** Whether the promise has settled, either way. */
export function watch(turn: Promise<unknown>) {
   const state = { done: false };
   void turn.then(() => { state.done = true; }, () => { state.done = true; });
   return state;
}

/** A driver that cannot stream: it returns `text` and whatever else `extra` sets. */
export const plain = (text: string, extra: object = {}) =>
   createDriverSpy({ text, sessionId: 'drv-1', toolCalls: [], ...extra });

/** An `agent_message_chunk` notification as the fake ACP agent sends it. */
export const agentSays = (text: string, sessionId = SESSION) => ({
   sessionId,
   update:    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
});

/**
 * The service over the real driver core and a fake ACP agent. A test scripts the agent's turns
 * with `downstream.respond('session/prompt', ...)`; `agents` is how many fake agents the core
 * can start (`downstreams`, in start order). `done` closes the driver.
 */
export function overRealCore(
   { settings, notice, agents = 1, workDir }:
      { settings?: UnsafeSetting[]; notice?: string; agents?: number; workDir?: string } = {},
) {
   const core       = makeDriver(agents, undefined, undefined, settings);
   const downstream = core.agents[0];
   // A real agent exits when its input ends.
   for (const each of core.agents) {
      const closeStdin = each.handle.closeStdin;
      each.handle.closeStdin = () => { closeStdin(); each.exit(0); };
   }
   const service = makeAgent({
      driver: core.driver, catalog: oneDriverCatalog(core.driver, notice), workDir,
   });
   return {
      ...service, downstream, downstreams: core.agents, done: () => core.driver.close(),
   };
}
