import { describe, it, expect } from 'vitest';
import { TurnInProgressError } from '../errors.js';
import {
   catalogOf, createCx, createDriverSpy, createHeldDriver, createResolverStub, deferred, flush,
   makeAgent, newSessionArgs, resolved, startTurn, textParam,
} from './agent.helpers.js';

const END = { stopReason: 'end_turn' };

/** Drivers alpha and beta. The first resolution gives alpha/m1, every later one beta/m2. */
function guarded(alpha: any, beta: any)
{
   const resolver = createResolverStub(call =>
      0 === call ? resolved('alpha', 'm1') : resolved('beta', 'm2'));
   const made = makeAgent({ catalog: catalogOf({ alpha, beta }), resolver });
   const open = async () => (await made.agent.newSession(newSessionArgs())).sessionId;
   const say  = (id: string, text: string) =>
      made.agent.prompt({ sessionId: id, ...textParam(text) }, createCx());
   return { ...made, open, say };
}

/** A first turn done on alpha (id a-1), with the release of that session held. */
async function afterFirstTurn(beta: any)
{
   const alpha = createDriverSpy({ text: 'a', sessionId: 'a-1' }, 'alpha');
   const made  = guarded(alpha, beta);
   const id    = await made.open();
   await made.say(id, 'go');
   const hold = deferred();
   alpha.onRelease = () => hold.promise;
   return { ...made, id, hold };
}

describe('the turn guard around an activation', () => {
   it('[H] a prompt that arrives while the old session is being released is rejected', async () => {
      const held = createHeldDriver();
      const { resolver, say, id, hold } = await afterFirstTurn(held.driver);
      const first = say(id, 'as Planner go');
      await flush();
      expect(resolver.calls).toEqual([undefined, 'Planner']);

      const error = await say(id, 'go again').catch(err => err);
      expect(error).toBeInstanceOf(TurnInProgressError);
      expect(error.retryable).toBe(true);
      expect(resolver.calls).toEqual([undefined, 'Planner']);

      hold.resolve();
      await held.started(0);
      held.release(0);
      await expect(first).resolves.toEqual(END);
      expect(held.driver.seen).toHaveLength(1);
   });

   it('the flag is set from the start of the resolution to the end of the turn', async () => {
      const held = createHeldDriver();
      const { sessionStore, say, id, hold } = await afterFirstTurn(held.driver);
      expect(sessionStore.hasActiveTurn(id)).toBe(false);
      const turn = say(id, 'as Planner go');
      await flush();
      expect(sessionStore.hasActiveTurn(id)).toBe(true);
      hold.resolve();
      await held.started(0);
      expect(sessionStore.hasActiveTurn(id)).toBe(true);
      held.release(0);
      await turn;
      expect(sessionStore.hasActiveTurn(id)).toBe(false);
   });

   it('[H] the release never overlaps a driver turn', async () => {
      const order: string[] = [];
      const alpha = createDriverSpy(async () => {
         order.push('alpha:execute-start');
         await flush();
         order.push('alpha:execute-end');
         return { text: 'a', sessionId: 'a-1' };
      }, 'alpha');
      alpha.onRelease = async () => {
         order.push('alpha:release');
         await flush();
         order.push('alpha:release-end');
      };
      const beta = createDriverSpy(async () => {
         order.push('beta:execute-start');
         return { text: 'b', sessionId: 'b-1' };
      }, 'beta');
      const { open, say } = guarded(alpha, beta);
      const id = await open();
      await say(id, 'go');
      await say(id, 'as Planner go');
      expect(order).toEqual([
         'alpha:execute-start', 'alpha:execute-end', 'alpha:release', 'alpha:release-end',
         'beta:execute-start',
      ]);
   });

   it('[H] a prompt rejected as in progress does not detect an activation', async () => {
      const held = createHeldDriver();
      const beta = createDriverSpy({ text: 'b', sessionId: 'b-1' }, 'beta');
      const made = guarded(held.driver, beta);
      const { sessionId, turn } = await startTurn(made.agent);
      await held.started(0);
      await expect(made.say(sessionId, 'as Planner go')).rejects.toBeInstanceOf(TurnInProgressError);
      expect(made.resolver.calls).toEqual([undefined]);
      expect(made.sessionStore.get(sessionId)?.profile).toBeUndefined();
      expect(held.driver.released).toEqual([]);
      held.release(0);
      await turn;
   });
});
