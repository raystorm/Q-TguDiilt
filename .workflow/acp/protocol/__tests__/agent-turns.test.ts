import { describe, it, expect } from 'vitest';
import { TurnInProgressError, ProviderQuotaError, ProviderAuthError, SessionCollapseError } from '../errors.js';
import {
   type LogEntry, createCx, createDriverSpy, createHeldDriver, startTurn, makeAgent, newSessionArgs, textParam,
} from './agent.helpers.js';

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
