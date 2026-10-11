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
      agent.onDisconnect();
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
   it('cancel with an active turn frees the session', async () => {
      const { agent, sessionStore } = makeAgent();
      const s = await agent.newSession(newSessionArgs());
      sessionStore.setActiveTurn(s.sessionId, true);
      await agent.cancel({ sessionId: s.sessionId });
      expect(sessionStore.hasActiveTurn(s.sessionId)).toBe(false);
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
