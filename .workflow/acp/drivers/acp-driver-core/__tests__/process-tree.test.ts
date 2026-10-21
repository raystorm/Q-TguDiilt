import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderAuthError } from '../../../protocol/errors.js';
import { ENDING_KILL_DELAY_MS, ENDING_TERM_DELAY_MS } from '../ending.js';
import { AgentExitedError } from '../errors.js';
import { NOT_LOGGED_IN, entries, failureOf } from './failures.helpers.js';
import { goneWithin, isAlive, realSleep, startStub, stubDriver } from './stub-agent.helpers.js';

let stub: ReturnType<typeof startStub> | undefined;
afterEach(() => { vi.useRealTimers(); stub?.stop(); stub = undefined; });

describe.skipIf('win32' === process.platform)('real agent processes', () => {
   it('[H] the whole tree is gone after close', async () => {
      stub = startStub('grandchild');
      const { driver, pids } = stubDriver();
      await driver.execute('go');
      const { grandchild } = stub.state();
      expect(isAlive(pids[0])).toBe(true);
      expect(isAlive(grandchild as number)).toBe(true);
      await driver.close();
      expect(await goneWithin(pids[0])).toBe(true);
      expect(await goneWithin(grandchild as number)).toBe(true);
   });

   it('[H] an agent that ignores SIGTERM is still gone, killed after the delays', async () => {
      stub = startStub('linger,ignore-sigterm');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      const { driver, pids } = stubDriver();
      await driver.execute('go');
      const closing = driver.close();
      await vi.advanceTimersByTimeAsync(ENDING_TERM_DELAY_MS);
      for (let i = 0; i < 100 && !stub.events().includes('SIGTERM'); i++) { await realSleep(20); }
      expect(stub.events()).toContain('SIGTERM');
      expect(isAlive(pids[0])).toBe(true);
      await vi.advanceTimersByTimeAsync(ENDING_KILL_DELAY_MS);
      await closing;
      expect(await goneWithin(pids[0])).toBe(true);
   });

   it('[H] the leftovers of a crashed agent are ended, and an unrelated process is not touched', async () => {
      stub = startStub('grandchild,crash-on-prompt');
      const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      try {
         const { driver } = stubDriver();
         const error = await failureOf(driver.execute('go'));
         expect(error).toBeInstanceOf(AgentExitedError);
         expect(error?.message).toContain('SIGKILL');
         expect(await goneWithin(stub.state().grandchild as number)).toBe(true);
         expect(isAlive(unrelated.pid as number)).toBe(true);
      }
      finally { unrelated.kill('SIGKILL'); }
   });

   it('known limit: a descendant that left the process group stays', async () => {
      stub = startStub('grandchild-setsid');
      const { driver, pids } = stubDriver();
      await driver.execute('go');
      const grandchild = stub.state().grandchild as number;
      await driver.close();
      expect(await goneWithin(pids[0])).toBe(true);
      expect(isAlive(grandchild)).toBe(true);
      process.kill(grandchild, 'SIGKILL');
      expect(await goneWithin(grandchild)).toBe(true);
   });

   it('aborting during launch leaves no process', async () => {
      stub = startStub();
      const { driver, pids } = stubDriver();
      const controller = new AbortController();
      const turn = driver.execute('go', { signal: controller.signal });
      controller.abort();
      expect(await turn).toMatchObject({ cancelled: true });
      expect(pids).toHaveLength(1);
      expect(await goneWithin(pids[0])).toBe(true);
   });

   it('concurrent close calls end each process once and leave none', async () => {
      stub = startStub();
      const { driver, pids } = stubDriver();
      await Promise.all([driver.execute('a'), driver.execute('b'), driver.execute('c')]);
      expect(pids).toHaveLength(3);
      await Promise.all([driver.close(), driver.close(), driver.close()]);
      for (const pid of pids) { expect(await goneWithin(pid)).toBe(true); }
   });

   it('[H] a flood on stderr never blocks the agent', async () => {
      stub = startStub('stderr-flood', { STUB_FLOOD_BYTES: '8000000' });
      const { driver } = stubDriver();
      await expect(driver.execute('go')).resolves.toMatchObject({ sessionId: 'stub-session' });
      await driver.close();
   });
});

describe.skipIf('win32' === process.platform)('failures of a real process', () => {
   it('[H] the agent\'s "not logged in" before initialize is an authentication error with its text', async () => {
      stub = startStub('exit-before-initialize');
      const error = await failureOf(stubDriver().driver.execute('go'));
      expect(error).toBeInstanceOf(ProviderAuthError);
      expect(error?.message).toContain(NOT_LOGGED_IN);
   });

   it('[H] any other exit before initialize carries the exit code and the text', async () => {
      stub = startStub('exit-before-initialize', { STUB_STDERR: 'segmentation fault\n' });
      const error = await failureOf(stubDriver().driver.execute('go'));
      expect(error).toBeInstanceOf(AgentExitedError);
      expect(error?.message).toContain('exit code 1');
      expect(error?.message).toContain('segmentation fault');
   });

   it('[H] a line that is not JSON on stdout fails the turn and ends the process', async () => {
      stub = startStub('garbage-stdout');
      const { driver, pids, logger } = stubDriver();
      const error = await failureOf(driver.execute('go'));
      expect(error?.message).toContain('not JSON');
      expect(await goneWithin(pids[0])).toBe(true);
      await vi.waitFor(() => expect(entries(logger, 'agent_process_ended'))
         .toEqual([{ pid: pids[0], reason: 'protocol_failure', stage: 'stdin_closed' }]));
   });
});
