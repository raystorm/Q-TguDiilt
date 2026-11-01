import { describe, it, expect, vi } from 'vitest';
import { call, gate, say, update } from '../../drivers/__tests__/fake-governed-driver.js';
import {
   allow, begin, cardIds, createCx, createOpenAsksDriver, createScriptedDriver, deferred,
   detailsOf, editReport, lastTitled, makeAgent, namedTrace, playScript, readReport, reject,
   requestsOf, startTurn, textParam, updatesOf, wait,
} from './agent.helpers.js';

const NOTE = 'RAW-NOTE-X';
const DIFF = 'DIFF-TEXT-Y';

describe('cards: every reported call is a card', () => {
   it('[H] calls and text reach the IDE in the order they were reported', async () => {
      const { cx } = await playScript([
         say('a'), call({ id: 'c1', kind: 'read', title: 'Read a.ts' }), say('b'),
         call({ id: 'c2', kind: 'search', title: 'Find' }),
         call({ id: 'c3', kind: 'think', title: 'Plan' }),
         call({ id: 'c4', kind: 'execute', title: 'Run', command: 'ls' }),
      ]);
      expect(namedTrace(cx, ['c1', 'c2', 'c3', 'c4'])).toEqual(
         ['text:a', 'card:c1', 'text:b', 'card:c2', 'card:c3', 'card:c4'],
      );
   });

   it.each([
      ['execute',
         {
            kind: 'execute', title: 'Run it', command: 'ls -la',
            rawInput: { command: 'ls -la', note: NOTE },
         },
         { kind: 'execute', title: 'Run it', rawInput: { command: 'ls -la' } }],
      ['edit',
         {
            kind: 'edit', title: 'Edit', paths: ['/r/a.ts'], diff: DIFF,
            content: [{ type: 'diff', newText: DIFF }],
         },
         { kind: 'edit', title: 'Edit', locations: [{ path: '/r/a.ts' }] }],
      ['read',
         { kind: 'read', title: 'Read', paths: ['/r/a.ts', '/r/b.ts'] },
         { kind: 'read', title: 'Read', locations: [{ path: '/r/a.ts' }, { path: '/r/b.ts' }] }],
      ['fetch',
         { kind: 'fetch', title: 'Get page' },
         { kind: 'fetch', title: 'Get page' }],
   ])('[H] a %s card shows only what identifies the call', async (_name, fields, shown) => {
      const { cx } = await playScript([call({ id: 'c1', ...fields } as any)]);
      const id = cardIds(cx)[0];
      expect(updatesOf(cx, id)).toEqual([{ sessionUpdate: 'tool_call', toolCallId: id, ...shown }]);
      expect(JSON.stringify(cx.calls)).not.toContain(NOTE);
      expect(JSON.stringify(cx.calls)).not.toContain(DIFF);
   });

   it('[H] the card does not hide a lying title', async () => {
      const { cx } = await playScript([
         call({ id: 'c1', kind: 'execute', title: 'Read file', command: 'rm -rf /' }),
      ]);
      const [card] = updatesOf(cx, cardIds(cx)[0]);
      expect(card.title).toBe('Read file');
      expect(card.rawInput).toEqual({ command: 'rm -rf /' });
   });
});

describe('cards: ids', () => {
   it.each([
      ['a new downstream session', 'drv-B'],
      ['the same downstream session', 'drv-A'],
   ])('[H] %s that reuses an agent id gets another card id', async (_name, second) => {
      const scripted = createScriptedDriver();
      scripted.script([call({ id: 'call-1', kind: 'read', title: 'A' })], { sessionId: 'drv-A' });
      scripted.script([call({ id: 'call-1', kind: 'read', title: 'B' })], { sessionId: second });
      const first = await begin(scripted.driver);
      await first.turn;
      const cx = createCx();
      await first.agent.prompt({ sessionId: first.sessionId, ...textParam('again') }, cx);
      expect(cardIds(first.cx)).toHaveLength(1);
      expect(cardIds(cx)).toHaveLength(1);
      expect(cardIds(cx)[0]).not.toBe(cardIds(first.cx)[0]);
   });

   it('[H] two chats that use the same agent id do not interfere', async () => {
      const scripted = createScriptedDriver();
      scripted.script([call({ id: 'call-1', kind: 'read', title: 'A' }), wait('wa')]);
      scripted.script([call({ id: 'call-1', kind: 'read', title: 'B' }), wait('wb')]);
      const { agent } = makeAgent({ driver: scripted.driver });
      const [cxA, cxB] = [createCx(), createCx()];
      const a = await startTurn(agent, cxA);
      await scripted.reached('wa');
      const b = await startTurn(agent, cxB);
      await scripted.reached('wb');
      scripted.release('wa');
      scripted.release('wb');
      await a.turn;
      await b.turn;
      expect(cardIds(cxA)).toHaveLength(1);
      expect(cardIds(cxB)).toHaveLength(1);
      expect(cardIds(cxA)[0]).not.toBe(cardIds(cxB)[0]);
      expect(cxA.calls.every(c => a.sessionId === c.params.sessionId)).toBe(true);
      expect(cxB.calls.every(c => b.sessionId === c.params.sessionId)).toBe(true);
   });

   it('the same call keeps one id for its whole life', async () => {
      const { cx } = await playScript([
         call({ id: 'c1', kind: 'edit', title: 'Edit a.ts' }),
         update({ id: 'c1', status: 'running' }),
         gate({ ...editReport, id: 'c1' }),
      ]);
      const trace = namedTrace(cx, ['c1']);
      expect(trace.map(entry => entry.split(':')[0]))
         .toEqual(['card', 'update', 'detail', 'request', 'update']);
      expect(trace.every(entry => entry.endsWith(':c1'))).toBe(true);
   });

   it.each([
      ['1:x', 'x'],
      ['a:b', 'a'],
      [`${'p'.repeat(200)}1`, `${'p'.repeat(200)}2`],
   ])('[H] the agent ids %j and %j do not collide', async (a, b) => {
      const { cx } = await playScript([
         call({ id: a, kind: 'read', title: 'A' }), call({ id: b, kind: 'read', title: 'B' }),
      ]);
      expect(cardIds(cx)).toHaveLength(2);
      expect(new Set(cardIds(cx)).size).toBe(2);
   });
});

describe('cards: what the agent reports reaches them', () => {
   it.each([
      ['pending', 'pending'],
      ['running', 'in_progress'],
      ['failed', 'failed'],
   ] as const)('an agent status of %s is shown as %s, then completed', async (status, shown) => {
      const { cx } = await playScript([
         call({ id: 'c1', kind: 'execute', title: 'Run', command: 'ls', status }),
         update({ id: 'c1', status: 'completed' }),
      ]);
      const [card, next] = updatesOf(cx, cardIds(cx)[0]);
      expect(card.status).toBe(shown);
      expect(next.status).toBe('completed');
   });

   it('[H] a later update changes only what it carries', async () => {
      const { cx } = await playScript([
         call({ id: 'c1', kind: 'execute', title: 'Run', command: 'ls', paths: ['/r/a.ts'] }),
         update({ id: 'c1', status: 'completed' }),
         update({ id: 'c1', title: 'Run again' }),
      ]);
      const id = cardIds(cx)[0];
      const [, status, title] = updatesOf(cx, id);
      expect(status)
         .toEqual({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed' });
      expect(title)
         .toEqual({ sessionUpdate: 'tool_call_update', toolCallId: id, title: 'Run again' });
   });

   it('[H] the first sight of an id is an announcement, with a title', async () => {
      const { cx } = await playScript([
         update({ id: 'c9', status: 'running' }), update({ id: 'c9', status: 'completed' }),
      ]);
      const [first, next] = cx.calls.map(c => c.params.update);
      expect(first.sessionUpdate).toBe('tool_call');
      expect(typeof first.title).toBe('string');
      expect(first.status).toBe('in_progress');
      expect(next.sessionUpdate).toBe('tool_call_update');
      expect(next.toolCallId).toBe(first.toolCallId);
   });

   it('a repeated announcement is an update, not a second card', async () => {
      const { cx } = await playScript([
         call({ id: 'c1', kind: 'read', title: 'A' }), call({ id: 'c1', title: 'A2' }),
      ]);
      expect(namedTrace(cx, ['c1'])).toEqual(['card:c1', 'update:c1']);
   });
});

describe('cards: calls open at once', () => {
   it('[H] two calls open at once keep their own state', async () => {
      const answers = [deferred<unknown>(), deferred<unknown>()];
      const cx = createCx({ respond: (_params, index) => answers[index].promise });
      const { driver, decided } = createOpenAsksDriver(['c1', 'c2']);
      const { turn } = await begin(driver, { cx });
      await vi.waitFor(() => expect(requestsOf(cx)).toHaveLength(2));
      answers[1].resolve({ outcome: allow });
      answers[0].resolve({ outcome: reject });
      await turn;
      expect(decided).toEqual(['deny', 'approve']);
      const [c1, c2] = cardIds(cx);
      expect(requestsOf(cx).map(r => r.params.toolCall.toolCallId)).toEqual([c1, c2]);
      expect(detailsOf(cx).map(d => d.params.update.toolCallId)).toEqual([c1, c2]);
      expect(detailsOf(cx).map(d => d.params.update.rawInput.agentTitle))
         .toEqual(['Edit c1', 'Edit c2']);
      expect(lastTitled(cx, c1).title.endsWith('rejected by you')).toBe(true);
      expect(lastTitled(cx, c2).title.endsWith('allowed by you')).toBe(true);
   });

   it('a rule-resolved call with no id has no card', async () => {
      const { cx } = await playScript(
         [gate(readReport)], { rules: [{ kind: 'read', action: 'approve' }] },
      );
      expect(cx.calls).toEqual([]);
   });
});
