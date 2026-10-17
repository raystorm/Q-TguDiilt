import { describe, it, expect, vi } from 'vitest';
import { createAgent } from '../agent.js';
import { createSessionStore } from '../session-store.js';
import { createGovernanceEngine } from '../../governance/engine.js';
import { createFakeGovernedDriver } from '../../drivers/__tests__/fake-governed-driver.js';
import type { ToolCallReport } from '../../drivers/governed-driver.js';
import {
   TurnInProgressError,
   ProviderQuotaError,
   ProviderAuthError,
   SessionCollapseError,
   DriverGovernanceUnsupportedError,
} from '../errors.js';

const PROTOCOL_VERSION = 1;

interface LogEntry { level: string; event: string; data: any }

/**
 * Records the ordered stream of outbound client calls the agent makes
 * through the ACP context: session/update notifications and
 * session/request_permission requests. `permission` decides how the
 * client answers a request_permission call.
 */
function createCx(
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

function createDriverSpy(result: any = { text: 'ok', sessionId: 'drv-sess' })
{
   const seen: Array<{ command: string; options: any }> = [];
   return {
      seen,
      name:                       'fake',
      supportsToolCallGovernance: true,
      execute: async (command: string, options: any = {}) => {
         seen.push({ command, options });
         if ('function' === typeof result) { return result(command, options); }
         return result;
      },
   };
}

function createLogger()
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

interface Deferred<T> {
   promise: Promise<T>;
   resolve: (value: T) => void;
   reject:  (reason?: unknown) => void;
}

function deferred<T = void>(): Deferred<T>
{
   let resolve!: (value: T) => void;
   let reject!:  (reason?: unknown) => void;
   const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
   return { promise, resolve, reject };
}

/** Lets already-settled promises react, without timers. */
async function flush()
{
   for (let i = 0; i < 20; i++) { await Promise.resolve(); }
}

/**
 * A driver whose turns end only when the test releases them, so a test can
 * cancel, prompt again or disconnect while a turn is in flight. It ignores
 * the signal, like a driver that does not support cancellation.
 */
function createHeldDriver()
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
async function startTurn(agent: ReturnType<typeof makeAgent>['agent'], cx: any = createCx(), text = 'go')
{
   const s    = await agent.newSession(newSessionArgs());
   const turn = agent.prompt({ sessionId: s.sessionId, ...textParam(text) }, cx);
   return { sessionId: s.sessionId, turn };
}

function makeAgent(overrides: any = {})
{
   const driver       = overrides.driver       ?? createDriverSpy();
   const logger       = overrides.logger       ?? createLogger();
   const sessionStore = overrides.sessionStore ??
      createSessionStore({ newWorkflowId: (() => { let n = 0; return () => `wf-${++n}`; })() });
   const governance = overrides.governance ?? createGovernanceEngine({
      config: { rules: overrides.rules ?? [], default: overrides.defaultAction ?? 'ask' },
      logger,
   });
   const agent = createAgent({ driver, sessionStore, logger, governance, protocolVersion: PROTOCOL_VERSION });
   // Most tests operate on an initialized boundary. `initialize` flips the
   // internal flag synchronously (before its first await), so the guard tests
   // that pass `init: false` reliably observe an un-initialized agent.
   if (false !== overrides.init) { void agent.initialize({ protocolVersion: PROTOCOL_VERSION }); }
   return { agent, driver, logger, sessionStore, governance };
}

function textParam(text: string)
{
   return { prompt: [{ type: 'text' as const, text }] };
}

/** SDK-conformant NewSessionRequest args for tests. */
function newSessionArgs()
{
   return { cwd: '/repo', mcpServers: [] };
}

// Group 1: Lifecycle -------------------------------------------------------

describe('Group 1 — connection & session lifecycle', () => {
   it('initialize returns the supported protocol version', async () => {
      const { agent } = makeAgent();
      const res = await agent.initialize({ protocolVersion: PROTOCOL_VERSION });
      expect(res.protocolVersion).toBe(PROTOCOL_VERSION);
   });

   it('newSession before initialize is rejected', async () => {
      const { agent } = makeAgent({ init: false });
      await expect(agent.newSession(newSessionArgs())).rejects.toThrow(/initialize/i);
   });

   it('prompt before initialize is rejected and does not call execute', async () => {
      const { agent, driver } = makeAgent({ init: false });
      const cx = createCx();
      await expect(
         agent.prompt({ sessionId: 'sess-x', ...textParam('q') }, cx),
      ).rejects.toThrow(/initialize/i);
      expect(driver.seen).toHaveLength(0);
   });

   it('session/new returns a sessionId and maps it to a workflowId', async () => {
      const { agent, sessionStore } = makeAgent();
      const res = await agent.newSession(newSessionArgs());
      expect(typeof res.sessionId).toBe('string');
      expect(sessionStore.get(res.sessionId)?.workflowId).toBeTruthy();
   });

   it('distinct sessions map to distinct workflows', async () => {
      const { agent, sessionStore } = makeAgent();
      const a = await agent.newSession(newSessionArgs());
      const b = await agent.newSession(newSessionArgs());
      const wa = sessionStore.get(a.sessionId)?.workflowId;
      const wb = sessionStore.get(b.sessionId)?.workflowId;
      expect(wa).not.toBe(wb);
   });

   it('session/load resumes a mapping for continuity', async () => {
      const { agent, sessionStore } = makeAgent();
      await agent.loadSession({ sessionId: 'sess-prev', workflowId: 'wf-prev' } as any);
      expect(sessionStore.get('sess-prev')?.workflowId).toBe('wf-prev');
   });

   it('disconnect releases all session mappings (no leaks)', async () => {
      const { agent, sessionStore } = makeAgent();
      const a = await agent.newSession(newSessionArgs());
      await agent.onDisconnect();
      expect(sessionStore.get(a.sessionId)).toBeUndefined();
   });
});

// Group 2: Translation seam ------------------------------------------------

describe('Group 2 — ACP <-> driver translation seam', () => {
   it('one prompt turn triggers exactly one execute call', async () => {
      const { agent, driver } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('do the thing') }, cx);
      expect(driver.seen).toHaveLength(1);
   });

   it('prompt text becomes the execute command', async () => {
      const { agent, driver } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('summarize repo') }, cx);
      expect(driver.seen[0].command).toContain('summarize repo');
   });

   it('driver text is returned as final response content', async () => {
      const driver    = createDriverSpy({ text: 'the answer', sessionId: 'drv-1' });
      const { agent } = makeAgent({ driver });
      const s   = await agent.newSession(newSessionArgs());
      const cx  = createCx();
      const res = await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx);
      const finalText = JSON.stringify(res).concat(JSON.stringify(cx.calls));
      expect(finalText).toContain('the answer');
   });

   it('driver sessionId is stored for continuity', async () => {
      const driver = createDriverSpy({ text: 'x', sessionId: 'continued-123' });
      const { agent, sessionStore } = makeAgent({ driver });
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx);
      expect(sessionStore.get(s.sessionId)?.driverSessionId).toBe('continued-123');
   });

   it('a resumed turn passes the stored driver sessionId as options.sessionId', async () => {
      const driver = createDriverSpy({ text: 'x', sessionId: 'drv-2' });
      const { agent } = makeAgent({ driver });
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('first') }, cx);
      await agent.prompt({ sessionId: s.sessionId, ...textParam('second') }, cx);
      expect(driver.seen[1].options.sessionId).toBe('drv-2');
   });

   it('omitted optionals stay undefined (never empty strings)', async () => {
      const { agent, driver } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx);
      expect(driver.seen[0].options.model).toBeUndefined();
      expect(driver.seen[0].options.sessionId).toBeUndefined();
   });
});

// Group 3: Streaming update-before-final -----------------------------------

describe('Group 3 — streaming: update before final', () => {
   it('emits at least one session/update before the final response', async () => {
      const { agent } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      const res = await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx);
      const updateCount = cx.calls.filter(c => 'session/update' === c.method).length;
      expect(updateCount).toBeGreaterThanOrEqual(1);
      expect(res.stopReason).toBe('end_turn');
   });

   it('a mid-turn error is surfaced as a thrown error (no hang)', async () => {
      const driver = createDriverSpy(() => { throw new Error('boom'); });
      const { agent } = makeAgent({ driver });
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      // The ACP stopReason enum has no 'error' value; failures surface as a
      // thrown error, which the SDK turns into a JSON-RPC error response.
      await expect(
         agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx),
      ).rejects.toThrow(/boom/);
   });
});

// Group 4: Ask — detail before approval -----------------------------------

describe('Group 4 — ask: detail before approval', () => {
   it('sends a detail session/update before the request_permission', async () => {
      const { agent } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.ask(
         { sessionId: s.sessionId },
         { command: 'rm -rf build', paths: ['/repo/build'], diff: '- old\n+ new' },
         cx,
      );
      const detailIdx  = cx.calls.findIndex(c => 'session/update'             === c.method);
      const approveIdx = cx.calls.findIndex(c => 'session/request_permission' === c.method);
      expect(detailIdx).toBeGreaterThanOrEqual(0);
      expect(approveIdx).toBeGreaterThan(detailIdx);
   });

   it('the detail message carries the full specifics', async () => {
      const { agent } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.ask(
         { sessionId: s.sessionId },
         { command: 'apply patch', paths: ['/repo/a.ts'], diff: '- a\n+ b' },
         cx,
      );
      const detail = cx.calls.find(c => 'session/update' === c.method);
      const blob   = JSON.stringify(detail?.params);
      expect(blob).toContain('apply patch');
      expect(blob).toContain('/repo/a.ts');
      expect(blob).toContain('+ b');
   });

   it('approval is correlated by session id', async () => {
      const { agent } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.ask({ sessionId: s.sessionId }, { command: 'x', paths: [] }, cx);
      const approve = cx.calls.find(c => 'session/request_permission' === c.method);
      expect(approve?.params.sessionId).toBe(s.sessionId);
   });

   it('denial reports a not-approved outcome; session stays usable', async () => {
      const { agent } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx({ permission: { outcome: 'selected', optionId: 'reject' } });
      const decision = await agent.ask({ sessionId: s.sessionId }, { command: 'x', paths: [] }, cx);
      expect(decision.approved).toBe(false);
      // session still present and can run another turn
      const cx2 = createCx();
      const res = await agent.prompt({ sessionId: s.sessionId, ...textParam('again') }, cx2);
      expect(res.stopReason).toBe('end_turn');
   });

   it('a cancelled ask fails safe as not-approved', async () => {
      const { agent } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx({ permission: { outcome: 'cancelled' } });
      const decision = await agent.ask({ sessionId: s.sessionId }, { command: 'x', paths: [] }, cx);
      expect(decision.approved).toBe(false);
   });
});

// Group 5: Concurrency (reject-with-retry) + cancel ------------------------

describe('Group 5 — concurrency: reject-with-retry', () => {
   it('a second turn while one is in flight is rejected with turn-in-progress', async () => {
      const { agent, sessionStore } = makeAgent();
      const s = await agent.newSession(newSessionArgs());
      // Simulate an in-flight turn.
      sessionStore.setActiveTurn(s.sessionId, true);
      const cx = createCx();
      await expect(
         agent.prompt({ sessionId: s.sessionId, ...textParam('second') }, cx),
      ).rejects.toBeInstanceOf(TurnInProgressError);
   });

   it('turn-in-progress is distinct from a transport/malformed error', () => {
      const err = new TurnInProgressError('sess-1');
      expect(err).toBeInstanceOf(TurnInProgressError);
      expect(err.retryable).toBe(true);
   });

   it('rejecting a second turn does not disturb the in-flight turn flag', async () => {
      const { agent, sessionStore } = makeAgent();
      const s = await agent.newSession(newSessionArgs());
      sessionStore.setActiveTurn(s.sessionId, true);
      const cx = createCx();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('second') }, cx).catch(() => {});
      expect(sessionStore.hasActiveTurn(s.sessionId)).toBe(true);
   });

   it('active-turn flag is cleared after a normal turn', async () => {
      const { agent, sessionStore } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx);
      expect(sessionStore.hasActiveTurn(s.sessionId)).toBe(false);
   });
});

describe('Group 5 — cancel is the only interrupt', () => {
   it('[H] cancel with an active turn aborts it and does not free the session', async () => {
      const held = createHeldDriver();
      const { agent, sessionStore } = makeAgent({ driver: held.driver });
      const { sessionId, turn }     = await startTurn(agent);
      await held.started(0);
      await agent.cancel({ sessionId });
      expect(held.driver.seen[0].options.signal.aborted).toBe(true);
      expect(sessionStore.hasActiveTurn(sessionId)).toBe(true);
      held.release(0);
      await turn;
   });

   it('cancel with no active turn is an idempotent no-op', async () => {
      const { agent, sessionStore } = makeAgent();
      const s = await agent.newSession(newSessionArgs());
      await expect(agent.cancel({ sessionId: s.sessionId })).resolves.not.toThrow();
      expect(sessionStore.hasActiveTurn(s.sessionId)).toBe(false);
   });
});

// Group 6: Errors & malformed input ----------------------------------------

describe('Group 6 — errors: no execute on rejected/malformed input', () => {
   it('prompt for an unknown session throws and does not call execute', async () => {
      const { agent, driver } = makeAgent();
      const cx = createCx();
      await expect(
         agent.prompt({ sessionId: 'ghost', ...textParam('q') }, cx),
      ).rejects.toThrow(/session/i);
      expect(driver.seen).toHaveLength(0);
   });

   it('prompt with no text content throws and does not call execute', async () => {
      const { agent, driver } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await expect(
         agent.prompt({ sessionId: s.sessionId, prompt: [] } as any, cx),
      ).rejects.toThrow();
      expect(driver.seen).toHaveLength(0);
   });
});

// Group 7: Provider outcomes -----------------------------------------------

describe('Group 7 — provider outcomes', () => {
   it('model refusal is a normal successful turn (not an error)', async () => {
      const driver = createDriverSpy({ text: 'I cannot help with that.', sessionId: 'drv' });
      const { agent } = makeAgent({ driver });
      const s   = await agent.newSession(newSessionArgs());
      const cx  = createCx();
      const res = await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx);
      expect(res.stopReason).toBe('end_turn');
   });

   it('quota/rate-limit surfaces a distinct, resumable error', async () => {
      const driver = createDriverSpy(() => { throw new ProviderQuotaError('rate limited'); });
      const { agent } = makeAgent({ driver });
      const s   = await agent.newSession(newSessionArgs());
      const cx  = createCx();
      await expect(
         agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx),
      ).rejects.toBeInstanceOf(ProviderQuotaError);
   });

   it('auth-required surfaces a distinct, resumable error', async () => {
      const driver = createDriverSpy(() => { throw new ProviderAuthError('login required'); });
      const { agent } = makeAgent({ driver });
      const s   = await agent.newSession(newSessionArgs());
      const cx  = createCx();
      await expect(
         agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx),
      ).rejects.toBeInstanceOf(ProviderAuthError);
   });

   it('turn-in-progress is classified as backpressure in logs', async () => {
      const { agent, sessionStore, logger } = makeAgent();
      const s = await agent.newSession(newSessionArgs());
      sessionStore.setActiveTurn(s.sessionId, true);
      const cx = createCx();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('second') }, cx).catch(() => {});
      const backpressure = logger.entries.find((e: LogEntry) => 'turn_in_progress' === e.event);
      expect(backpressure).toBeTruthy();
   });
});

// Group 8: Session collapse ------------------------------------------------

describe('Group 8 — session collapse: detect and surface', () => {
   it('surfaces a clear error and does not silently start fresh', async () => {
      const driver = createDriverSpy(() => { throw new SessionCollapseError('context window exceeded'); });
      const { agent } = makeAgent({ driver });
      const s   = await agent.newSession(newSessionArgs());
      const cx  = createCx();
      await expect(
         agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx),
      ).rejects.toBeInstanceOf(SessionCollapseError);
   });
});

// Group 9: Operational logging & no secrets --------------------------------

describe('Group 9 — operational logging', () => {
   it('logs session mapping with workflowId on connect', async () => {
      const { agent, logger } = makeAgent();
      const s   = await agent.newSession(newSessionArgs());
      const map = logger.entries.find((e: LogEntry) => 'session_mapped' === e.event);
      expect(map).toBeTruthy();
      expect(map?.data.sessionId).toBe(s.sessionId);
      expect(map?.data.workflowId).toBeTruthy();
   });

   it('logs disconnect', async () => {
      const { agent, logger } = makeAgent();
      await agent.newSession(newSessionArgs());
      agent.onDisconnect();
      expect(logger.entries.some((e: LogEntry) => 'disconnect' === e.event)).toBe(true);
   });

   it('errors are logged with context', async () => {
      const driver = createDriverSpy(() => { throw new ProviderAuthError('secret-token-xyz in message') });
      const { agent, logger } = makeAgent({ driver });
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx).catch(() => {});
      const errEntry = logger.entries.find((e: LogEntry) => 'error' === e.level);
      expect(errEntry).toBeTruthy();
   });

   it('never logs raw prompt text as a secret channel', async () => {
      const { agent, logger } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('SUPER_SECRET_PROMPT_BODY') }, cx);
      const leaked = logger.entries.some((e: LogEntry) => JSON.stringify(e.data).includes('SUPER_SECRET_PROMPT_BODY'));
      expect(leaked).toBe(false);
   });
});


// Group 10: Governed driver interface ---------------------------------------

describe('Group 10 — governed driver interface', () => {
   it('prompt awaits an async execute, then streams its text and stores the session id', async () => {
      let release!: (result: any) => void;
      const delayed = new Promise<any>(resolve => { release = resolve; });
      const driver  = createDriverSpy(() => delayed);
      const { agent, sessionStore } = makeAgent({ driver });
      const s    = await agent.newSession(newSessionArgs());
      const cx   = createCx();
      const turn = agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx);
      await vi.waitFor(() => expect(driver.seen).toHaveLength(1));
      expect(JSON.stringify(cx.calls)).not.toContain('late answer');
      release({ text: 'late answer', sessionId: 'drv-late', toolCalls: [] });
      await turn;
      expect(JSON.stringify(cx.calls)).toContain('late answer');
      expect(sessionStore.get(s.sessionId)?.driverSessionId).toBe('drv-late');
   });

   const unsupported = [
      { label: 'supportsToolCallGovernance false',
        base: { name: 'plain', supportsToolCallGovernance: false },
        shown: 'plain', logged: 'plain' },
      { label: 'supportsToolCallGovernance absent',
        base: { name: 'silent' },
        shown: 'silent', logged: 'silent' },
      { label: 'a legacy shape (sync execute, no name)',
        base: {},
        shown: 'an unnamed driver', logged: 'unnamed' },
   ];

   it.each(unsupported)('rejects a driver with $label before any work', async ({ base, shown, logged }) => {
      const executed: string[] = [];
      const driver = {
         ...base,
         execute: (command: string) => { executed.push(command); return { text: 'x', sessionId: 'y' }; },
      };
      const { agent, sessionStore, logger } = makeAgent({ driver });
      const s   = await agent.newSession(newSessionArgs());
      const cx  = createCx();
      const err = await agent
         .prompt({ sessionId: s.sessionId, ...textParam('SECRET_PROMPT_TEXT') }, cx)
         .then(() => undefined, (e: any) => e);
      expect(err).toBeInstanceOf(DriverGovernanceUnsupportedError);
      expect(err.message).toContain(shown);
      expect(err.message).toContain('cannot report tool calls');
      expect(err.message).toContain('supportsToolCallGovernance: true');
      expect(executed).toEqual([]);
      expect(cx.calls).toHaveLength(0);
      expect(sessionStore.hasActiveTurn(s.sessionId)).toBe(false);
      const errors = logger.entries.filter((e: LogEntry) => 'error' === e.level);
      expect(errors).toHaveLength(1);
      expect(errors[0].data.sessionId).toBe(s.sessionId);
      expect(errors[0].data.driver).toBe(logged);
      expect(JSON.stringify(errors[0].data)).not.toContain('SECRET_PROMPT_TEXT');
   });
});


// Groups 11-14: tool-call governance handler --------------------------------

const readReport: ToolCallReport = { kind: 'read', title: 'Read a.ts', paths: ['/repo/a.ts'] };
const editReport: ToolCallReport = {
   kind: 'edit', title: 'Edit a.ts', paths: ['/repo/a.ts'], diff: '- a\n+ b',
   rawInput: { path: '/repo/a.ts' },
};

const allow  = { outcome: 'selected', optionId: 'allow'  };
const reject = { outcome: 'selected', optionId: 'reject' };

type Cx = ReturnType<typeof createCx>;

const requestsOf = (cx: Cx) => cx.calls.filter(c => 'session/request_permission' === c.method);
const detailsOf  = (cx: Cx) => cx.calls.filter(c => 'tool_call' === c.params?.update?.sessionUpdate);
const eventsOf   = (logger: { entries: LogEntry[] }, event: string) =>
   logger.entries.filter(e => event === e.event);

/** Runs one governed turn: scripts `reports` on a fake driver, then prompts. */
async function runTurn(
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
const denials: Array<[string, () => Cx, Record<string, unknown>]> = [
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

describe('Group 11 — tool-call handler: supplied and answered', () => {
   it('[H] the handler is supplied on a first turn, a later turn and a resumed session', async () => {
      const { agent, driver } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('first') }, cx);
      await agent.prompt({ sessionId: s.sessionId, ...textParam('later') }, cx);
      await agent.loadSession({ sessionId: 'sess-prev', workflowId: 'wf-prev' } as any);
      await agent.prompt({ sessionId: 'sess-prev', ...textParam('resumed') }, cx);
      expect(driver.seen).toHaveLength(3);
      for (const call of driver.seen) { expect(typeof call.options.onToolCall).toBe('function'); }
   });

   it('[H] a rule-approved report runs without asking the user', async () => {
      const { fake, cx } = await runTurn([readReport], { rules: [{ kind: 'read', action: 'approve' }] });
      expect(fake.ran()).toEqual([readReport]);
      expect(requestsOf(cx)).toHaveLength(0);
      expect(detailsOf(cx)).toHaveLength(0);
   });

   it('[H] a rule-denied report does not run and the user is not asked', async () => {
      const { fake, cx } = await runTurn([editReport], { rules: [{ kind: 'edit', action: 'deny' }] });
      expect(fake.ran()).toEqual([]);
      expect(requestsOf(cx)).toHaveLength(0);
      expect(detailsOf(cx)).toHaveLength(0);
   });

   it('[H] ask: the detail is sent before the approval request, and allow runs the call', async () => {
      const { fake, cx } = await runTurn([editReport]);
      expect(fake.ran()).toEqual([editReport]);
      const detail   = cx.calls.findIndex(c => 'tool_call' === c.params?.update?.sessionUpdate);
      const approval = cx.calls.findIndex(c => 'session/request_permission' === c.method);
      expect(detail).toBeGreaterThanOrEqual(0);
      expect(approval).toBeGreaterThan(detail);
   });

   it.each(denials)('[H] ask, then %s: the call is denied and the turn completes', async (_name, makeCx) => {
      const cx = makeCx();
      const { fake } = await runTurn([editReport], { cx });
      expect(fake.ran()).toEqual([]);
   });

   it('[H] a failed detail update means no approval request is sent', async () => {
      const cx = createCx({ failDetail: true });
      await runTurn([editReport], { cx });
      expect(requestsOf(cx)).toHaveLength(0);
   });

   it('[H] a report missing what its kind needs is denied without asking', async () => {
      const { fake, cx } = await runTurn([{ kind: 'edit', title: 'Edit nothing' }], { defaultAction: 'approve' });
      expect(fake.ran()).toEqual([]);
      expect(requestsOf(cx)).toHaveLength(0);
      expect(detailsOf(cx)).toHaveLength(0);
   });

   it('[H] an allow is not remembered: the identical ask is asked again', async () => {
      const cx = createCx({ respond: (_params, index) => ({ outcome: 0 === index ? allow : reject }) });
      const { fake } = await runTurn([editReport, editReport, readReport], {
         cx, rules: [{ kind: 'read', action: 'approve' }],
      });
      expect(fake.ran()).toEqual([editReport, readReport]);
      expect(requestsOf(cx)).toHaveLength(2);
   });

   it('[H] concurrent asks stay separate', async () => {
      const gates: Array<(answer: unknown) => void> = [];
      const cx = createCx({ respond: () => new Promise(resolve => { gates.push(resolve); }) });
      const decided: string[] = [];
      const driver = createDriverSpy(async (_command: string, options: any) => {
         const [first, second] = await Promise.all([
            options.onToolCall({ ...editReport, title: 'first' }),
            options.onToolCall({ ...editReport, title: 'second' }),
         ]);
         decided.push(first, second);
         return { text: 'ok', sessionId: 'drv' };
      });
      const { agent } = makeAgent({ driver });
      const s    = await agent.newSession(newSessionArgs());
      const turn = agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx);
      await vi.waitFor(() => expect(gates).toHaveLength(2));
      gates[1]({ outcome: allow });   // the second ask is answered first
      gates[0]({ outcome: reject });
      await turn;
      expect(decided).toEqual(['deny', 'approve']);
   });

   it('asks carry the right session and do not share state across sessions', async () => {
      const answers: Record<string, string> = {};
      const driver = createDriverSpy(async (command: string, options: any) => {
         answers[command] = await options.onToolCall(editReport);
         return { text: 'ok', sessionId: `drv-${command}` };
      });
      const { agent } = makeAgent({ driver });
      const a   = await agent.newSession(newSessionArgs());
      const b   = await agent.newSession(newSessionArgs());
      const cxA = createCx({ permission: reject });
      const cxB = createCx({ permission: allow });
      await Promise.all([
         agent.prompt({ sessionId: a.sessionId, ...textParam('one') }, cxA),
         agent.prompt({ sessionId: b.sessionId, ...textParam('two') }, cxB),
      ]);
      expect(answers).toEqual({ one: 'deny', two: 'approve' });
      for (const [cx, s] of [[cxA, a], [cxB, b]] as const) {
         const scoped = [...detailsOf(cx), ...requestsOf(cx)];
         expect(scoped).toHaveLength(2);
         expect(scoped.every(c => s.sessionId === c.params.sessionId)).toBe(true);
      }
   });

   it('a turn with no tool calls returns its text and asks nothing', async () => {
      const { cx } = await runTurn([]);
      expect(JSON.stringify(cx.calls)).toContain('done');
      expect(requestsOf(cx)).toHaveLength(0);
      expect(detailsOf(cx)).toHaveLength(0);
   });
});

describe('Group 12 — governance evaluation error', () => {
   const failing = { evaluateToolCall: () => { throw new Error('evaluation blew up'); } };

   it('[H] falls back to ask through the normal flow, noting governance could not evaluate', async () => {
      const { fake, cx, logger } = await runTurn([editReport], { governance: failing });
      expect(fake.ran()).toEqual([editReport]);
      expect(JSON.stringify(detailsOf(cx))).toContain('could not evaluate');
      expect(eventsOf(logger, 'governance_decision')[0].data)
         .toMatchObject({ action: 'ask', reason: 'evaluation_error', kind: 'edit' });
   });

   it.each(denials)('[H] and when %s the call is denied', async (_name, makeCx) => {
      const { fake } = await runTurn([editReport], { cx: makeCx(), governance: failing });
      expect(fake.ran()).toEqual([]);
   });
});

describe('Group 13 — ask payload', () => {
   const detailOf = (cx: Cx) => detailsOf(cx)[0].params.update.rawInput;

   it('execute: the detail carries the full command', async () => {
      const command = 'rm -rf build && ls';
      const { cx } = await runTurn([{ kind: 'execute', title: 'Run', command }]);
      expect(detailOf(cx).command).toBe(command);
   });

   it('[H] an edit: paths, the whole diff and the raw request all reach the detail', async () => {
      const diff     = 'x'.repeat(100_000);
      const rawInput = { path: '/repo/a.ts', patch: diff };
      const { cx } = await runTurn([{ kind: 'edit', title: 'Edit', paths: ['/repo/a.ts'], diff, rawInput }]);
      expect(detailOf(cx).paths).toEqual(['/repo/a.ts']);
      expect(detailOf(cx).diff).toBe(diff);
      expect(detailOf(cx).rawInput).toEqual(rawInput);
   });

   it('the title never becomes the command', async () => {
      const { cx } = await runTurn([{ kind: 'fetch', title: 'rm -rf /' }]);
      expect(detailOf(cx).command).toBeUndefined();
      expect(detailsOf(cx)[0].params.update.title).toBe('Requested action');
      expect(detailOf(cx).agentTitle).toBe('rm -rf /');
   });

   it('a report with only kind and title still asks, showing both', async () => {
      const { cx } = await runTurn([{ kind: 'other', title: 'Switch mode' }]);
      expect(requestsOf(cx)).toHaveLength(1);
      expect(detailOf(cx)).toMatchObject({ kind: 'other', agentTitle: 'Switch mode' });
   });
});

describe('Group 14 — governance logging', () => {
   it('[H] an ask logs one decision entry and one outcome entry sharing ids', async () => {
      const { logger, sessionId } = await runTurn([editReport]);
      const decisions = eventsOf(logger, 'governance_decision');
      const outcomes  = eventsOf(logger, 'governance_outcome');
      expect(decisions).toHaveLength(1);
      expect(outcomes).toHaveLength(1);
      expect(decisions[0].data).toMatchObject({ action: 'ask', kind: 'edit', sessionId });
      expect(outcomes[0].data).toMatchObject({
         action: 'approve', answeredBy: 'user', sessionId, callId: decisions[0].data.callId,
      });
   });

   it('a rule-decided report logs a decision entry and no outcome entry', async () => {
      const { logger } = await runTurn([readReport], { rules: [{ kind: 'read', action: 'approve' }] });
      expect(eventsOf(logger, 'governance_decision')).toHaveLength(1);
      expect(eventsOf(logger, 'governance_outcome')).toHaveLength(0);
   });

   it('each report gets its own callId', async () => {
      const { logger } = await runTurn([readReport, readReport], { rules: [{ kind: 'read', action: 'approve' }] });
      const ids = eventsOf(logger, 'governance_decision').map(e => e.data.callId);
      expect(new Set(ids).size).toBe(2);
   });

   it.each(denials)('[H] ask, then %s: the outcome entry records it', async (_name, makeCx, expected) => {
      const { logger } = await runTurn([editReport], { cx: makeCx() });
      const outcomes = eventsOf(logger, 'governance_outcome');
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].data).toMatchObject(expected);
   });

   it('[H] secrets in the diff, raw request, title or IDE errors stay out of every entry', async () => {
      const report: ToolCallReport = {
         kind: 'edit', title: 'SECRET-TITLE', paths: ['/repo/a.ts'], diff: 'SECRET-DIFF',
         rawInput: { token: 'SECRET-RAW' },
      };
      for (const [, makeCx] of denials) {
         const { logger } = await runTurn([report], { cx: makeCx() });
         expect(JSON.stringify(logger.entries)).not.toContain('SECRET');
      }
   });
});

// Groups 15-19: turn cancel ---------------------------------------------------

describe('Group 15 — cancel: signal and wind-down', () => {
   it('[H] every turn gets its own signal, none aborted', async () => {
      const { agent, driver } = makeAgent();
      const a  = await agent.newSession(newSessionArgs());
      const b  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId: a.sessionId, ...textParam('first') }, cx);
      await agent.prompt({ sessionId: a.sessionId, ...textParam('later') }, cx);
      await agent.prompt({ sessionId: b.sessionId, ...textParam('other') }, cx);
      await agent.loadSession({ sessionId: 'sess-prev', workflowId: 'wf-prev' } as any);
      await agent.prompt({ sessionId: 'sess-prev', ...textParam('resumed') }, cx);
      const signals = driver.seen.map((call: any) => call.options.signal);
      expect(signals).toHaveLength(4);
      for (const signal of signals) {
         expect(signal).toBeInstanceOf(AbortSignal);
         expect(signal.aborted).toBe(false);
      }
      expect(new Set(signals).size).toBe(4);
   });

   it('[H] a second prompt during wind-down is rejected and nothing changes', async () => {
      const held = createHeldDriver();
      const { agent, sessionStore } = makeAgent({ driver: held.driver });
      const { sessionId, turn }     = await startTurn(agent);
      await held.started(0);
      await agent.cancel({ sessionId });
      const err = await agent.prompt({ sessionId, ...textParam('again') }, createCx())
         .then(() => undefined, (e: any) => e);
      expect(err).toBeInstanceOf(TurnInProgressError);
      expect(err.retryable).toBe(true);
      expect(held.driver.seen).toHaveLength(1);
      expect(sessionStore.hasActiveTurn(sessionId)).toBe(true);
      held.release(0);
      await turn;
   });

   it('[H] a rejected prompt does not replace the abort handle of the turn in flight', async () => {
      const held = createHeldDriver();
      const { agent }           = makeAgent({ driver: held.driver });
      const { sessionId, turn } = await startTurn(agent);
      await held.started(0);
      await agent.prompt({ sessionId, ...textParam('again') }, createCx()).catch(() => {});
      await agent.cancel({ sessionId });
      expect(held.driver.seen[0].options.signal.aborted).toBe(true);
      held.release(0);
      await turn;
   });

   it('[H] the session is freed only when the driver settles, then the next prompt is accepted', async () => {
      const held = createHeldDriver();
      const { agent, sessionStore } = makeAgent({ driver: held.driver });
      const { sessionId, turn }     = await startTurn(agent);
      await held.started(0);
      await agent.cancel({ sessionId });
      expect(sessionStore.hasActiveTurn(sessionId)).toBe(true);
      held.release(0);
      await turn;
      expect(sessionStore.hasActiveTurn(sessionId)).toBe(false);
      const next = agent.prompt({ sessionId, ...textParam('next') }, createCx());
      await held.started(1);
      expect(held.driver.seen[1].options.signal.aborted).toBe(false);
      held.release(1);
      await expect(next).resolves.toEqual({ stopReason: 'end_turn' });
   });

   it('[H] two turns never run at once', async () => {
      const held = createHeldDriver();
      const { agent }           = makeAgent({ driver: held.driver });
      const { sessionId, turn } = await startTurn(agent);
      await held.started(0);
      await agent.cancel({ sessionId });
      await expect(agent.prompt({ sessionId, ...textParam('two') }, createCx()))
         .rejects.toBeInstanceOf(TurnInProgressError);
      held.release(0);
      await turn;
      const third = agent.prompt({ sessionId, ...textParam('three') }, createCx());
      await held.started(1);
      await expect(agent.prompt({ sessionId, ...textParam('four') }, createCx()))
         .rejects.toBeInstanceOf(TurnInProgressError);
      held.release(1);
      await third;
      expect(held.driver.seen).toHaveLength(2);
      expect(held.peak()).toBe(1);
   });

   it('[H] a driver that ignores the signal keeps the session busy until it settles', async () => {
      const held = createHeldDriver();
      const { agent, sessionStore } = makeAgent({ driver: held.driver });
      const { sessionId, turn }     = await startTurn(agent);
      let settled = false;
      const tracked = turn.then(() => { settled = true; });
      await held.started(0);
      await agent.cancel({ sessionId });
      await flush();
      expect(settled).toBe(false);
      expect(sessionStore.hasActiveTurn(sessionId)).toBe(true);
      held.release(0);
      await tracked;
      expect(sessionStore.hasActiveTurn(sessionId)).toBe(false);
   });

   it('cancel twice is harmless and the turn settles once', async () => {
      const held = createHeldDriver();
      const { agent }           = makeAgent({ driver: held.driver });
      const { sessionId, turn } = await startTurn(agent);
      await held.started(0);
      await agent.cancel({ sessionId });
      await expect(agent.cancel({ sessionId })).resolves.toBeUndefined();
      held.release(0);
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
   });

   it('[H] a stale cancel does nothing', async () => {
      const { agent, driver } = makeAgent();
      const s = await agent.newSession(newSessionArgs());
      await agent.cancel({ sessionId: s.sessionId });   // no turn yet
      await agent.cancel({ sessionId: 'ghost' });       // unknown session
      await agent.prompt({ sessionId: s.sessionId, ...textParam('first') }, createCx());
      await agent.cancel({ sessionId: s.sessionId });   // the turn already settled
      await agent.prompt({ sessionId: s.sessionId, ...textParam('second') }, createCx());
      expect(driver.seen[0].options.signal.aborted).toBe(false);
      expect(driver.seen[1].options.signal.aborted).toBe(false);
   });

   it('[H] cancel is isolated to its session', async () => {
      const held = createHeldDriver();
      const { agent } = makeAgent({ driver: held.driver });
      const a = await startTurn(agent);
      await held.started(0);
      const b = await startTurn(agent);
      await held.started(1);
      await agent.cancel({ sessionId: a.sessionId });
      expect(held.driver.seen[0].options.signal.aborted).toBe(true);
      expect(held.driver.seen[1].options.signal.aborted).toBe(false);
      held.release(1);
      held.release(0);
      await expect(b.turn).resolves.toEqual({ stopReason: 'end_turn' });
      await expect(a.turn).resolves.toEqual({ stopReason: 'cancelled' });
   });

   it('[H] cancel before the driver is called hands it an already-aborted signal', async () => {
      const gate = deferred();
      const base = createCx();
      const cx   = {
         ...base,
         notify: async (method: string, params: any) => { await gate.promise; return base.notify(method, params); },
      };
      const { agent, driver }   = makeAgent();
      const { sessionId, turn } = await startTurn(agent, cx);
      await agent.cancel({ sessionId });
      gate.resolve();
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(driver.seen).toHaveLength(1);
      expect(driver.seen[0].options.signal.aborted).toBe(true);
   });

   it('a prompt rejected before it starts leaves no flag and no abort handle', async () => {
      const { agent, driver, sessionStore, logger } = makeAgent();
      const s = await agent.newSession(newSessionArgs());
      await expect(agent.prompt({ sessionId: s.sessionId, prompt: [] } as any, createCx())).rejects.toThrow();
      expect(sessionStore.hasActiveTurn(s.sessionId)).toBe(false);
      expect(sessionStore.get(s.sessionId)?.abort).toBeUndefined();
      await agent.cancel({ sessionId: s.sessionId });
      expect(eventsOf(logger, 'cancel_requested')).toHaveLength(0);
      await agent.prompt({ sessionId: s.sessionId, ...textParam('next') }, createCx());
      expect(driver.seen[0].options.signal.aborted).toBe(false);
   });

   it('an unsupported driver or an unknown session leaves nothing behind', async () => {
      const unsupported = {
         name: 'plain', supportsToolCallGovernance: false, execute: async () => ({ text: '', sessionId: '' }),
      };
      const { agent, sessionStore, logger } = makeAgent({ driver: unsupported });
      const s = await agent.newSession(newSessionArgs());
      await expect(agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, createCx()))
         .rejects.toBeInstanceOf(DriverGovernanceUnsupportedError);
      await expect(agent.prompt({ sessionId: 'ghost', ...textParam('q') }, createCx()))
         .rejects.toThrow(/session/i);
      expect(sessionStore.hasActiveTurn(s.sessionId)).toBe(false);
      expect(sessionStore.get(s.sessionId)?.abort).toBeUndefined();
      expect(sessionStore.get('ghost')).toBeUndefined();
      await agent.cancel({ sessionId: s.sessionId });
      await agent.cancel({ sessionId: 'ghost' });
      expect(eventsOf(logger, 'cancel_requested')).toHaveLength(0);
   });

   it('a turn that fails before the driver is called clears the flag and the abort handle', async () => {
      const cx = { ...createCx(), notify: async () => { throw new Error('connection lost'); } };
      const { agent, driver, sessionStore } = makeAgent();
      const s = await agent.newSession(newSessionArgs());
      await expect(agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx)).rejects.toThrow('connection lost');
      expect(driver.seen).toHaveLength(0);
      expect(sessionStore.hasActiveTurn(s.sessionId)).toBe(false);
      expect(sessionStore.get(s.sessionId)?.abort).toBeUndefined();
   });

   it('a notification failure after a cancel still surfaces as an error', async () => {
      const gate = deferred();
      const cx   = { ...createCx(), notify: async () => { await gate.promise; throw new Error('connection lost'); } };
      const { agent, sessionStore } = makeAgent();
      const { sessionId, turn }     = await startTurn(agent, cx);
      const outcome = turn.then(() => undefined, (e: any) => e);
      await agent.cancel({ sessionId });
      gate.resolve();
      expect((await outcome)?.message).toBe('connection lost');
      expect(sessionStore.hasActiveTurn(sessionId)).toBe(false);
   });
});

describe('Group 16 — cancel: result of a cancelled turn', () => {
   const cancelledResult = (extra: object = {}) =>
      ({ cancelled: true, text: 'partial', sessionId: 'drv-c', toolCalls: [], ...extra });

   it('[H] a cancelled result streams the partial text, returns cancelled and keeps the session usable', async () => {
      const driver = createDriverSpy(cancelledResult());
      const { agent, sessionStore } = makeAgent({ driver });
      const s   = await agent.newSession(newSessionArgs());
      const cx  = createCx();
      const res = await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx);
      expect(res).toEqual({ stopReason: 'cancelled' });
      expect(JSON.stringify(cx.calls)).toContain('partial');
      expect(sessionStore.hasActiveTurn(s.sessionId)).toBe(false);
      await agent.prompt({ sessionId: s.sessionId, ...textParam('again') }, createCx());
      expect(driver.seen).toHaveLength(2);
   });

   it('a cancelled result with no text streams nothing extra and raises no error', async () => {
      const driver = createDriverSpy(cancelledResult({ text: '' }));
      const { agent, logger } = makeAgent({ driver });
      const s   = await agent.newSession(newSessionArgs());
      const cx  = createCx();
      const res = await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx);
      const chunks = cx.calls.filter(c => 'agent_message_chunk' === c.params?.update?.sessionUpdate);
      expect(res).toEqual({ stopReason: 'cancelled' });
      expect(chunks).toHaveLength(1);   // only 'Working on it...'
      expect(logger.entries.filter((e: LogEntry) => 'error' === e.level)).toEqual([]);
   });

   it('[H] a non-empty driver session id on a cancelled result is stored', async () => {
      const { agent, sessionStore } = makeAgent({ driver: createDriverSpy(cancelledResult()) });
      const s = await agent.newSession(newSessionArgs());
      await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, createCx());
      expect(sessionStore.get(s.sessionId)?.driverSessionId).toBe('drv-c');
   });

   it('[H] an empty driver session id keeps the previous one', async () => {
      let n = 0;
      const driver = createDriverSpy(() => 0 === n++
         ? { text: 'x', sessionId: 'drv-1', toolCalls: [] }
         : cancelledResult({ sessionId: '' }));
      const { agent, sessionStore } = makeAgent({ driver });
      const s = await agent.newSession(newSessionArgs());
      await agent.prompt({ sessionId: s.sessionId, ...textParam('first') }, createCx());
      await agent.prompt({ sessionId: s.sessionId, ...textParam('second') }, createCx());
      expect(sessionStore.get(s.sessionId)?.driverSessionId).toBe('drv-1');
   });

   it('[H] an empty id on a first cancelled turn stays undefined, so the next turn passes none', async () => {
      let n = 0;
      const driver = createDriverSpy(() => 0 === n++
         ? cancelledResult({ sessionId: '' })
         : { text: 'ok', sessionId: 'drv-n', toolCalls: [] });
      const { agent, sessionStore } = makeAgent({ driver });
      const s = await agent.newSession(newSessionArgs());
      await agent.prompt({ sessionId: s.sessionId, ...textParam('first') }, createCx());
      expect(sessionStore.get(s.sessionId)?.driverSessionId).toBeUndefined();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('second') }, createCx());
      expect(driver.seen[1].options.sessionId).toBeUndefined();
   });

   it('[H] the next turn after a cancel passes the stored id and ends normally', async () => {
      let n = 0;
      const driver = createDriverSpy(() => 0 === n++
         ? cancelledResult()
         : { text: 'ok', sessionId: 'drv-n', toolCalls: [] });
      const { agent } = makeAgent({ driver });
      const s = await agent.newSession(newSessionArgs());
      await agent.prompt({ sessionId: s.sessionId, ...textParam('first') }, createCx());
      const res = await agent.prompt({ sessionId: s.sessionId, ...textParam('second') }, createCx());
      expect(driver.seen[1].options.sessionId).toBe('drv-c');
      expect(res).toEqual({ stopReason: 'end_turn' });
   });

   it.each([
      ['a generic error', () => new Error('SECRET-ERR'),              'internal'],
      ['a quota error',   () => new ProviderQuotaError('SECRET-ERR'), 'provider_quota'],
   ])('[H] %s after the abort settles cancelled and logs only its kind', async (_name, makeError, kind) => {
      const held = createHeldDriver();
      const { agent, sessionStore, logger } = makeAgent({ driver: held.driver });
      const { sessionId, turn }             = await startTurn(agent);
      await held.started(0);
      await agent.cancel({ sessionId });
      held.fail(0, makeError());
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(sessionStore.hasActiveTurn(sessionId)).toBe(false);
      expect(eventsOf(logger, 'turn_cancelled')[0].data).toMatchObject({ sessionId, failureKind: kind });
      expect(eventsOf(logger, 'prompt_failed')).toHaveLength(0);
      expect(JSON.stringify(logger.entries)).not.toContain('SECRET');
   });

   it('without an abort the same throw still surfaces as an error', async () => {
      const err    = new ProviderQuotaError('rate limited');
      const driver = createDriverSpy(() => { throw err; });
      const { agent, logger } = makeAgent({ driver });
      const s = await agent.newSession(newSessionArgs());
      await expect(agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, createCx())).rejects.toBe(err);
      expect(eventsOf(logger, 'turn_cancelled')).toHaveLength(0);
   });

   it('[H] a normal result after an abort is still cancelled', async () => {
      const held = createHeldDriver();
      const { agent, sessionStore } = makeAgent({ driver: held.driver });
      const { sessionId, turn }     = await startTurn(agent);
      await held.started(0);
      await agent.cancel({ sessionId });
      held.release(0);
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(sessionStore.hasActiveTurn(sessionId)).toBe(false);
   });
});

describe('Group 17 — cancel with asks', () => {
   /** A cx whose approval request stays open until the test answers it. */
   function createOpenAskCx()
   {
      const asked  = deferred();
      const answer = deferred<unknown>();
      const cx     = createCx({ respond: () => { asked.resolve(); return answer.promise; } });
      return { cx, asked, answer };
   }

   it.each([
      ['the IDE answers cancelled', { outcome: 'cancelled' }],
      ['the user rejects',          reject],
      ['the user allows',           allow],
   ])('[H] cancel with an ask open, then %s: the call never runs', async (_name, inner) => {
      const fake = createFakeGovernedDriver();
      fake.script([editReport]);
      const { cx, asked, answer } = createOpenAskCx();
      const { agent, logger }     = makeAgent({ driver: fake.driver });
      const { sessionId, turn }   = await startTurn(agent, cx);
      await asked.promise;
      await agent.cancel({ sessionId });
      answer.resolve({ outcome: inner });
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      await flush();
      expect(fake.ran()).toEqual([]);
      const outcomes = eventsOf(logger, 'governance_outcome');
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].data).toMatchObject({ action: 'deny', reason: 'cancelled' });
   });

   it.each([
      ['the request fails',     (a: Deferred<unknown>) => a.reject(new Error('SECRET-ERR')), 'ask_failed'],
      ['the IDE sends nothing', (a: Deferred<unknown>) => a.resolve(undefined),              'invalid_answer'],
   ])('[H] cancel with an ask open, then %s: logged as cancelled with its cause', async (_name, settle, cause) => {
      const fake = createFakeGovernedDriver();
      fake.script([editReport]);
      const { cx, asked, answer } = createOpenAskCx();
      const { agent, logger }     = makeAgent({ driver: fake.driver });
      const { sessionId, turn }   = await startTurn(agent, cx);
      await asked.promise;
      await agent.cancel({ sessionId });
      settle(answer);
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      await flush();
      expect(fake.ran()).toEqual([]);
      const outcomes = eventsOf(logger, 'governance_outcome');
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].level).toBe('info');
      expect(outcomes[0].data)
         .toMatchObject({ action: 'deny', answeredBy: 'cancel', reason: 'cancelled', cause });
      expect(JSON.stringify(logger.entries)).not.toContain('SECRET');
   });

   it('[H] an ask nobody answers does not hold the cancel; a late answer changes nothing', async () => {
      const fake = createFakeGovernedDriver();
      fake.script([editReport]);
      const { cx, asked, answer }   = createOpenAskCx();
      const { agent, sessionStore } = makeAgent({ driver: fake.driver });
      const { sessionId, turn }     = await startTurn(agent, cx);
      await asked.promise;
      await agent.cancel({ sessionId });
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(sessionStore.hasActiveTurn(sessionId)).toBe(false);
      answer.resolve({ outcome: allow });
      await flush();
      expect(fake.ran()).toEqual([]);
   });

   it('cancel with no ask pending settles cancelled without prompting the user', async () => {
      const held = createHeldDriver();
      const cx   = createCx();
      const { agent }           = makeAgent({ driver: held.driver });
      const { sessionId, turn } = await startTurn(agent, cx);
      await held.started(0);
      await agent.cancel({ sessionId });
      held.release(0);
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(requestsOf(cx)).toHaveLength(0);
      expect(detailsOf(cx)).toHaveLength(0);
   });

   it('[H] a report that arrives after the cancel is refused without evaluation or asking', async () => {
      const started = deferred();
      const gate    = deferred();
      let answered: unknown;
      const driver = createDriverSpy(async (_command: string, options: any) => {
         started.resolve();
         await gate.promise;
         answered = await options.onToolCall(editReport);
         return { text: 'ok', sessionId: 'drv', toolCalls: [] };
      });
      const governance = { evaluateToolCall: vi.fn() };
      const cx = createCx();
      const { agent, logger }   = makeAgent({ driver, governance });
      const { sessionId, turn } = await startTurn(agent, cx);
      await started.promise;
      await agent.cancel({ sessionId });
      gate.resolve();
      await turn;
      expect(answered).toBe('deny');
      expect(governance.evaluateToolCall).not.toHaveBeenCalled();
      expect(detailsOf(cx)).toHaveLength(0);
      expect(requestsOf(cx)).toHaveLength(0);
      expect(eventsOf(logger, 'governance_outcome')[0].data)
         .toMatchObject({ sessionId, action: 'deny', reason: 'cancelled', answeredBy: 'cancel' });
   });

   it('[H] an Allow that arrives after the cancel reaches the driver as a deny', async () => {
      let answered: unknown;
      const driver = createDriverSpy(async (_command: string, options: any) => {
         answered = await options.onToolCall(editReport);
         return { text: 'ok', sessionId: 'drv', toolCalls: [] };
      });
      const { cx, asked, answer } = createOpenAskCx();
      const { agent, logger }     = makeAgent({ driver });
      const { sessionId, turn }   = await startTurn(agent, cx);
      await asked.promise;
      await agent.cancel({ sessionId });
      answer.resolve({ outcome: allow });
      await turn;
      expect(answered).toBe('deny');
      expect(eventsOf(logger, 'governance_outcome')[0].data)
         .toMatchObject({ action: 'deny', reason: 'cancelled', answeredBy: 'user' });
   });
});

describe('Group 18 — disconnect', () => {
   it('[H] aborts every turn, then closes the driver once, then releases the sessions', async () => {
      const held = createHeldDriver();
      let ids: string[] = [];
      let atClose: unknown;
      const close = vi.fn(async () => {
         atClose = {
            aborted:      held.driver.seen.map((c: any) => c.options.signal.aborted),
            present:      ids.map(id => undefined !== sessionStore.get(id)),
            disconnected: eventsOf(logger, 'disconnect').length,
         };
      });
      const { agent, sessionStore, logger } = makeAgent({ driver: Object.assign(held.driver, { close }) });
      const a = await startTurn(agent);
      await held.started(0);
      const b = await startTurn(agent);
      await held.started(1);
      ids = [a.sessionId, b.sessionId];
      await agent.onDisconnect();
      expect(close).toHaveBeenCalledTimes(1);
      expect(atClose).toEqual({ aborted: [true, true], present: [true, true], disconnected: 0 });
      expect(ids.map(id => sessionStore.get(id))).toEqual([undefined, undefined]);
      expect(eventsOf(logger, 'disconnect')).toHaveLength(1);
      held.release(0);
      held.release(1);
      await Promise.all([a.turn, b.turn]);
   });

   it('idle sessions: the driver is still closed once and the sessions are released', async () => {
      const close = vi.fn(async () => {});
      const { agent, sessionStore } = makeAgent({ driver: Object.assign(createDriverSpy(), { close }) });
      const a = await agent.newSession(newSessionArgs());
      const b = await agent.newSession(newSessionArgs());
      await agent.onDisconnect();
      expect(close).toHaveBeenCalledTimes(1);
      expect([sessionStore.get(a.sessionId), sessionStore.get(b.sessionId)]).toEqual([undefined, undefined]);
   });

   const closers: Array<[string, () => Promise<void>]> = [
      ['throws',  () => { throw new Error('SECRET-CLOSE'); }],
      ['rejects', () => Promise.reject(new Error('SECRET-CLOSE'))],
   ];

   it.each(closers)('[H] a close that %s: sessions released, kind only logged, no retry', async (_how, impl) => {
      const close = vi.fn(impl);
      const { agent, sessionStore, logger } = makeAgent({ driver: Object.assign(createDriverSpy(), { close }) });
      const s = await agent.newSession(newSessionArgs());
      await expect(agent.onDisconnect()).resolves.toBeUndefined();
      expect(close).toHaveBeenCalledTimes(1);
      expect(sessionStore.get(s.sessionId)).toBeUndefined();
      expect(eventsOf(logger, 'close_failed')[0].data).toEqual({ failureKind: 'internal' });
      expect(JSON.stringify(logger.entries)).not.toContain('SECRET');
      expect(eventsOf(logger, 'disconnect')).toHaveLength(1);
   });

   it('disconnect twice is harmless', async () => {
      const close = vi.fn(async () => {});
      const { agent } = makeAgent({ driver: Object.assign(createDriverSpy(), { close }) });
      await agent.onDisconnect();
      await expect(agent.onDisconnect()).resolves.toBeUndefined();
   });

   it('a turn that settles after the disconnect throws nothing and recreates nothing', async () => {
      const held = createHeldDriver();
      const { agent, sessionStore, logger } = makeAgent({ driver: held.driver });
      const { sessionId, turn }             = await startTurn(agent);
      await held.started(0);
      await agent.onDisconnect();
      held.release(0);
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(sessionStore.get(sessionId)).toBeUndefined();
      expect(eventsOf(logger, 'prompt_failed')).toHaveLength(0);
   });
});

describe('Group 19 — cancel logging', () => {
   it('cancel_requested is logged once per aborted turn, with the session id only', async () => {
      const held = createHeldDriver();
      const { agent, logger }   = makeAgent({ driver: held.driver });
      const { sessionId, turn } = await startTurn(agent);
      await held.started(0);
      await agent.cancel({ sessionId });
      await agent.cancel({ sessionId });
      expect(eventsOf(logger, 'cancel_requested').map(e => e.data)).toEqual([{ sessionId }]);
      held.release(0);
      await turn;
   });

   it('turn_cancelled is logged when the turn settles, without failureKind when the driver did not throw', async () => {
      const held = createHeldDriver();
      const { agent, logger }   = makeAgent({ driver: held.driver });
      const { sessionId, turn } = await startTurn(agent);
      await held.started(0);
      await agent.cancel({ sessionId });
      expect(eventsOf(logger, 'turn_cancelled')).toHaveLength(0);
      held.release(0);
      await turn;
      expect(eventsOf(logger, 'turn_cancelled').map(e => e.data)).toEqual([{ sessionId }]);
   });

   it('a cancel with no active turn logs no cancel_requested', async () => {
      const { agent, logger } = makeAgent();
      const s = await agent.newSession(newSessionArgs());
      await agent.cancel({ sessionId: s.sessionId });
      await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, createCx());
      await agent.cancel({ sessionId: s.sessionId });
      await agent.cancel({ sessionId: 'ghost' });
      expect(eventsOf(logger, 'cancel_requested')).toHaveLength(0);
   });

   it('[H] prompt text, partial text and error messages stay out of every log entry', async () => {
      const held = createHeldDriver();
      const { agent, logger }   = makeAgent({ driver: held.driver });
      const { sessionId, turn } = await startTurn(agent, createCx(), 'SECRET-PROMPT');
      await held.started(0);
      await agent.cancel({ sessionId });
      held.release(0, { cancelled: true, text: 'SECRET-PARTIAL', sessionId: 'drv', toolCalls: [] });
      await turn;
      const next = agent.prompt({ sessionId, ...textParam('SECRET-PROMPT-2') }, createCx());
      await held.started(1);
      await agent.cancel({ sessionId });
      held.fail(1, new Error('SECRET-ERR'));
      await next;
      expect(eventsOf(logger, 'turn_cancelled')).toHaveLength(2);
      expect(JSON.stringify(logger.entries)).not.toContain('SECRET');
   });
});
