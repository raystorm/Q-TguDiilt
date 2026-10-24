import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionCollapseError } from '../../../protocol/errors.js';
import { NEVER } from './fake-acp-agent.js';
import { createDiagnostics, deferred, flush, makeDriver } from './acp-driver.helpers.js';
import { abortableTurn, wrapUp } from './cancel.helpers.js';
import { SESSION, failureOf } from './failures.helpers.js';

afterEach(() => { vi.useRealTimers(); });

const SETUP_ANSWER = { protocolVersion: 1, agentCapabilities: {}, authMethods: [] };

/** A driver with a recording seam. */
function recorded(delayConnect?: (index: number) => Promise<void> | undefined) {
   const diagnostics = createDiagnostics();
   const made        = makeDriver(1, delayConnect, undefined, undefined, diagnostics);
   return { ...made, diagnostics };
}

describe('what the driver does itself is not a failure', () => {
   it('[H] a cancel the agent answers', async () => {
      const diagnostics = createDiagnostics();
      const t = await abortableTurn({}, 1, 'go', diagnostics);
      t.controller.abort();
      t.finish({ stopReason: 'cancelled' });
      expect(await t.turn).toMatchObject({ cancelled: true });
      await wrapUp(t);
      expect(diagnostics.records).toEqual([]);
   });

   it('a cancel the agent ignores until it ends the turn normally', async () => {
      const diagnostics = createDiagnostics();
      const t = await abortableTurn({}, 1, 'go', diagnostics);
      t.controller.abort();
      t.finish({ stopReason: 'end_turn' });
      await t.turn;
      await wrapUp(t);
      expect(diagnostics.records).toEqual([]);
   });

   it('a requested close of an idle driver', async () => {
      const { driver, agents, diagnostics } = recorded();
      await driver.execute('one');
      const closing = driver.close();
      agents[0].exit(0);
      await closing;
      await flush();
      expect(diagnostics.records).toEqual([]);
   });

   it('[H] a requested close while a prompt is in flight', async () => {
      const diagnostics = createDiagnostics();
      const t = await abortableTurn({}, 1, 'go', diagnostics);
      const closing = t.driver.close();
      t.agent.exit(0);
      await closing;
      await failureOf(t.turn);
      await flush();
      expect(diagnostics.records).toEqual([]);
   });

   it.each(['connect', 'initialize', 'session/new'])(
      'a requested close during setup, held at %s',
      async step => {
         const gate = deferred();
         const { driver, agents, diagnostics } = recorded(
            'connect' === step ? () => gate.promise : undefined,
         );
         if ('connect' !== step) { agents[0].respond(step, () => NEVER); }
         const turn = failureOf(driver.execute('go'));
         await flush();
         const closing = driver.close();
         gate.resolve();
         await flush();
         agents[0].exit(0);
         await closing;
         await turn;
         await flush();
         expect(diagnostics.records).toEqual([]);
      },
   );

   it.each(['launch', 'initialize', 'session/new'])('an abort seen during setup, at %s',
      async step => {
         const controller  = new AbortController();
         const diagnostics = createDiagnostics();
         const abortAtLaunch = () => { controller.abort(); return undefined; };
         const { driver, agents } = makeDriver(
            1, 'launch' === step ? abortAtLaunch : undefined, undefined, undefined, diagnostics,
         );
         const answers: Record<string, unknown> = {
            'initialize':  SETUP_ANSWER,
            'session/new': { sessionId: SESSION },
         };
         if ('launch' !== step) {
            agents[0].respond(step, () => { controller.abort(); return answers[step]; });
         }
         const result = await driver.execute('go', { signal: controller.signal });
         expect(result).toMatchObject({ cancelled: true });
         agents[0].exit(0);
         await flush();
         expect(diagnostics.records).toEqual([]);
      });

   it('a prompt on a session that is gone', async () => {
      const { driver, diagnostics } = recorded();
      await expect(driver.execute('go', { sessionId: 'unknown' }))
         .rejects.toBeInstanceOf(SessionCollapseError);
      expect(diagnostics.records).toEqual([]);
   });
});
