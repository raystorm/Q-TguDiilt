import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionCollapseError } from '../../../protocol/errors.js';
import { OUTPUT_END_GRACE_MS } from '../acp-driver.js';
import { AgentExitedError } from '../errors.js';
import { STDERR_TAIL_MAX_BYTES } from '../stderr-tail.js';
import { deferred, flush } from './acp-driver.helpers.js';
import { abortableTurn, askFor, wrapUp } from './cancel.helpers.js';
import { SESSION, entries, failureOf } from './failures.helpers.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(()  => { vi.useRealTimers(); });

describe('an agent that is gone', () => {
   it('[H] answering a request of an agent that exited fails the turn with its last words '
      + 'and crashes nothing', async () => {
      const decided = deferred<'approve'>();
      const t = await abortableTurn({ onToolCall: () => decided.promise });
      const failure = failureOf(t.turn);
      void askFor(t.agent, 'r1');
      await flush();
      t.agent.stderr('fatal: out of memory\n');
      t.agent.exit(137);
      const error = await failure;
      expect(error).toBeInstanceOf(AgentExitedError);
      expect(error?.message).toContain('out of memory');
      decided.resolve('approve');
      await flush();
      expect(t.agent.kills).toEqual([]);
      expect(t.agent.stdinCloses).toBe(0);
   });

   it('[H] a flood of stderr is drained and the kept tail stays within its bound', async () => {
      const t = await abortableTurn();
      const failure = failureOf(t.turn);
      const line = `${'a'.repeat(4095)}\n`;
      for (let i = 0; i < 12800; i++) { t.agent.stderr(line); }
      t.agent.exit(1);
      const message = (await failure)?.message ?? '';
      expect(message).toContain('aaaa');
      expect(message.length).toBeLessThan(STDERR_TAIL_MAX_BYTES + 500);
   });

   it('the end of the agent\'s output while it runs is a dead connection', async () => {
      const t = await abortableTurn();
      const failure = failureOf(t.turn);
      t.agent.stderr('closing time\n');
      t.agent.endOutput();
      await vi.advanceTimersByTimeAsync(OUTPUT_END_GRACE_MS);
      expect((await failure)?.message).toContain('closing time');
      expect(t.agent.stdinCloses).toBe(1);
      await expect(t.driver.execute('again', { sessionId: SESSION })).rejects.toBeInstanceOf(SessionCollapseError);
      t.agent.exit(0);
      await flush();
      expect(entries(t.logger, 'agent_process_ended'))
         .toEqual([{ pid: 4000, agentSessionId: SESSION, reason: 'protocol_failure', stage: 'stdin_closed' }]);
      await wrapUp(t);
   });

   it('an agent that exits right after its output ended is an exit, not a closed output', async () => {
      const t = await abortableTurn();
      const failure = failureOf(t.turn);
      t.agent.stderr('bye\n');
      t.agent.endOutput();
      await flush();
      t.agent.exit(2);
      const error = await failure;
      expect(error).toBeInstanceOf(AgentExitedError);
      expect(error?.message).toContain('exit code 2');
      expect(error?.message).toContain('bye');
      await vi.advanceTimersByTimeAsync(OUTPUT_END_GRACE_MS);
      expect(entries(t.logger, 'agent_process_ended'))
         .toEqual([{ pid: 4000, agentSessionId: SESSION, reason: 'crash', stage: 'none' }]);
      expect(vi.getTimerCount()).toBe(0);
   });
});
