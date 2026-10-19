import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionCollapseError } from '../../../protocol/errors.js';
import { CANCEL_DEADLINE_MS } from '../acp-driver.js';
import { ENDING_KILL_DELAY_MS, ENDING_TERM_DELAY_MS } from '../ending.js';
import { flush, sent } from './acp-driver.helpers.js';
import { abortableTurn, askFor, say, wrapUp } from './cancel.helpers.js';
import { ALLOW, REJECT, SESSION, entries, logged } from './failures.helpers.js';
import { CANCELLED } from './permissions.helpers.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(()  => { vi.useRealTimers(); });

describe('the wind-down deadline', () => {
   it('[H] ends the agent that never answers the cancel and settles cancelled with the text so far', async () => {
      expect(CANCEL_DEADLINE_MS).toBe(5000);
      const onToolCall = vi.fn(async () => 'approve' as const);
      const t = await abortableTurn({ onToolCall });
      await say(t.agent, 'so far');
      t.controller.abort();
      const abortedAt = Date.now();
      let settled: unknown;
      void t.turn.then(result => { settled = result; });

      await vi.advanceTimersByTimeAsync(CANCEL_DEADLINE_MS - 1);
      expect(settled).toBeUndefined();
      expect(t.agent.stdinCloses).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toStrictEqual({ text: 'so far', sessionId: SESSION, toolCalls: [], cancelled: true });
      expect(t.agent.stdinCloses).toBe(1);
      expect(t.logger.warn).toHaveBeenCalledWith('agent_cancel_deadline', {
         agentSessionId: SESSION, pid: 4000, deadlineMs: CANCEL_DEADLINE_MS,
      });

      // The connection is dead: a request now is cancelled and never asked.
      expect(((await askFor(t.agent, 'late')) as any).result.outcome).toEqual(CANCELLED);
      expect(onToolCall).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(ENDING_TERM_DELAY_MS);
      await vi.advanceTimersByTimeAsync(ENDING_KILL_DELAY_MS);
      expect(t.agent.kills.map(kill => [kill.signal, kill.at - abortedAt])).toEqual([
         ['SIGTERM', CANCEL_DEADLINE_MS + ENDING_TERM_DELAY_MS],
         ['SIGKILL', CANCEL_DEADLINE_MS + ENDING_TERM_DELAY_MS + ENDING_KILL_DELAY_MS],
      ]);
      t.agent.exit(null, 'SIGKILL');
      await flush();
      expect(entries(t.logger, 'agent_process_ended'))
         .toEqual([{ pid: 4000, agentSessionId: SESSION, reason: 'deadline', stage: 'sigkill' }]);
      expect(vi.getTimerCount()).toBe(0);
   });

   it('[H] the next prompt relaunches, and an old session id is a collapse', async () => {
      const t = await abortableTurn({}, 2);
      t.agents[1].respond('session/new', () => ({ sessionId: 'agent-sess-2' }));
      t.controller.abort();
      await vi.advanceTimersByTimeAsync(CANCEL_DEADLINE_MS);
      await t.turn;
      await expect(t.driver.execute('again', { sessionId: SESSION })).rejects.toBeInstanceOf(SessionCollapseError);
      expect(t.connect).toHaveBeenCalledTimes(1);
      const fresh = await t.driver.execute('fresh');
      expect(t.connect).toHaveBeenCalledTimes(2);
      expect(fresh.sessionId).toBe('agent-sess-2');
      expect(entries(t.logger, 'agent_relaunched')).toEqual([{ pid: 4001, after: 'deadline' }]);
      await wrapUp(t);
   });

   it('[H] the timer starts at the abort, not before', async () => {
      const t = await abortableTurn();
      await vi.advanceTimersByTimeAsync(20000);
      expect(t.agent.stdinCloses).toBe(0);
      t.controller.abort();
      await vi.advanceTimersByTimeAsync(CANCEL_DEADLINE_MS - 1);
      expect(t.agent.stdinCloses).toBe(0);
      expect(t.agent.kills).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(t.agent.stdinCloses).toBe(1);
      await t.turn;
      await wrapUp(t);
   });

   it('[H] an agent that answers in time is not killed later, and the next turn on it completes', async () => {
      const t = await abortableTurn();
      t.controller.abort();
      await vi.advanceTimersByTimeAsync(3000);
      t.finish({ stopReason: 'cancelled' });
      const first = await t.turn;
      expect(vi.getTimerCount()).toBe(0);

      let release!: (result: unknown) => void;
      t.agent.respond('session/prompt', () => new Promise(resolve => { release = resolve; }));
      const second = t.driver.execute('again', { sessionId: first.sessionId });
      await flush();
      await vi.advanceTimersByTimeAsync(CANCEL_DEADLINE_MS);
      expect(t.agent.kills).toEqual([]);
      expect(t.agent.stdinCloses).toBe(0);
      release({ stopReason: 'end_turn' });
      expect(Object.keys(await second)).not.toContain('cancelled');
      await wrapUp(t);
   });

   it('a second abort does not restart or extend the timer', async () => {
      const t = await abortableTurn();
      t.controller.abort();
      await vi.advanceTimersByTimeAsync(3000);
      t.controller.signal.dispatchEvent(new Event('abort'));
      await vi.advanceTimersByTimeAsync(CANCEL_DEADLINE_MS - 3000 - 1);
      expect(t.agent.stdinCloses).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(t.agent.stdinCloses).toBe(1);
      expect(sent(t.agent, 'session/cancel')).toHaveLength(1);
      await t.turn;
      await wrapUp(t);
   });

   it('[H] a cancel keeps the session and its process', async () => {
      const t = await abortableTurn();
      t.controller.abort();
      await flush();
      t.finish({ stopReason: 'cancelled' });
      const first = await t.turn;
      t.agent.respond('session/prompt', () => ({ stopReason: 'end_turn' }));
      const second = await t.driver.execute('again', { sessionId: first.sessionId });
      expect(t.connect).toHaveBeenCalledTimes(1);
      expect(sent(t.agent, 'session/new')).toHaveLength(1);
      expect(sent(t.agent, 'session/prompt').map(params => params.sessionId)).toEqual([SESSION, SESSION]);
      expect(second.sessionId).toBe(SESSION);
      expect(Object.keys(second)).not.toContain('cancelled');
      expect(t.agent.stdinCloses).toBe(0);
      await wrapUp(t);
   });

   it('[H] close waits for an ending sequence the deadline already started', async () => {
      const t = await abortableTurn();
      t.controller.abort();
      await vi.advanceTimersByTimeAsync(CANCEL_DEADLINE_MS);
      await t.turn;
      expect(t.agent.stdinCloses).toBe(1);
      let closed = false;
      const closing = t.driver.close().then(() => { closed = true; });
      await vi.advanceTimersByTimeAsync(ENDING_TERM_DELAY_MS + ENDING_KILL_DELAY_MS);
      expect(t.agent.kills.map(kill => kill.signal)).toEqual(['SIGTERM', 'SIGKILL']);
      expect(t.agent.stdinCloses).toBe(1);
      expect(closed).toBe(false);
      t.agent.exit(null, 'SIGKILL');
      await closing;
      expect(closed).toBe(true);
   });
});

describe('logging around a cancel', () => {
   it('[H] no entry holds prompt text, agent text, titles, raw input, diffs or stderr', async () => {
      const t = await abortableTurn({ context: 'CANARY-CONTEXT', onToolCall: async () => 'approve' }, 1, 'CANARY-PROMPT');
      await say(t.agent, 'CANARY-AGENT-TEXT');
      await t.agent.notify('session/update', {
         sessionId: SESSION,
         update: {
            sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'CANARY-TITLE', kind: 'edit', status: 'in_progress',
            rawInput: { command: 'CANARY-RAW' },
            content:  [{ type: 'diff', path: '/r/a.ts', oldText: 'CANARY-OLD', newText: 'CANARY-NEW' }],
         },
      });
      const reply = t.agent.request('session/request_permission', {
         sessionId: SESSION, toolCall: { toolCallId: 'c1', title: 'CANARY-REQ-TITLE' }, options: [ALLOW, REJECT],
      });
      await flush();
      t.agent.stderr('CANARY-STDERR\n');
      t.controller.abort();
      await reply;
      await vi.advanceTimersByTimeAsync(CANCEL_DEADLINE_MS);
      await t.turn;
      await vi.advanceTimersByTimeAsync(ENDING_TERM_DELAY_MS + ENDING_KILL_DELAY_MS);
      t.agent.exit(null, 'SIGKILL');
      await flush();
      expect(logged(t.logger)).toContain('agent_cancel_deadline');
      expect(logged(t.logger)).not.toContain('CANARY');
   });
});
