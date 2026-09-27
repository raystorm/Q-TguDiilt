import { describe, it, expect } from 'vitest';
import { createAgent } from '../agent.js';
import { createSessionStore } from '../session-store.js';
import {
   TurnInProgressError,
   ProviderQuotaError,
   ProviderAuthError,
   SessionCollapseError,
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
   { permission = { outcome: 'selected', optionId: 'allow' } }:
   { permission?: { outcome: string; optionId?: string } } = {},
)
{
   const calls: Array<{ kind: string; method: string; params: any }> = [];
   return {
      calls,
      notify: async (method: string, params: any) => {
         calls.push({ kind: 'notify', method, params });
      },
      request: async (method: string, params: any) => {
         calls.push({ kind: 'request', method, params });
         return { outcome: permission };
      },
   };
}

function createDriverSpy(result: any = { text: 'ok', sessionId: 'drv-sess' })
{
   const seen: Array<{ command: string; options: any }> = [];
   return {
      seen,
      execute: (command: string, options: any = {}) => {
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
      info:  (event: string, data: any = {}) => { entries.push({ level: 'info',  event, data }); },
      error: (event: string, data: any = {}) => { entries.push({ level: 'error', event, data }); },
   };
}

function makeAgent(overrides: any = {})
{
   const driver       = overrides.driver       ?? createDriverSpy();
   const logger       = overrides.logger       ?? createLogger();
   const sessionStore = overrides.sessionStore ??
      createSessionStore({ newWorkflowId: (() => { let n = 0; return () => `wf-${++n}`; })() });
   const agent = createAgent({ driver, sessionStore, logger, protocolVersion: PROTOCOL_VERSION });
   // Most tests operate on an initialized boundary. `initialize` flips the
   // internal flag synchronously (before its first await), so the guard tests
   // that pass `init: false` reliably observe an un-initialized agent.
   if (false !== overrides.init) { void agent.initialize({ protocolVersion: PROTOCOL_VERSION }); }
   return { agent, driver, logger, sessionStore };
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
