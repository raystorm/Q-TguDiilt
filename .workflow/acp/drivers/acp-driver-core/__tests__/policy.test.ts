import { describe, it, expect } from 'vitest';
import { AgentRefusedError } from '../errors.js';
import { SessionCollapseError } from '../../../protocol/errors.js';
import type { AcpPolicy } from '../types.js';
import { flush, makeDriver } from './acp-driver.helpers.js';
import { SESSION, entries, failureOf } from './failures.helpers.js';

const REFUSAL = 'this agent is not the one this service needs; update it and try again';

describe('driver policy checks', () => {
   it('without a policy nothing is checked', async () => {
      const { driver } = makeDriver();
      await expect(driver.execute('go')).resolves.toMatchObject({ sessionId: SESSION });
   });

   it('the initialize check sees the initialize answer', async () => {
      const seen: unknown[] = [];
      const { driver, agents } = makeDriver(1, undefined, {
         verifyInitialize: response => { seen.push(response); return undefined; },
      });
      agents[0].respond('initialize', () => ({
         protocolVersion: 1, authMethods: [], agentCapabilities: { _meta: { marker: 'on' } },
      }));
      await driver.execute('go');
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ protocolVersion: 1, agentCapabilities: { _meta: { marker: 'on' } } });
   });

   it('the session check sees the session/new answer', async () => {
      const seen: unknown[] = [];
      const { driver, agents } = makeDriver(1, undefined, {
         verifySession: response => { seen.push(response); return undefined; },
      });
      agents[0].respond('session/new', () => ({ sessionId: SESSION, configOptions: [] }));
      await driver.execute('go');
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ sessionId: SESSION, configOptions: [] });
   });

   it('[H] a refusal after initialize ends the process before session/new, '
      + 'and the error is the driver\'s message', async () => {
      const { driver, agents, logger } = makeDriver(1, undefined, { verifyInitialize: () => REFUSAL });
      const error = await failureOf(driver.execute('go'));
      expect(error).toBeInstanceOf(AgentRefusedError);
      expect(error?.message).toBe(REFUSAL);
      expect(agents[0].methods()).toEqual(['initialize']);
      expect(agents[0].stdinCloses).toBe(1);
      agents[0].exit(0);
      await flush();
      expect(entries(logger, 'agent_process_ended'))
         .toEqual([{ pid: 4000, reason: 'verify_refused', stage: 'stdin_closed' }]);
   });

   it('[H] a refusal after session/new ends the process before the prompt, and the session is not usable', async () => {
      const { driver, agents } = makeDriver(1, undefined, { verifySession: () => REFUSAL });
      const error = await failureOf(driver.execute('go'));
      expect(error).toBeInstanceOf(AgentRefusedError);
      expect(agents[0].methods()).toEqual(['initialize', 'session/new']);
      expect(agents[0].stdinCloses).toBe(1);
      await expect(driver.execute('again', { sessionId: SESSION })).rejects.toBeInstanceOf(SessionCollapseError);
      agents[0].exit(0);
   });

   it('[H] after a refusal the next prompt launches again, and the relaunch is logged', async () => {
      let refuse = true;
      const policy: AcpPolicy = { verifyInitialize: () => refuse ? REFUSAL : undefined };
      const { driver, agents, connect, logger } = makeDriver(2, undefined, policy);
      expect(await failureOf(driver.execute('go'))).toBeInstanceOf(AgentRefusedError);
      agents[0].exit(0);
      refuse = false;
      await expect(driver.execute('go')).resolves.toMatchObject({ sessionId: SESSION });
      expect(connect).toHaveBeenCalledTimes(2);
      expect(entries(logger, 'agent_relaunched')).toEqual([{ pid: 4001, after: 'verify_refused' }]);
   });

   it('a check that throws fails the turn with its own error and ends the process', async () => {
      const failure = new Error('check broke');
      const { driver, agents } = makeDriver(1, undefined, { verifyInitialize: () => { throw failure; } });
      expect(await failureOf(driver.execute('go'))).toBe(failure);
      expect(agents[0].stdinCloses).toBe(1);
      agents[0].exit(0);
   });

   it('an abort seen after initialize wins over the check', async () => {
      const controller = new AbortController();
      const { driver, agents } = makeDriver(1, undefined, { verifyInitialize: () => REFUSAL });
      agents[0].respond('initialize', () => {
         controller.abort();
         return { protocolVersion: 1, agentCapabilities: {}, authMethods: [] };
      });
      expect(await driver.execute('go', { signal: controller.signal })).toMatchObject({ cancelled: true });
      agents[0].exit(0);
   });
});
