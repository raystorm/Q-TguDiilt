import { describe, it, expect, vi } from 'vitest';
import {
   createDriverSpy, createHeldDriver, createLogger, createResolverStub, eventsOf, makeAgent,
   newSessionArgs, oneDriverCatalog, resolved, startTurn,
} from './agent.helpers.js';
import { buildCatalog } from '../../drivers/__tests__/build-catalog.js';
import {
   FIXTURE_REGISTRY, configOf, importFrom, validSet,
} from '../../drivers/__tests__/catalog-fixtures.js';

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

   it.each(closers)('[H] a close that %s: sessions released, kind only logged, '
      + 'no retry, error thrown last', async (_how, impl) => {
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

describe('disconnect closes the catalog', () => {
   /** A real catalog over fake drivers. */
   async function realCatalog(names: string[]) {
      const { drivers, modules } = validSet(...names);
      const catalog = await buildCatalog({
         config: configOf(names), registryPath: FIXTURE_REGISTRY, logger: createLogger(),
         importModule: importFrom(modules),
      });
      return { catalog, drivers };
   }

   const expectEachClosedOnce = (drivers: Record<string, { close: unknown }>) =>
      Object.values(drivers).forEach(driver => expect(driver.close).toHaveBeenCalledTimes(1));

   it('[H] aborts the turns, closes the catalog once, then releases the sessions', async () => {
      const held = createHeldDriver();
      let ids: string[] = [];
      let atClose: unknown;
      const closeAll = vi.fn(async () => {
         atClose = {
            aborted:      held.driver.seen.map((call: any) => call.options.signal.aborted),
            present:      ids.map(id => undefined !== sessionStore.get(id)),
            disconnected: eventsOf(logger, 'disconnect').length,
         };
      });
      const catalog = Object.assign(oneDriverCatalog(held.driver), { closeAll });
      const { agent, sessionStore, logger } = makeAgent({ driver: held.driver, catalog });
      const a = await startTurn(agent);
      await held.started(0);
      const b = await startTurn(agent);
      await held.started(1);
      ids = [a.sessionId, b.sessionId];
      await agent.onDisconnect();
      expect(closeAll).toHaveBeenCalledTimes(1);
      expect(atClose).toEqual({ aborted: [true, true], present: [true, true], disconnected: 0 });
      expect(ids.map(id => sessionStore.get(id))).toEqual([undefined, undefined]);
      expect(eventsOf(logger, 'disconnect')).toHaveLength(1);
      held.release(0);
      held.release(1);
      await Promise.all([a.turn, b.turn]);
   });

   it('a failing closeAll: sessions released, kind only logged, error last', async () => {
      const closeAll = vi.fn(async () => { throw new Error('SECRET-CLOSE'); });
      const driver   = createDriverSpy();
      const catalog  = Object.assign(oneDriverCatalog(driver), { closeAll });
      const { agent, sessionStore, logger } = makeAgent({ driver, catalog });
      const s = await agent.newSession(newSessionArgs());
      await expect(agent.onDisconnect()).rejects.toThrow('SECRET-CLOSE');
      expect(closeAll).toHaveBeenCalledTimes(1);
      expect(sessionStore.get(s.sessionId)).toBeUndefined();
      expect(eventsOf(logger, 'close_failed')[0].data).toEqual({ failureKind: 'internal' });
      expect(JSON.stringify(logger.entries)).not.toContain('SECRET');
      expect(eventsOf(logger, 'disconnect')).toHaveLength(1);
   });

   it('a real catalog closes every driver and throws the first failure last', async () => {
      const { catalog, drivers } = await realCatalog(['alpha', 'beta', 'gamma']);
      drivers.alpha.close.mockRejectedValue(new Error('alpha-close'));
      const resolver  = createResolverStub(() => resolved('beta'));
      const { agent } = makeAgent({ catalog, resolver });
      await agent.newSession(newSessionArgs());
      await expect(agent.onDisconnect()).rejects.toThrow('alpha-close');
      expectEachClosedOnce(drivers);
   });

   it('with no session ever opened the catalog is still closed once', async () => {
      const closeAll  = vi.fn(async () => {});
      const driver    = createDriverSpy();
      const catalog   = Object.assign(oneDriverCatalog(driver), { closeAll });
      const { agent } = makeAgent({ driver, catalog });
      await agent.onDisconnect();
      expect(closeAll).toHaveBeenCalledTimes(1);
   });

   it('a repeated disconnect closes no driver twice', async () => {
      const { catalog, drivers } = await realCatalog(['alpha', 'beta']);
      const resolver  = createResolverStub(() => resolved('alpha'));
      const { agent } = makeAgent({ catalog, resolver });
      await agent.onDisconnect();
      await expect(agent.onDisconnect()).resolves.toBeUndefined();
      expectEachClosedOnce(drivers);
   });
});
