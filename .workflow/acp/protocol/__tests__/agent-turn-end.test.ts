import { describe, it, expect } from 'vitest';
import { end, say } from '../../drivers/__tests__/fake-governed-driver.js';
import { AgentStopReasonError } from '../../drivers/acp-driver-core/errors.js';
import { ABNORMAL_END_EVENT, END_LINE } from '../turn-end.js';
import {
   agentSays, begin, createCx, createDriverSpy, createScriptedDriver, eventsOf, flush,
   makeAgent, newSessionArgs, oneDriverCatalog, overRealCore, plain, textParam, textsIn,
   throws, wait, watch,
} from './agent.helpers.js';

const NOTICE = 'NOTICE-MARKER the preferred driver cannot be used';
const ENDS   = ['output_limit', 'request_limit', 'refused'] as const;

/** A scripted driver whose one turn says `text` and then ends with `reason`. */
function endingWith(reason: (typeof ENDS)[number] | 'completed' | undefined, text = 'text') {
   const scripted = createScriptedDriver();
   scripted.script([say(text), ...(undefined === reason ? [] : [end(reason)])]);
   return scripted.driver;
}

describe('how a turn ends', () => {
   it.each([
      [undefined,       'end_turn',          undefined],
      ['completed',     'end_turn',          undefined],
      ['output_limit',  'max_tokens',        END_LINE.output_limit],
      ['request_limit', 'max_turn_requests', END_LINE.request_limit],
      ['refused',       'refusal',           END_LINE.refused],
   ] as const)('[H] the end %s gives the stop reason %s', async (reason, stop, line) => {
      const { cx, turn } = await begin(endingWith(reason));
      await expect(turn).resolves.toEqual({ stopReason: stop });
      expect(textsIn(cx)).toEqual(undefined === line ? ['text'] : ['text', line]);
   });

   it('the three lines differ and each is sent once', async () => {
      const sent: string[] = [];
      for (const reason of ENDS) {
         const { cx, turn } = await begin(endingWith(reason));
         await turn;
         const lines = textsIn(cx).filter(text => Object.values(END_LINE).includes(text));
         expect(lines).toEqual([END_LINE[reason]]);
         sent.push(...lines);
      }
      expect(new Set(sent).size).toBe(3);
      expect(sent[0]).toContain('output limit');
   });

   it.each([
      ['a streaming turn',    () => endingWith('output_limit')],
      ['a plain-driver turn', () => plain('text', { end: 'output_limit' })],
   ])('[H] the line follows the text and the prompt waits for it: %s', async (_name, make) => {
      const cx          = createCx();
      const releaseLine = cx.holdNotify(1);
      const { turn }    = await begin(make(), { cx });
      const state = watch(turn);
      await flush();
      expect(state.done).toBe(false);
      expect(textsIn(cx)).toEqual(['text', END_LINE.output_limit]);
      releaseLine();
      await expect(turn).resolves.toEqual({ stopReason: 'max_tokens' });
   });

   it('an abnormal end keeps the session usable', async () => {
      const scripted = createScriptedDriver();
      scripted.script([say('x'), end('refused')]);
      scripted.script([say('y')]);
      const { agent } = makeAgent({ driver: scripted.driver });
      const { sessionId } = await agent.newSession(newSessionArgs());
      await expect(agent.prompt({ sessionId, ...textParam('one') }, createCx()))
         .resolves.toEqual({ stopReason: 'refusal' });
      await expect(agent.prompt({ sessionId, ...textParam('two') }, createCx()))
         .resolves.toEqual({ stopReason: 'end_turn' });
      expect(scripted.seen[1].options.sessionId).toBe('scripted-sess');
   });
});

describe('the abnormal-end log entry', () => {
   it.each(ENDS)('[H] the end %s is logged once, with its reason only', async reason => {
      const { turn, logger, sessionId } = await begin(endingWith(reason, 'SECRET-TEXT'));
      await turn;
      const entries = eventsOf(logger, ABNORMAL_END_EVENT);
      expect(entries).toEqual([
         { level: 'info', event: ABNORMAL_END_EVENT, data: { sessionId, end: reason } },
      ]);
      expect(JSON.stringify(logger.entries)).not.toContain('SECRET-TEXT');
   });

   it.each([
      ['a completed end',               () => plain('t', { end: 'completed' })],
      ['a cancel with no abnormal end', () => plain('t', { cancelled: true })],
      ['a driver error',                () => createDriverSpy(() => { throw new Error('boom'); })],
      ['the own-cancel error',          () => createDriverSpy(() => {
         throw new AgentStopReasonError('cancelled');
      })],
   ])('[H] %s writes no abnormal-end entry', async (_name, make) => {
      const { turn, logger } = await begin(make());
      await turn.catch(() => undefined);
      expect(eventsOf(logger, ABNORMAL_END_EVENT)).toEqual([]);
   });

   it('[H] a cancelled result that also ended abnormally logs both and sends no line', async () => {
      const { cx, turn, logger } = await begin(plain('x', { cancelled: true, end: 'refused' }));
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(textsIn(cx)).toEqual(['x']);
      expect(eventsOf(logger, 'turn_cancelled')).toHaveLength(1);
      expect(eventsOf(logger, ABNORMAL_END_EVENT)).toHaveLength(1);
   });

   it('[H] a cancel with an abnormal end from the driver logs both and sends no line', async () => {
      const scripted = createScriptedDriver();
      scripted.script([say('x'), wait('w')], { end: 'output_limit' });
      const { agent, cx, sessionId, turn, logger } = await begin(scripted.driver);
      await scripted.reached('w');
      await agent.cancel({ sessionId });
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(textsIn(cx)).toEqual(['x']);
      expect(eventsOf(logger, 'turn_cancelled')).toHaveLength(1);
      expect(eventsOf(logger, ABNORMAL_END_EVENT)).toHaveLength(1);
   });
});

describe('an agent that stops the turn on its own', () => {
   it('[H] the own-cancel error fails the prompt and leaves the notice pending', async () => {
      const scripted = createScriptedDriver();
      scripted.script([say('a'), throws(new AgentStopReasonError('cancelled'))]);
      const { agent, logger } = makeAgent({
         driver: scripted.driver, catalog: oneDriverCatalog(scripted.driver, NOTICE),
      });
      const { sessionId } = await agent.newSession(newSessionArgs());
      const first = createCx();
      await expect(agent.prompt({ sessionId, ...textParam('go') }, first))
         .rejects.toThrow(/cancelled/);
      expect(textsIn(first)).toEqual([NOTICE, 'a']);
      const failed = eventsOf(logger, 'prompt_failed');
      expect(failed).toHaveLength(1);
      expect(failed[0].data.kind).toBe('internal');
      const second = createCx();
      await agent.prompt({ sessionId, ...textParam('again') }, second);
      expect(textsIn(second)).toEqual([NOTICE]);
   });
});

describe('through the real core', () => {
   const sayThenStop = (downstream: any, stopReason: unknown) =>
      downstream.respond('session/prompt', async () => {
         await downstream.notify('session/update', agentSays('text'));
         return { stopReason };
      });

   it('[H] an agent that cancels by itself fails the prompt', async () => {
      const { agent, downstream, done } = overRealCore();
      sayThenStop(downstream, 'cancelled');
      const { sessionId } = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await expect(agent.prompt({ sessionId, ...textParam('go') }, cx))
         .rejects.toThrow(/cancelled/);
      expect(textsIn(cx)).toEqual(['text']);
      await done();
   });

   it.each([
      ['end_turn',          'end_turn',          undefined],
      ['max_tokens',        'max_tokens',        END_LINE.output_limit],
      ['max_turn_requests', 'max_turn_requests', END_LINE.request_limit],
      ['refusal',           'refusal',           END_LINE.refused],
   ] as const)('the agent\'s stop reason %s reaches the IDE as %s', async (reason, stop, line) => {
      const { agent, downstream, done } = overRealCore();
      sayThenStop(downstream, reason);
      const { sessionId } = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await expect(agent.prompt({ sessionId, ...textParam('go') }, cx))
         .resolves.toEqual({ stopReason: stop });
      expect(textsIn(cx)).toEqual(undefined === line ? ['text'] : ['text', line]);
      await done();
   });

   it('[H] an unknown stop reason fails the prompt, and the next prompt works', async () => {
      // The failed turn gives the service no agent session id, so the next turn starts a
      // new agent process.
      const { agent, downstream, downstreams, done } = overRealCore({ agents: 2 });
      sayThenStop(downstream, 'banana');
      const { sessionId } = await agent.newSession(newSessionArgs());
      await expect(agent.prompt({ sessionId, ...textParam('go') }, createCx()))
         .rejects.toThrow(/banana/);
      sayThenStop(downstreams[1], 'end_turn');
      await expect(agent.prompt({ sessionId, ...textParam('again') }, createCx()))
         .resolves.toEqual({ stopReason: 'end_turn' });
      await done();
   });
});
