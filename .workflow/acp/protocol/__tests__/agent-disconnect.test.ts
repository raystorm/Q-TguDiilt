import { describe, it, expect, vi } from 'vitest';
import { createDriverSpy, createHeldDriver, startTurn, makeAgent, newSessionArgs, eventsOf } from './agent.helpers.js';

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

   it.each(closers)('[H] a close that %s: sessions released, kind only logged, no retry, error thrown last', async (_how, impl) => {
      const close = vi.fn(impl);
      const { agent, sessionStore, logger } = makeAgent({ driver: Object.assign(createDriverSpy(), { close }) });
      const s = await agent.newSession(newSessionArgs());
      await expect(agent.onDisconnect()).rejects.toThrow('SECRET-CLOSE');
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
