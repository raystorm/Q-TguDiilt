import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENDING_KILL_DELAY_MS, ENDING_TERM_DELAY_MS } from '../ending.js';
import { deferred, flush, makeDriver } from './acp-driver.helpers.js';
import { entries } from './failures.helpers.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(()  => { vi.useRealTimers(); });

const ANSWERS = {
   'initialize':  { protocolVersion: 1, agentCapabilities: {}, authMethods: [] },
   'session/new': { sessionId: 'agent-sess-1' },
};

describe('close while the driver is busy', () => {
   it.each(['connect', 'initialize', 'session/new'] as const)(
      '[H] close during %s resolves, leaves no process, and settles the turn cancelled',
      async hold => {
         const held = deferred();
         const { driver, agents, logger } = makeDriver(1, 'connect' === hold ? () => held.promise : undefined);
         if ('connect' !== hold) {
            agents[0].respond(hold, async () => { await held.promise; return ANSWERS[hold]; });
         }
         const turn = driver.execute('go');
         await flush();
         const closing = driver.close();
         held.resolve();
         await flush();
         agents[0].exit(0);
         await closing;
         await flush();
         expect(await turn).toStrictEqual({ text: '', sessionId: '', toolCalls: [], cancelled: true });
         expect(agents[0].stdinCloses).toBe(1);
         expect(entries(logger, 'agent_process_ended')).toEqual([
            expect.objectContaining({ pid: 4000, reason: 'disconnect' }),
         ]);
         expect(vi.getTimerCount()).toBe(0);
      },
   );

   it('[H] several lingering agents are ended in parallel, within the disconnect bound', async () => {
      const { driver, agents } = makeDriver(3);
      await Promise.all([driver.execute('a'), driver.execute('b'), driver.execute('c')]);
      const started = Date.now();
      let closedAfter: number | undefined;
      const closing = driver.close().then(() => { closedAfter = Date.now() - started; });
      await vi.advanceTimersByTimeAsync(ENDING_TERM_DELAY_MS + ENDING_KILL_DELAY_MS);
      for (const agent of agents) {
         expect(agent.kills.map(kill => [kill.signal, kill.at - started])).toEqual([
            ['SIGTERM', ENDING_TERM_DELAY_MS],
            ['SIGKILL', ENDING_TERM_DELAY_MS + ENDING_KILL_DELAY_MS],
         ]);
      }
      agents.forEach(agent => agent.exit(null, 'SIGKILL'));
      await closing;
      expect(closedAfter).toBe(ENDING_TERM_DELAY_MS + ENDING_KILL_DELAY_MS);
   });
});
