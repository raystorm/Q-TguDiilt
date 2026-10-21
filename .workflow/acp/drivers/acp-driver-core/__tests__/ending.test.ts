import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
   ENDING_EXIT_WAIT_MS,
   ENDING_KILL_DELAY_MS,
   ENDING_TERM_DELAY_MS,
   endAgent,
} from '../ending.js';
import { createFakeAcpAgent } from './fake-acp-agent.js';

beforeEach(() => {
   vi.useFakeTimers();
   vi.setSystemTime(0);
});
afterEach(() => { vi.useRealTimers(); });

describe('ending the agent', () => {
   it('[H] an agent that exits when stdin closes gets no signal and leaves no timer', async () => {
      const agent = createFakeAcpAgent();
      const ending = endAgent(agent.handle);
      expect(agent.stdinCloses).toBe(1);
      await vi.advanceTimersByTimeAsync(500);
      agent.exit(0);
      await expect(ending).resolves.toBe('stdin_closed');
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(ENDING_TERM_DELAY_MS + ENDING_KILL_DELAY_MS);
      expect(agent.kills).toEqual([]);
   });

   it('[H] a lingering agent gets SIGTERM to the group once the delay has passed, not before', async () => {
      const agent = createFakeAcpAgent();
      const ending = endAgent(agent.handle);
      await vi.advanceTimersByTimeAsync(ENDING_TERM_DELAY_MS - 1);
      expect(agent.kills).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(agent.kills).toEqual([
         { pid: 4242, signal: 'SIGTERM', at: ENDING_TERM_DELAY_MS, afterExit: false },
      ]);
      agent.exit(null, 'SIGTERM');
      await expect(ending).resolves.toBe('sigterm');
   });

   it('[H] an agent that ignores SIGTERM gets SIGKILL after the kill delay, to the same pid', async () => {
      const agent = createFakeAcpAgent();
      const ending = endAgent(agent.handle);
      await vi.advanceTimersByTimeAsync(ENDING_TERM_DELAY_MS + ENDING_KILL_DELAY_MS - 1);
      expect(agent.kills.map(kill => kill.signal)).toEqual(['SIGTERM']);
      await vi.advanceTimersByTimeAsync(1);
      expect(agent.kills).toEqual([
         { pid: 4242, signal: 'SIGTERM', at: ENDING_TERM_DELAY_MS, afterExit: false },
         { pid: 4242, signal: 'SIGKILL', at: ENDING_TERM_DELAY_MS + ENDING_KILL_DELAY_MS, afterExit: false },
      ]);
      agent.exit(null, 'SIGKILL');
      await expect(ending).resolves.toBe('sigkill');
   });

   it('[H] a process that survives SIGKILL is given the exit wait, then the sequence ends', async () => {
      const agent = createFakeAcpAgent();
      const ending = endAgent(agent.handle);
      await vi.advanceTimersByTimeAsync(
         ENDING_TERM_DELAY_MS + ENDING_KILL_DELAY_MS + ENDING_EXIT_WAIT_MS);
      await expect(ending).resolves.toBe('sigkill');
      expect(agent.handle.hasExited()).toBe(false);
      expect(agent.kills.map(kill => kill.signal)).toEqual(['SIGTERM', 'SIGKILL']);
      expect(vi.getTimerCount()).toBe(0);
   });

   it('[H] SIGKILL is not sent when the agent exited after SIGTERM', async () => {
      const agent = createFakeAcpAgent();
      const ending = endAgent(agent.handle);
      await vi.advanceTimersByTimeAsync(ENDING_TERM_DELAY_MS + ENDING_KILL_DELAY_MS - 1);
      agent.exit(null, 'SIGTERM');
      await vi.advanceTimersByTimeAsync(ENDING_KILL_DELAY_MS);
      await expect(ending).resolves.toBe('sigterm');
      expect(agent.kills.map(kill => kill.signal)).toEqual(['SIGTERM']);
      expect(vi.getTimerCount()).toBe(0);
   });

   it('runs once however often it is requested', async () => {
      const agent = createFakeAcpAgent();
      const first  = endAgent(agent.handle);
      const second = endAgent(agent.handle);
      const third  = endAgent(agent.handle);
      await vi.advanceTimersByTimeAsync(ENDING_TERM_DELAY_MS + ENDING_KILL_DELAY_MS);
      agent.exit(null, 'SIGKILL');
      expect(await Promise.all([first, second, third])).toEqual(['sigkill', 'sigkill', 'sigkill']);
      await endAgent(agent.handle);
      expect(agent.stdinCloses).toBe(1);
      expect(agent.kills.map(kill => kill.signal)).toEqual(['SIGTERM', 'SIGKILL']);
   });

   it('[H] an already exited process is never touched', async () => {
      const agent = createFakeAcpAgent();
      agent.exit(0);
      await expect(endAgent(agent.handle)).resolves.toBe('none');
      expect(agent.stdinCloses).toBe(0);
      expect(agent.kills).toEqual([]);
   });
});
