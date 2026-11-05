import { describe, it, expect } from 'vitest';
import { TurnInProgressError, DriverGovernanceUnsupportedError } from '../errors.js';
import {
   createCx, createDriverSpy, flush, createHeldDriver, startTurn, makeAgent, newSessionArgs,
   eventsOf, textParam,
} from './agent.helpers.js';
import { UPDATE_FAILED_EVENT } from '../update-sink.js';

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
         close: async () => {},
         release: async () => {},
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

   it('a turn whose driver fails clears the flag and the abort handle', async () => {
      const driver = createDriverSpy(() => { throw new Error('driver down'); });
      const { agent, sessionStore } = makeAgent({ driver });
      const s = await agent.newSession(newSessionArgs());
      await expect(agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, createCx()))
         .rejects.toThrow('driver down');
      expect(driver.seen).toHaveLength(1);
      expect(sessionStore.hasActiveTurn(s.sessionId)).toBe(false);
      expect(sessionStore.get(s.sessionId)?.abort).toBeUndefined();
   });

   it('a notification failure after a cancel is logged, not thrown', async () => {
      const cx   = { ...createCx(), notify: async () => { throw new Error('connection lost'); } };
      const held = createHeldDriver();
      const { agent, sessionStore, logger } = makeAgent({ driver: held.driver });
      const { sessionId, turn } = await startTurn(agent, cx);
      await held.started(0);
      await agent.cancel({ sessionId });
      held.release(0, { cancelled: true, text: 'partial', sessionId: 'drv-c', toolCalls: [] });
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(eventsOf(logger, UPDATE_FAILED_EVENT)).toHaveLength(1);
      expect(sessionStore.hasActiveTurn(sessionId)).toBe(false);
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
