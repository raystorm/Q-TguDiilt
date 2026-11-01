import { describe, it, expect, vi } from 'vitest';
import { call, gate, say } from '../../drivers/__tests__/fake-governed-driver.js';
import { TurnInProgressError } from '../errors.js';
import { UPDATE_FAILED_EVENT } from '../update-sink.js';
import {
   type LogEntry, SESSION, agentSays, allow, begin, createCx, createDriverSpy,
   createScriptedDriver, deferred, editReport, eventsOf, flush, makeAgent, newSessionArgs,
   oneDriverCatalog, overRealCore, plain, readReport, requestsOf, startTurn, textParam,
   namedTrace, textsIn, throws, traceOf, wait, watch,
} from './agent.helpers.js';

const NOTICE = 'NOTICE-MARKER the preferred driver cannot be used';

describe('streaming: text as it arrives', () => {
   it('[H] text reaches the IDE while the turn is still running', async () => {
      const scripted = createScriptedDriver();
      scripted.script([say('a'), wait('w'), say('b')]);
      const { cx, turn } = await begin(scripted.driver);
      await scripted.reached('w');
      await flush();
      expect(traceOf(cx)).toEqual(['text:a']);
      const state = watch(turn);
      await flush();
      expect(state.done).toBe(false);
      scripted.release('w');
      await expect(turn).resolves.toEqual({ stopReason: 'end_turn' });
      expect(traceOf(cx)).toEqual(['text:a', 'text:b']);
   });

   it('[H] streamed text is never sent again at the end', async () => {
      const scripted = createScriptedDriver();
      scripted.script([say('a'), say('b')], { text: 'ab' });
      const { cx, turn } = await begin(scripted.driver);
      await turn;
      expect(traceOf(cx)).toEqual(['text:a', 'text:b']);
   });

   it('a plain driver sends its text once, at the end', async () => {
      const { cx, turn } = await begin(plain('reply'));
      await turn;
      expect(traceOf(cx)).toEqual(['text:reply']);
   });

   it('a plain driver with no text sends no text chunk', async () => {
      const { cx, turn } = await begin(plain(''));
      await expect(turn).resolves.toEqual({ stopReason: 'end_turn' });
      expect(traceOf(cx)).toEqual([]);
   });

   it('[H] only text updates count as streamed text', async () => {
      const scripted = createScriptedDriver();
      scripted.script([call({ id: 'c1', title: 'Read a.ts' })], { text: 'final' });
      const { cx, turn } = await begin(scripted.driver);
      await turn;
      expect(textsIn(cx)).toEqual(['final']);
   });

   it('streamed text is not replaced by the result text', async () => {
      const scripted = createScriptedDriver();
      scripted.script([say('a')], { text: 'different' });
      const { cx, turn } = await begin(scripted.driver);
      await turn;
      expect(textsIn(cx)).toEqual(['a']);
   });

   it('[H] a cancel keeps the shown text and does not repeat it', async () => {
      const scripted = createScriptedDriver();
      scripted.script([say('partial'), wait('w')]);
      const { agent, cx, sessionId, turn } = await begin(scripted.driver);
      await scripted.reached('w');
      await agent.cancel({ sessionId });
      scripted.release('w');
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(traceOf(cx)).toEqual(['text:partial']);
   });

   it('a cancel before the first update sends nothing', async () => {
      const scripted = createScriptedDriver();
      scripted.script([wait('w'), say('x')]);
      const { agent, cx, sessionId, turn } = await begin(scripted.driver);
      await scripted.reached('w');
      await agent.cancel({ sessionId });
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(traceOf(cx)).toEqual([]);
   });

   it('[H] a driver that throws after streaming keeps what was shown', async () => {
      const scripted = createScriptedDriver();
      scripted.script([say('a'), throws(new Error('boom'))]);
      const { cx, turn, logger } = await begin(scripted.driver);
      await expect(turn).rejects.toThrow('boom');
      expect(traceOf(cx)).toEqual(['text:a']);
      expect(eventsOf(logger, 'prompt_failed')).toHaveLength(1);
   });

   it('[H] two sessions streaming at once do not mix', async () => {
      const scripted = createScriptedDriver();
      scripted.script([say('A1'), wait('wa'), say('A2')]);
      scripted.script([say('B1'), wait('wb'), say('B2')]);
      const { agent } = makeAgent({ driver: scripted.driver });
      const [cxA, cxB] = [createCx(), createCx()];
      const a = await startTurn(agent, cxA);
      await scripted.reached('wa');
      const b = await startTurn(agent, cxB);
      await scripted.reached('wb');
      scripted.release('wb');
      await b.turn;
      scripted.release('wa');
      await a.turn;
      expect(textsIn(cxA)).toEqual(['A1', 'A2']);
      expect(textsIn(cxB)).toEqual(['B1', 'B2']);
      expect(cxA.calls.every(c => a.sessionId === c.params.sessionId)).toBe(true);
      expect(cxB.calls.every(c => b.sessionId === c.params.sessionId)).toBe(true);
   });

   it('a reopened chat streams the same way', async () => {
      const scripted = createScriptedDriver();
      scripted.script([say('a'), say('b')]);
      const { agent } = makeAgent({ driver: scripted.driver });
      await agent.loadSession({ sessionId: 'sess-prev', workflowId: 'wf-prev' });
      const cx = createCx();
      await agent.prompt({ sessionId: 'sess-prev', ...textParam('go') }, cx);
      expect(traceOf(cx)).toEqual(['text:a', 'text:b']);
   });
});

describe('streaming: order, flush and failure', () => {
   it('[H] the ask comes after earlier agent updates; later text follows it', async () => {
      const scripted = createScriptedDriver();
      scripted.script([wait('w')]);
      const answer = deferred<unknown>();
      const cx     = createCx({ respond: () => answer.promise });
      const releaseFirst = cx.holdNotify(0);
      const { turn } = await begin(scripted.driver, { cx });
      await scripted.reached('w');
      const { onUpdate, onToolCall } = scripted.seen[0].options;
      onUpdate?.({ type: 'text', text: 'a' });
      onUpdate?.({ type: 'tool_call', id: 'c1', kind: 'edit', title: 'Edit a.ts' });
      const decision = onToolCall?.({ ...editReport, id: 'c1' });
      onUpdate?.({ type: 'text', text: 'b' });
      await flush();
      expect(traceOf(cx)).toEqual(['text:a']);
      releaseFirst();
      await vi.waitFor(() =>
         expect(namedTrace(cx, ['c1']))
            .toEqual(['text:a', 'card:c1', 'detail:c1', 'request:c1', 'text:b']));
      answer.resolve({ outcome: allow });
      await expect(decision).resolves.toBe('approve');
      scripted.release('w');
      await turn;
   });

   it.each([
      ['streamed text', () => {
         const scripted = createScriptedDriver();
         scripted.script([say('a')]);
         return scripted.driver;
      }],
      ['the fallback text', () => plain('a')],
      ['a driver that throws', () => {
         const scripted = createScriptedDriver();
         scripted.script([say('a'), throws(new Error('boom'))]);
         return scripted.driver;
      }],
   ])('[H] the prompt settles only after every queued update was delivered: %s',
      async (_name, make) => {
         const cx      = createCx();
         const release = cx.holdNotify(0);
         const { turn } = await begin(make(), { cx });
         const state = watch(turn);
         await flush();
         expect(state.done).toBe(false);
         release();
         await turn.catch(() => undefined);
         expect(state.done).toBe(true);
         expect(traceOf(cx)).toEqual(['text:a']);
      },
   );

   it.each(['rejects', 'throws'] as const)(
      '[H] a notify that %s on the third update is logged once, kind only, rest dropped',
      async how => {
         const scripted = createScriptedDriver();
         scripted.script(Array.from({ length: 10 }, (_, i) => say(`u${i + 1}`)));
         const cx = createCx();
         cx.failNotify(2, how);
         const { turn, logger } = await begin(scripted.driver, { cx });
         await expect(turn).resolves.toEqual({ stopReason: 'end_turn' });
         expect(textsIn(cx)).toEqual(['u1', 'u2', 'u3']);
         const failures = eventsOf(logger, UPDATE_FAILED_EVENT);
         expect(failures).toHaveLength(1);
         expect(failures[0].level).toBe('warn');
         expect(failures[0].data).toHaveProperty('failureKind');
         expect(JSON.stringify(logger.entries)).not.toContain('SECRET-ERR');
      },
   );

   it('[H] the failure is logged once per turn, not once per update', async () => {
      const scripted = createScriptedDriver();
      scripted.script(Array.from({ length: 20 }, (_, i) => say(`u${i}`)));
      scripted.script([say('next')]);
      const { agent, logger } = makeAgent({ driver: scripted.driver });
      const { sessionId } = await agent.newSession(newSessionArgs());
      for (const expected of [1, 2]) {
         const cx = createCx();
         cx.failNotify(0);
         await agent.prompt({ sessionId, ...textParam('go') }, cx);
         expect(eventsOf(logger, UPDATE_FAILED_EVENT)).toHaveLength(expected);
      }
   });

   it('[H] after a failed send an ask is denied and no request is sent', async () => {
      const scripted = createScriptedDriver();
      scripted.script([say('a'), gate(editReport)]);
      const cx = createCx();
      cx.failNotify(0);
      const { turn, logger } = await begin(scripted.driver, { cx });
      await expect(turn).resolves.toEqual({ stopReason: 'end_turn' });
      expect(requestsOf(cx)).toHaveLength(0);
      expect(scripted.decisions).toEqual(['deny']);
      const outcomes = eventsOf(logger, 'governance_outcome');
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].data.reason).toBe('ask_failed');
   });

   it('[H] after a failed send governance still decides rule-resolved calls', async () => {
      const scripted = createScriptedDriver();
      scripted.script([say('a'), gate(readReport), gate(editReport)]);
      const cx = createCx();
      cx.failNotify(0);
      const rules = [{ kind: 'read', action: 'approve' }, { kind: 'edit', action: 'deny' }];
      const { turn } = await begin(scripted.driver, { cx, rules });
      await turn;
      expect(scripted.decisions).toEqual(['approve', 'deny']);
      expect(requestsOf(cx)).toHaveLength(0);
   });

   it('the fallback text failing to send is logged once, not thrown', async () => {
      const cx = createCx();
      cx.failNotify(0);
      const { turn, logger } = await begin(plain('reply'), { cx });
      await expect(turn).resolves.toEqual({ stopReason: 'end_turn' });
      expect(eventsOf(logger, UPDATE_FAILED_EVENT)).toHaveLength(1);
   });

   it('[H] nothing is sent after the turn settles', async () => {
      const scripted = createScriptedDriver();
      scripted.script([say('a')]);
      scripted.script([wait('w')]);
      const { agent, logger } = makeAgent({ driver: scripted.driver });
      const { sessionId } = await agent.newSession(newSessionArgs());
      const first = createCx();
      await agent.prompt({ sessionId, ...textParam('one') }, first);
      const sent = first.calls.length;
      scripted.lateUpdate({ type: 'text', text: 'late' });
      const second = createCx();
      const next   = agent.prompt({ sessionId, ...textParam('two') }, second);
      await scripted.reached('w');
      scripted.lateUpdate({ type: 'text', text: 'late again' }, 0);
      scripted.release('w');
      await next;
      expect(first.calls).toHaveLength(sent);
      expect(textsIn(second)).toEqual([]);
      const problems = logger.entries
         .filter((e: LogEntry) => 'warn' === e.level || 'error' === e.level);
      expect(problems).toEqual([]);
   });

   it('[H] a prompt rejected for a turn in progress leaves the running turn alone', async () => {
      const scripted = createScriptedDriver();
      scripted.script([say('a'), wait('w'), say('b')]);
      const { agent, cx, sessionId, turn } = await begin(scripted.driver);
      await scripted.reached('w');
      const busy = createCx();
      await expect(agent.prompt({ sessionId, ...textParam('more') }, busy))
         .rejects.toBeInstanceOf(TurnInProgressError);
      scripted.release('w');
      await turn;
      expect(busy.calls).toEqual([]);
      expect(traceOf(cx)).toEqual(['text:a', 'text:b']);
   });

   it('text is not held back by an open approval request', async () => {
      const scripted = createScriptedDriver();
      scripted.script([wait('w')]);
      const answer = deferred<unknown>();
      const cx     = createCx({ respond: () => answer.promise });
      const { turn } = await begin(scripted.driver, { cx });
      await scripted.reached('w');
      const { onUpdate, onToolCall } = scripted.seen[0].options;
      const decision = onToolCall?.(editReport);
      await vi.waitFor(() => expect(requestsOf(cx)).toHaveLength(1));
      onUpdate?.({ type: 'text', text: 'later' });
      await vi.waitFor(() => expect(textsIn(cx)).toEqual(['later']));
      answer.resolve({ outcome: allow });
      await decision;
      scripted.release('w');
      await turn;
   });

   it('[H] a failing sink in one session does not touch another', async () => {
      const scripted = createScriptedDriver();
      scripted.script([say('a1'), say('a2')]);
      scripted.script([say('b1'), say('b2')]);
      const { agent, logger } = makeAgent({ driver: scripted.driver });
      const [cxA, cxB] = [createCx(), createCx()];
      cxA.failNotify(0);
      const a = await startTurn(agent, cxA);
      const b = await startTurn(agent, cxB);
      await Promise.all([a.turn, b.turn]);
      expect(textsIn(cxB)).toEqual(['b1', 'b2']);
      const failures = eventsOf(logger, UPDATE_FAILED_EVENT);
      expect(failures).toHaveLength(1);
      expect(failures[0].data.sessionId).toBe(a.sessionId);
   });
});

describe('streaming: the placeholder, the notice and the text', () => {
   it('[H] no reply starts with, or contains, the placeholder', async () => {
      const streaming = createScriptedDriver();
      streaming.script([say('a'), say('b')]);
      const drivers = [
         streaming.driver,
         plain('reply'),
         plain('partial', { cancelled: true }),
         plain('cut', { end: 'refused' }),
         createDriverSpy(() => { throw new Error('boom'); }),
      ];
      for (const driver of drivers) {
         const { agent } = makeAgent({ driver });
         const { sessionId } = await agent.newSession(newSessionArgs());
         const cx = createCx();
         await agent.prompt({ sessionId, ...textParam('go') }, cx).catch(() => undefined);
         expect(JSON.stringify(cx.calls)).not.toContain('Working on it');
      }
   });

   it('the notice leads, and the agent\'s text follows in order', async () => {
      const scripted = createScriptedDriver();
      scripted.script([say('a'), call({ id: 'c1', title: 'Read a.ts' }), say('b')]);
      const { cx, turn } = await begin(scripted.driver, {
         catalog: oneDriverCatalog(scripted.driver, NOTICE),
      });
      await turn;
      expect(textsIn(cx)).toEqual([NOTICE, 'a', 'b']);
   });

   it('[H] a streaming turn writes no log entry per update', async () => {
      const streaming = createScriptedDriver();
      streaming.script([
         ...Array.from({ length: 100 }, (_, i) => say(`t${i}`)),
         ...Array.from({ length: 20 }, (_, i) => call({ id: `c${i}`, title: `Read ${i}` })),
      ]);
      const eventsFor = async (driver: any) => {
         const { turn, logger } = await begin(driver);
         await turn;
         return logger.entries.map((e: LogEntry) => e.event);
      };
      expect(await eventsFor(streaming.driver)).toEqual(await eventsFor(plain('reply')));
   });
});

const option = (id: string, currentValue: string) =>
   ({ id, name: id, type: 'select', currentValue, options: [] });
const SETTINGS = [{ name: 'blanket_approval', optionId: 'approval', values: ['on'] }];
const switchedOn = {
   sessionId: SESSION,
   update:    { sessionUpdate: 'config_option_update', configOptions: [option('approval', 'on')] },
};
// A mid-turn warning is its own paragraph, so its text can start with a blank line.
const WARNING = /Warning: .*blanket_approval/;

/** The service over the real core, whose agent starts with the unsafe setting off. */
function coreWithSetting(notice?: string) {
   const made = overRealCore({ settings: SETTINGS, notice });
   made.downstream.respond('session/new',
      () => ({ sessionId: SESSION, configOptions: [option('approval', 'off')] }));
   return made;
}

describe('streaming: the unsafe-setting warning through the real core', () => {
   it('[H] a change between turns leads the next reply, once, with no notice', async () => {
      const { agent, downstream, done } = coreWithSetting(NOTICE);
      const { sessionId } = await agent.newSession(newSessionArgs());
      const turnSays = (text: string) => downstream.respond('session/prompt', async () => {
         await downstream.notify('session/update', agentSays(text));
         return { stopReason: 'end_turn' };
      });
      turnSays('one');
      await agent.prompt({ sessionId, ...textParam('go') }, createCx());
      await downstream.notify('session/update', switchedOn);
      await flush();
      turnSays('two');
      const second = createCx();
      await agent.prompt({ sessionId, ...textParam('again') }, second);
      const texts = textsIn(second);
      expect(texts[0]).toMatch(WARNING);
      expect(texts.slice(1)).toEqual(['two']);
      await done();
   });

   it('[H] a change during the turn shows where it happened', async () => {
      const { agent, downstream, done } = coreWithSetting();
      downstream.respond('session/prompt', async () => {
         await downstream.notify('session/update', agentSays('a'));
         await downstream.notify('session/update', switchedOn);
         await downstream.notify('session/update', agentSays('b'));
         return { stopReason: 'end_turn' };
      });
      const { sessionId } = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId, ...textParam('go') }, cx);
      const texts = textsIn(cx);
      expect(texts).toHaveLength(3);
      expect([texts[0], texts[2]]).toEqual(['a', 'b']);
      expect(texts[1]).toMatch(WARNING);
      await done();
   });

   it('a cancelled turn shows the warning once, before the partial text, which is not repeated',
      async () => {
         const { agent, downstream, done } = coreWithSetting();
         downstream.respond('session/prompt', async () => {
            await downstream.notify('session/update', switchedOn);
            await downstream.notify('session/update', agentSays('partial'));
            await downstream.arrived('session/cancel');
            return { stopReason: 'cancelled' };
         });
         const cx = createCx();
         const { sessionId, turn } = await startTurn(agent, cx);
         await vi.waitFor(() => expect(textsIn(cx)).toHaveLength(2));
         await agent.cancel({ sessionId });
         await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
         const texts = textsIn(cx);
         expect(texts).toHaveLength(2);
         expect(texts[0]).toMatch(WARNING);
         expect(texts[1]).toBe('partial');
         await done();
      },
   );
});
