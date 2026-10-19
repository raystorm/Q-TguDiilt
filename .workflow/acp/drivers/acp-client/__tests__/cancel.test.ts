import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FakeAgent, deferred, flush, sent } from './acp-driver.helpers.js';
import { abortableTurn, askFor, say, wrapUp } from './cancel.helpers.js';
import { SESSION, entries, logged } from './failures.helpers.js';
import { CANCELLED } from './permissions.helpers.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(()  => { vi.useRealTimers(); });

const responses  = (agent: FakeAgent) => agent.received.filter(message => !('method' in message));
const allows     = (agent: FakeAgent) => responses(agent).filter((m: any) => 'allow' === m.result?.outcome?.optionId);
const outcomeOf  = (response: unknown) => (response as any).result.outcome;
const rpcFailure = (message: string, code: number) => Object.assign(new Error(message), { code });

describe('abort during a turn', () => {
   it('sends session/cancel once, keeps waiting for the prompt and ends nothing', async () => {
      const t = await abortableTurn();
      let settled = false;
      void t.turn.then(() => { settled = true; });
      t.controller.abort();
      t.controller.signal.dispatchEvent(new Event('abort'));
      await flush();
      expect(sent(t.agent, 'session/cancel')).toEqual([{ sessionId: SESSION }]);
      expect(settled).toBe(false);
      t.finish({ stopReason: 'cancelled' });
      expect(await t.turn).toMatchObject({ cancelled: true });
      expect(t.agent.kills).toEqual([]);
      expect(t.agent.stdinCloses).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      await wrapUp(t);
   });

   it('consumes the text that follows the cancel and settles with all of it', async () => {
      const t = await abortableTurn();
      await say(t.agent, 'one ');
      t.controller.abort();
      await t.agent.arrived('session/cancel');
      await say(t.agent, 'two ');
      await say(t.agent, 'three');
      t.finish({ stopReason: 'cancelled' });
      expect(await t.turn).toStrictEqual({ text: 'one two three', sessionId: SESSION, toolCalls: [], cancelled: true });
      expect(t.logger.info).not.toHaveBeenCalledWith('agent_cancel_unrequested', expect.anything());
      await wrapUp(t);
   });

   it('with no permission request pending, only session/cancel is sent', async () => {
      const t = await abortableTurn();
      const before = t.agent.received.length;
      t.controller.abort();
      await flush();
      expect(t.agent.received.slice(before).map(message => (message as any).method)).toEqual(['session/cancel']);
      t.finish({ stopReason: 'cancelled' });
      await t.turn;
      await wrapUp(t);
   });
});

describe('permission requests around an abort', () => {
   it('[H] a pending request is answered cancelled at once, and a late answer sends nothing more', async () => {
      const decided    = deferred<'approve'>();
      const onToolCall = vi.fn(() => decided.promise);
      const t = await abortableTurn({ onToolCall });
      const reply = askFor(t.agent, 'r1');
      await flush();
      expect(onToolCall).toHaveBeenCalledTimes(1);
      t.controller.abort();
      expect(outcomeOf(await reply)).toEqual(CANCELLED);
      await t.agent.arrived('session/cancel');
      decided.resolve('approve');
      await flush();
      expect(responses(t.agent)).toHaveLength(1);
      t.finish({ stopReason: 'cancelled' });
      expect((await t.turn).toolCalls.map(call => call.decision)).toEqual(['deny']);
      await wrapUp(t);
   });

   it('[H] requests that arrive after the abort are cancelled without asking the handler', async () => {
      const onToolCall = vi.fn(async () => 'approve' as const);
      const t = await abortableTurn({ onToolCall });
      t.controller.abort();
      await flush();
      const replies = await Promise.all([askFor(t.agent, 'r1'), askFor(t.agent, 'r2')]);
      expect(replies.map(outcomeOf)).toEqual([CANCELLED, CANCELLED]);
      expect(onToolCall).not.toHaveBeenCalled();
      t.finish({ stopReason: 'cancelled' });
      await t.turn;
      await wrapUp(t);
   });

   it.each([
      ['the same tick the signal aborts', (settle, abort) => { settle(); abort(); }],
      ['one microtask before the abort',  async (settle, abort) => { settle(); await Promise.resolve(); abort(); }],
      ['after the abort',                 (settle, abort) => { abort(); settle(); }],
   ] as Array<[string, (settle: () => void, abort: () => void) => unknown]>)(
      '[H] an approve that resolves %s never becomes an allow',
      async (_when, race) => {
         const decided = deferred<'approve'>();
         const t = await abortableTurn({ onToolCall: () => decided.promise });
         const reply = askFor(t.agent, 'r1');
         await flush();
         await race(() => decided.resolve('approve'), () => t.controller.abort());
         expect(outcomeOf(await reply)).toEqual(CANCELLED);
         await flush();
         expect(allows(t.agent)).toEqual([]);
         expect(responses(t.agent)).toHaveLength(1);
         t.finish({ stopReason: 'cancelled' });
         expect((await t.turn).toolCalls.map(call => call.decision)).toEqual(['deny']);
         await wrapUp(t);
      },
   );

   it('a reply that reaches an already-ended request is ignored', async () => {
      const echo = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const decided = deferred<'approve'>();
      const t = await abortableTurn({ onToolCall: () => decided.promise });
      const reply = askFor(t.agent, 'r1', 'req-1');
      await flush();
      t.controller.abort();
      await reply;
      await t.agent.raw({ jsonrpc: '2.0', id: 'req-1', error: { code: -32602, message: 'no such request' } });
      await flush();
      expect(echo).toHaveBeenCalledWith('Got response to unknown request', 'req-1');
      echo.mockRestore();
      t.finish({ stopReason: 'cancelled' });
      expect(await t.turn).toMatchObject({ cancelled: true });
      expect(t.logger.warn).not.toHaveBeenCalled();
      expect(t.logger.error).not.toHaveBeenCalled();
      decided.resolve('approve');
      await wrapUp(t);
   });
});

describe('the result of an aborted turn', () => {
   it.each([
      ['stopReason cancelled',  t => t.finish({ stopReason: 'cancelled' })],
      ['stopReason end_turn',   t => t.finish({ stopReason: 'end_turn' })],
      ['stopReason max_tokens', t => t.finish({ stopReason: 'max_tokens' })],
      ['a JSON-RPC error',      t => t.fail(rpcFailure('boom', -32603))],
      ['a connection error',    t => t.agent.exit(1)],
   ] as Array<[string, (t: Awaited<ReturnType<typeof abortableTurn>>) => void]>)(
      '[H] a turn whose signal aborted is cancelled when the prompt returns %s',
      async (_label, end) => {
         const t = await abortableTurn();
         await say(t.agent, 'partial');
         t.controller.abort();
         await flush();
         end(t);
         expect(await t.turn).toStrictEqual({ text: 'partial', sessionId: SESSION, toolCalls: [], cancelled: true });
         await wrapUp(t);
      },
   );

   it.each([
      ['an error answer',               rpcFailure('CANARY-FAILURE', -32603),         'internal'],
      ['an authentication requirement', rpcFailure('Authentication required', -32000), 'provider_auth'],
   ] as const)('a failure after the abort settles cancelled and is logged by kind only: %s', async (_label, failure, kind) => {
      const t = await abortableTurn();
      t.controller.abort();
      await flush();
      t.fail(failure);
      expect(await t.turn).toMatchObject({ cancelled: true });
      expect(entries(t.logger, 'agent_failure_after_cancel')).toEqual([{ agentSessionId: SESSION, failureKind: kind }]);
      expect(logged(t.logger)).not.toContain('CANARY-FAILURE');
      await wrapUp(t);
   });
});
