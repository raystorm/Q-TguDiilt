import { describe, it, expect, vi } from 'vitest';
import { call, gate } from '../../drivers/__tests__/fake-governed-driver.js';
import {
   allow, begin, cardIds, createCx, createOpenAsksDriver, deferred, denials, detailsOf,
   editReport, eventsOf, namedTrace, playScript, reject, requestsOf, traceOf, updatesOf,
} from './agent.helpers.js';

describe('the ask on its card', () => {
   it('[H] the detail goes on the call\'s card, then the request names it', async () => {
      const { cx } = await playScript([
         call({ id: 'c1', kind: 'edit', title: 'Edit a.ts', paths: ['/repo/a.ts'] }),
         gate({ ...editReport, id: 'c1' }),
      ]);
      expect(namedTrace(cx, ['c1']).slice(0, 3)).toEqual(['card:c1', 'detail:c1', 'request:c1']);
      const [id] = cardIds(cx);
      const detail = detailsOf(cx)[0].params.update;
      expect(detail.sessionUpdate).toBe('tool_call_update');
      expect(detail.toolCallId).toBe(id);
      expect(detail.rawInput).toMatchObject({
         paths: editReport.paths, diff: editReport.diff, rawInput: editReport.rawInput,
      });
      expect(requestsOf(cx)[0].params.toolCall).toEqual({ toolCallId: id });
   });

   it('[H] the detail of an execute carries the whole command', async () => {
      const command = 'rm -rf build && ls';
      const { cx } = await playScript([
         call({ id: 'c1', kind: 'execute', title: 'Run', command }),
         gate({ id: 'c1', kind: 'execute', title: 'Run', command }),
      ]);
      expect(detailsOf(cx)[0].params.update.rawInput.command).toBe(command);
   });

   it('[H] the detail does not replace the card\'s title', async () => {
      const { cx } = await playScript([
         call({ id: 'c1', kind: 'execute', title: 'Edit a.ts', command: 'touch x' }),
         gate({ id: 'c1', kind: 'execute', title: 'Edit a.ts', command: 'touch x' }),
      ]);
      const [card, ...later] = updatesOf(cx, cardIds(cx)[0]);
      expect(card.title).toBe('Edit a.ts');
      for (const each of later) {
         expect(each.title ?? 'Edit a.ts').toContain('Edit a.ts');
         expect(each.title ?? '').not.toContain('Requested action');
         expect(each.title ?? '').not.toBe('touch x');
      }
      expect(later[0]).not.toHaveProperty('title');
      expect(later[0]).not.toHaveProperty('status');
      expect(later[0].rawInput.agentTitle).toBe('Edit a.ts');
   });

   it('the user answers on the right card', async () => {
      const answers = [deferred<unknown>(), deferred<unknown>()];
      const cx = createCx({ respond: (_params, index) => answers[index].promise });
      const { driver, decided } = createOpenAsksDriver(['c1', 'c2']);
      const { turn } = await begin(driver, { cx });
      await vi.waitFor(() => expect(requestsOf(cx)).toHaveLength(2));
      const [c1, c2] = cardIds(cx);
      expect(c1).not.toBe(c2);
      expect(requestsOf(cx).map(r => r.params.toolCall.toolCallId)).toEqual([c1, c2]);
      answers[0].resolve({ outcome: allow });
      answers[1].resolve({ outcome: reject });
      await turn;
      expect(decided).toEqual(['approve', 'deny']);
   });

   it('[H] a report with no id gets a card of its own, as before', async () => {
      const { cx } = await playScript([gate(editReport)]);
      const trace = traceOf(cx);
      expect(trace).toHaveLength(2);
      expect(trace[0]).toMatch(/^card:./);
      expect(trace[0]).not.toBe('card:-');
      expect(trace[1]).toBe(`request:${trace[0].slice('card:'.length)}`);
      expect(detailsOf(cx)[0].params.update.rawInput).toMatchObject({ diff: editReport.diff });
   });

   it('[H] an id that was never announced is announced first', async () => {
      const { cx } = await playScript([gate({ ...editReport, id: 'c9' })]);
      expect(namedTrace(cx, ['c9']).slice(0, 3)).toEqual(['card:c9', 'detail:c9', 'request:c9']);
      const [card] = updatesOf(cx, cardIds(cx)[0]);
      expect(card.sessionUpdate).toBe('tool_call');
      expect(typeof card.title).toBe('string');
      expect(JSON.stringify(card)).not.toContain(editReport.diff);
   });

   it('[H] a detail that cannot be sent means no request and a deny', async () => {
      const { scripted, cx, logger } = await playScript([
         call({ id: 'c1', kind: 'edit', title: 'Edit a.ts' }), gate({ ...editReport, id: 'c1' }),
      ], { cx: createCx({ failDetail: true }) });
      expect(requestsOf(cx)).toHaveLength(0);
      expect(scripted.decisions).toEqual(['deny']);
      expect(eventsOf(logger, 'governance_outcome')[0].data.reason).toBe('ask_failed');
   });

   it('the request offers Allow and Reject', async () => {
      const { cx } = await playScript([
         call({ id: 'c1', kind: 'edit', title: 'Edit a.ts' }), gate({ ...editReport, id: 'c1' }),
      ]);
      expect(requestsOf(cx)[0].params.options).toEqual([
         { kind: 'allow_once',  name: 'Allow',  optionId: 'allow'  },
         { kind: 'reject_once', name: 'Reject', optionId: 'reject' },
      ]);
   });

   it('an allow approves', async () => {
      const { scripted } = await playScript([
         call({ id: 'c1', kind: 'edit', title: 'Edit a.ts' }), gate({ ...editReport, id: 'c1' }),
      ]);
      expect(scripted.decisions).toEqual(['approve']);
   });

   it.each(denials)('[H] every answer maps as before: %s', async (_name, makeCx, logged) => {
      const { scripted, logger } = await playScript([
         call({ id: 'c1', kind: 'edit', title: 'Edit a.ts' }), gate({ ...editReport, id: 'c1' }),
      ], { cx: makeCx() });
      expect(scripted.decisions).toEqual(['deny']);
      expect(eventsOf(logger, 'governance_outcome')[0].data).toMatchObject(logged);
   });
});
