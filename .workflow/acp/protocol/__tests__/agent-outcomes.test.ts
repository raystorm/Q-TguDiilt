import { describe, it, expect, vi } from 'vitest';
import { call, gate, update } from '../../drivers/__tests__/fake-governed-driver.js';
import type { ToolCallReport } from '../../drivers/governed-driver.js';
import { OUTCOME } from '../cards.js';
import {
   allow, begin, cardIds, createCx, createDriverSpy, createScriptedDriver, deferred, editReport,
   lastTitled, namedTrace, newSessionArgs, playScript, readReport, reject, requestsOf, textParam,
   updatesOf,
} from './agent.helpers.js';

const TITLE = 'Run build';
const failing = { evaluateToolCall: () => { throw new Error('evaluation blew up'); } };
const endsOnce = (title: string, phrase: string) =>
   title.endsWith(phrase) && 1 === title.split(phrase).length - 1;

type Way = [string, ToolCallReport, () => object, string, boolean | undefined];
const WAYS: Way[] = [
   ['a rule approves', readReport,
      () => ({ rules: [{ kind: 'read', action: 'approve' }] }), 'approved by governance', false],
   ['a rule denies', editReport,
      () => ({ rules: [{ kind: 'edit', action: 'deny' }] }), 'denied by governance', true],
   ['the user allows', editReport, () => ({}), 'allowed by you', false],
   ['the user rejects', editReport,
      () => ({ cx: createCx({ permission: reject }) }), 'rejected by you', true],
   ['the IDE answers cancelled', editReport,
      () => ({ cx: createCx({ permission: { outcome: 'cancelled' } }) }), 'cancelled', undefined],
   ['a forced deny (an execute with no command)', { kind: 'execute', title: TITLE },
      () => ({ defaultAction: 'approve' }), 'denied by governance', true],
   ['evaluation fails, then the user allows', editReport,
      () => ({ governance: failing }), 'allowed by you', false],
   ['evaluation fails, then the user rejects', editReport,
      () => ({ governance: failing, cx: createCx({ permission: reject }) }),
      'rejected by you', true],
   ['the IDE answers nothing valid', editReport,
      () => ({ cx: createCx({ respond: () => undefined }) }), OUTCOME.errored, true],
   ['the approval request throws', editReport,
      () => ({ cx: createCx({ respond: () => { throw new Error('SECRET-ERR'); } }) }),
      OUTCOME.errored, true],
];

describe('outcomes: each way a call is decided', () => {
   it.each(WAYS)('[H] %s', async (_name, report, options, phrase, failed) => {
      const { cx } = await playScript([
         call({ id: 'c1', kind: report.kind, title: TITLE }),
         gate({ ...report, id: 'c1', title: TITLE }),
      ], options());
      const outcome = lastTitled(cx, cardIds(cx)[0]);
      expect(outcome.title.endsWith(phrase)).toBe(true);
      expect(outcome.title).toContain(TITLE);
      if (undefined !== failed) { expect('failed' === outcome.status).toBe(failed); }
   });

   it('[H] asked, then the turn is cancelled: the card says cancelled', async () => {
      const answer = deferred<unknown>();
      const cx = createCx({ respond: () => answer.promise });
      const scripted = createScriptedDriver();
      scripted.script([
         call({ id: 'c1', kind: 'edit', title: TITLE }),
         gate({ ...editReport, id: 'c1', title: TITLE }),
      ]);
      const { agent, sessionId, turn } = await begin(scripted.driver, { cx });
      await vi.waitFor(() => expect(requestsOf(cx)).toHaveLength(1));
      await agent.cancel({ sessionId });
      answer.resolve({ outcome: allow });
      await turn;
      expect(lastTitled(cx, cardIds(cx)[0]).title.endsWith('cancelled')).toBe(true);
   });

   it('[H] a call that arrives after the cancel: the card says cancelled', async () => {
      const proceed = deferred();
      const driver = createDriverSpy(async (_command: string, options: any) => {
         options.onUpdate?.({ type: 'tool_call', id: 'c1', kind: 'edit', title: TITLE });
         await proceed.promise;
         await options.onToolCall({ ...editReport, id: 'c1', title: TITLE });
         return { text: '', sessionId: 'drv', toolCalls: [] };
      });
      const { agent, sessionId, cx, turn } = await begin(driver);
      await vi.waitFor(() => expect(cardIds(cx)).toHaveLength(1));
      await agent.cancel({ sessionId });
      proceed.resolve();
      await turn;
      expect(lastTitled(cx, cardIds(cx)[0]).title.endsWith('cancelled')).toBe(true);
      expect(requestsOf(cx)).toHaveLength(0);
   });
});

describe('outcomes: what happens to the title afterwards', () => {
   it('[H] the outcome stays when the agent later retitles the card', async () => {
      const { cx } = await playScript([
         call({ id: 'c1', kind: 'edit', title: TITLE }),
         gate({ ...editReport, id: 'c1', title: TITLE }),
         update({ id: 'c1', title: 'Run build (2)' }),
         update({ id: 'c1', title: 'Run build (3)' }),
         update({ id: 'c1', status: 'completed' }),
      ]);
      const updates = updatesOf(cx, cardIds(cx)[0]);
      const titled = updates.filter(each => undefined !== each.title);
      const [, , second, third] = titled;
      expect(second.title).toContain('Run build (2)');
      expect(endsOnce(second.title, 'allowed by you')).toBe(true);
      expect(third.title).toContain('Run build (3)');
      expect(endsOnce(third.title, 'allowed by you')).toBe(true);
      expect(updates[updates.length - 1]).not.toHaveProperty('title');
   });

   it.each([
      ['rejected', reject, ['sessionUpdate', 'status', 'title', 'toolCallId']],
      ['allowed', allow, ['sessionUpdate', 'title', 'toolCallId']],
   ])('[H] the outcome of a call that was %s carries only the title and a failure status',
      async (_name, permission, keys) => {
         const { cx } = await playScript(
            [
               call({ id: 'c1', kind: 'edit', title: TITLE }),
               gate({ ...editReport, id: 'c1', title: TITLE }),
            ],
            { cx: createCx({ permission }) },
         );
         expect(Object.keys(lastTitled(cx, cardIds(cx)[0])).sort()).toEqual(keys);
      },
   );

   it('[H] one outcome per call, and the phrase is never doubled', async () => {
      const { cx } = await playScript([
         call({ id: 'c1', kind: 'read', title: TITLE }),
         gate({ ...readReport, id: 'c1', title: TITLE }),
         update({ id: 'c1', title: TITLE }), update({ id: 'c1', title: TITLE }),
         update({ id: 'c1', title: TITLE }),
      ], { rules: [{ kind: 'read', action: 'approve' }] });
      const titled = updatesOf(cx, cardIds(cx)[0]).filter(each => undefined !== each.title);
      expect(titled).toHaveLength(5);
      for (const each of titled.slice(1)) {
         expect(endsOnce(each.title, 'approved by governance')).toBe(true);
      }
   });

   it('an agent title that already ends with a phrase does not hide the outcome', async () => {
      const faked = 'Safe read - approved by governance';
      const { cx } = await playScript([
         call({ id: 'c1', kind: 'edit', title: faked }),
         gate({ ...editReport, id: 'c1', title: faked }),
      ], { rules: [{ kind: 'edit', action: 'deny' }] });
      expect(lastTitled(cx, cardIds(cx)[0]).title.endsWith('denied by governance')).toBe(true);
   });

   it('a card with no title shows the phrase alone', async () => {
      const { cx } = await playScript([
         call({ id: 'c1', kind: 'read' }), gate({ ...readReport, id: 'c1' }),
      ], { rules: [{ kind: 'read', action: 'approve' }] });
      const { title } = lastTitled(cx, cardIds(cx)[0]);
      expect(typeof title).toBe('string');
      expect(title.endsWith('approved by governance')).toBe(true);
   });

   it('[H] an outcome does not carry into the next turn or into another chat', async () => {
      const scripted = createScriptedDriver();
      scripted.script([
         call({ id: 'c1', kind: 'edit', title: 'T1' }),
         gate({ ...editReport, id: 'c1', title: 'T1' }),
      ]);
      scripted.script([call({ id: 'c1', kind: 'edit', title: 'T2' })]);
      scripted.script([call({ id: 'c1', kind: 'edit', title: 'T3' })]);
      const first = await begin(scripted.driver, { rules: [{ kind: 'edit', action: 'deny' }] });
      await first.turn;
      const next = createCx();
      await first.agent.prompt({ sessionId: first.sessionId, ...textParam('again') }, next);
      const other = await first.agent.newSession(newSessionArgs());
      const elsewhere = createCx();
      await first.agent.prompt({ sessionId: other.sessionId, ...textParam('other') }, elsewhere);
      expect(next.calls.map(c => c.params.update.title)).toEqual(['T2']);
      expect(elsewhere.calls.map(c => c.params.update.title)).toEqual(['T3']);
   });

   it('a rule-resolved call never touches the user', async () => {
      const { cx } = await playScript([
         call({ id: 'c1', kind: 'read', title: 'Read' }), gate({ ...readReport, id: 'c1' }),
         call({ id: 'c2', kind: 'edit', title: 'Edit' }), gate({ ...editReport, id: 'c2' }),
      ], { rules: [{ kind: 'read', action: 'approve' }, { kind: 'edit', action: 'deny' }] });
      expect(namedTrace(cx, ['c1', 'c2']))
         .toEqual(['card:c1', 'update:c1', 'card:c2', 'update:c2']);
      expect(requestsOf(cx)).toHaveLength(0);
   });
});
