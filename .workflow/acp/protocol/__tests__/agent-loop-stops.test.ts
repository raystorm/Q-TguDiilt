import { describe, it, expect, vi } from 'vitest';
import { end, gate, say } from '../../drivers/__tests__/fake-governed-driver.js';
import { useTempDir } from '../../drivers/__tests__/catalog-fixtures.js';
import { ModelUnavailableError } from '../../drivers/acp-driver-core/errors.js';
import type { TurnEnd } from '../../drivers/governed-driver.js';
import { SessionCollapseError, TurnInProgressError } from '../errors.js';
import { ABNORMAL_END_EVENT, END_LINE } from '../turn-end.js';
import {
   type Cx, act, allow, createCx, createHeldDriver, deferred, editReport, eventsOf, flush, handoffTurn,
   holdRelease, loopRig, loopRoutes, makeAgent, nextLine, openChat, plannerToEnforcer, reject,
   requestsOf, scriptChain, sendPrompt, startTurn, suggests, textsIn, throws, wait, watch,
} from './agent.helpers.js';

const dirOf = useTempDir();

const makeRig = (routes = loopRoutes) => loopRig({ routes, dir: dirOf() });

const STOPPED = 'The changeover loop stopped.';

// reason, the stop reason the IDE gets
const ENDS: Array<[Exclude<TurnEnd, 'completed'>, string]> = [
   ['output_limit', 'max_tokens'], ['request_limit', 'max_turn_requests'], ['refused', 'refusal'],
];

/** What the client was sent as text, one entry per update, without the padding. */
const trimmed = (cx: Cx) => textsIn(cx).map(text => text.trim());

describe('the changeover loop: what the user sees', () => {
   it('[H] each command is shown before its turn runs', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      const cx  = createCx();
      alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      alpha.script(handoffTurn(rig, 'Enforcer'));
      beta.script([say('Reviewed.')]);
      const release = cx.holdNotify(1);

      const turn = sendPrompt(rig, await openChat(rig), 'as Planner go', cx);
      await vi.waitFor(() => expect(cx.calls).toHaveLength(2));

      expect(trimmed(cx).at(-1)).toBe('Changeover: sending `@handoff to=Enforcer`');
      expect(alpha.seen).toHaveLength(1);
      release();
      await turn;
      expect(alpha.seen).toHaveLength(2);
   });

   it('[H] the line is a paragraph of its own', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      const cx  = createCx();
      alpha.script([
         act(() => rig.writeStatus('Planner', 'Enforcer')), say(`Work done.\n\n${nextLine('Enforcer')}`),
      ]);
      alpha.script(handoffTurn(rig, 'Enforcer'));
      beta.script([say('Reviewed.')]);

      await sendPrompt(rig, await openChat(rig), 'as Planner go', cx);

      const lines = textsIn(cx).join('').split('\n').map(line => line.trim());
      expect(lines).toContain('Changeover: sending `@handoff to=Enforcer`');
      expect(lines).toContain('Handoff written.');
      expect(lines).toContain('Changeover: sending `@start`');
      expect(lines).toContain('Reviewed.');
   });

   it('several suggestions: one line after the turn, saying what to type', async () => {
      const rig = makeRig();
      const cx  = createCx();
      rig.scripted.alpha.script([say('Done.\n\n**Next**: `@handoff to=Planner` or `@handoff to=Enforcer`')]);

      await sendPrompt(rig, await openChat(rig), 'as Planner go', cx);

      const texts = trimmed(cx);
      expect(texts).toHaveLength(2);
      expect(texts[1]).toBe(
         'Several next steps are suggested above. Enter the one you want, '
            + 'for example `@handoff to=<Profile>`.',
      );
   });

   /** Runs one prompt whose turn says `reply`; the lines the user saw after that turn's text. */
   async function linesAfter(prompt: string, reply: string)
   {
      const rig = makeRig();
      const cx  = createCx();
      rig.scripted.alpha.script([say(reply)]);
      await sendPrompt(rig, await openChat(rig), prompt, cx);
      return trimmed(cx).slice(1);
   }

   it('[H] no target, an unknown profile and a handoff not written each get one distinct line', async () => {
      const noTarget = await linesAfter('as Planner go', 'Done.\n\n**Next**: Run `@handoff`');
      const sendOnly = await linesAfter('as Planner go', 'Done.\n\n**Next**: Run `@send Doctor`');
      const unknown  = await linesAfter('as Planner go', 'Done.\n\n**Next**: Run `@handoff to=Nobody`');
      const notSaved = await linesAfter('@handoff to=Planner', 'Done.');

      for (const lines of [noTarget, sendOnly, unknown, notSaved]) { expect(lines).toHaveLength(1); }
      expect(noTarget).toEqual(sendOnly);
      expect(new Set([noTarget[0], unknown[0], notSaved[0]]).size).toBe(3);
      expect(unknown[0]).toContain('"Nobody"');
   });

   it('[H] an unknown profile is shown as written, capped at 64 characters', async () => {
      const long  = 'x'.repeat(200);
      const lines = await linesAfter('as Planner go', `Done.\n\n**Next**: Run \`@handoff to=${long}\``);

      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(`"${'x'.repeat(64)}"`);
      expect(lines[0]).not.toContain('x'.repeat(65));
   });

   it('a normal finish and a cancel show no line', async () => {
      expect(await linesAfter('as Planner go', 'Done.')).toEqual([]);

      const rig = makeRig();
      const cx  = createCx();
      rig.scripted.alpha.script([say('Working.'), wait('w')]);
      const sessionId = await openChat(rig);
      const turn = sendPrompt(rig, sessionId, 'as Planner go', cx);
      await rig.scripted.alpha.reached('w');
      await rig.agent.cancel({ sessionId });
      await turn;
      expect(trimmed(cx)).toEqual(['Working.']);
   });

   it.each(ENDS)('[H] a hop that ends with %s shows the end line, then the loop line', async (
      reason, stopReason,
   ) => {
      const rig = makeRig();
      const cx  = createCx();
      rig.scripted.alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      rig.scripted.alpha.script([...handoffTurn(rig, 'Enforcer'), end(reason)]);

      const response = await sendPrompt(rig, await openChat(rig), 'as Planner go', cx);

      expect(response).toEqual({ stopReason });
      expect(trimmed(cx).slice(-2)).toEqual([END_LINE[reason], STOPPED]);
      expect(rig.commands).toHaveLength(2);
   });

   it('[H] a hop that fails shows its output, then the loop line, then the error', async () => {
      const rig   = makeRig();
      const cx    = createCx();
      const error = new Error('boom');
      rig.scripted.alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      rig.scripted.alpha.script([say('Writing.'), throws(error)]);

      await expect(sendPrompt(rig, await openChat(rig), 'as Planner go', cx)).rejects.toBe(error);

      expect(trimmed(cx).slice(-3)).toEqual([
         'Changeover: sending `@handoff to=Enforcer`', 'Writing.', STOPPED,
      ]);
   });

   it('[H] an ordinary prompt that ends abnormally shows no loop line', async () => {
      const rig = makeRig();
      const cx  = createCx();
      rig.scripted.alpha.script([say('Cut.'), end('output_limit')]);

      await sendPrompt(rig, await openChat(rig), 'as Planner go', cx);

      expect(trimmed(cx)).toEqual(['Cut.', END_LINE.output_limit]);
   });

   it('[H] an ordinary prompt that fails shows no loop line', async () => {
      const rig   = makeRig();
      const cx    = createCx();
      const error = new Error('boom');
      rig.scripted.alpha.script([say('Partial.'), throws(error)]);

      await expect(sendPrompt(rig, await openChat(rig), 'as Planner go', cx)).rejects.toBe(error);

      expect(trimmed(cx)).toEqual(['Partial.']);
   });

   it('one prompt is one stream, in order: line, turn, line, turn', async () => {
      const rig = makeRig({ Planner: 'alpha', PromptEngineer: 'alpha', Architect: 'alpha' });
      const cx  = createCx();
      scriptChain(rig, 'alpha', ['Planner', 'PromptEngineer', 'Architect']);
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, 'as Planner go', cx);

      expect(cx.calls.every(call => sessionId === call.params.sessionId)).toBe(true);
      expect(trimmed(cx)).toEqual([
         'Planner works.\n\n**Next**: Run `@handoff to=PromptEngineer`',
         'Changeover: sending `@handoff to=PromptEngineer`',
         'Handoff written.',
         'Changeover: sending `@start`',
         'PromptEngineer works.\n\n**Next**: Run `@handoff to=Architect`',
         'Changeover: sending `@handoff to=Architect`',
         'Handoff written.',
         'Changeover: sending `@start`',
         'Architect is done.',
      ]);
   });
});

describe('the changeover loop: cancel, asks and disconnect', () => {
   it('[H] a cancel during a hop ends the loop and sends nothing more', async () => {
      const rig = makeRig();
      const cx  = createCx();
      rig.scripted.alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      rig.scripted.alpha.script([wait('w')]);
      const sessionId = await openChat(rig);
      const turn = sendPrompt(rig, sessionId, 'as Planner go', cx);
      await rig.scripted.alpha.reached('w');

      await rig.agent.cancel({ sessionId });

      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(rig.commands).toEqual(['as Planner go', '@handoff to=Enforcer']);
      expect(trimmed(cx)).not.toContain(STOPPED);
      expect(rig.sessionStore.hasActiveTurn(sessionId)).toBe(false);
      rig.scripted.alpha.script([say('Back.')]);
      await expect(sendPrompt(rig, sessionId, 'again')).resolves.toEqual({ stopReason: 'end_turn' });
   });

   it('[H] a cancel in the gap between turns sends nothing', async () => {
      const rig = makeRig();
      plannerToEnforcer(rig, 'beta');
      const { reached, hold } = holdRelease(rig);
      const sessionId = await openChat(rig);
      const turn = sendPrompt(rig, sessionId, 'as Planner go');
      await reached;

      await rig.agent.cancel({ sessionId });
      hold.resolve();

      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(rig.scripted.beta.seen).toHaveLength(0);
   });

   it('[H] a cancel wins over a driver that ignores the signal', async () => {
      const held = createHeldDriver();
      const { agent } = makeAgent({ driver: held.driver });
      const { sessionId, turn } = await startTurn(agent);
      await held.started(0);

      await agent.cancel({ sessionId });
      held.release(0, { text: `Done.\n\n${nextLine('Planner')}`, sessionId: 'drv', toolCalls: [] });

      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(held.driver.seen).toHaveLength(1);
   });

   it('a cancel with an ask open ends the loop; the ask is answered cancelled', async () => {
      const rig    = makeRig();
      const answer = deferred<unknown>();
      const cx     = createCx({ respond: () => answer.promise });
      rig.scripted.alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      rig.scripted.alpha.script([gate(editReport)]);
      const sessionId = await openChat(rig);
      const turn = sendPrompt(rig, sessionId, 'as Planner go', cx);
      await vi.waitFor(() => expect(requestsOf(cx)).toHaveLength(1));

      await rig.agent.cancel({ sessionId });
      answer.resolve({ outcome: { outcome: 'cancelled' } });

      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(rig.commands).toEqual(['as Planner go', '@handoff to=Enforcer']);
   });

   it('a cancel while idle, or after the loop ended, does nothing', async () => {
      const rig = makeRig();
      rig.scripted.alpha.script([say('Done.')]);
      const sessionId = await openChat(rig);

      await rig.agent.cancel({ sessionId });
      await sendPrompt(rig, sessionId, 'as Planner go');
      await rig.agent.cancel({ sessionId });

      expect(eventsOf(rig.logger, 'cancel_requested')).toEqual([]);
   });

   it('[H] the loop waits for the user\'s answer and never answers for them', async () => {
      const rig    = makeRig();
      const answer = deferred<unknown>();
      const cx     = createCx({ respond: () => answer.promise });
      rig.scripted.alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      rig.scripted.alpha.script([gate(editReport), ...handoffTurn(rig, 'Enforcer')]);
      rig.scripted.beta.script([say('Reviewed.')]);
      const turn  = sendPrompt(rig, await openChat(rig), 'as Planner go', cx);
      const state = watch(turn);
      await vi.waitFor(() => expect(requestsOf(cx)).toHaveLength(1));
      await flush();

      expect(rig.commands).toEqual(['as Planner go', '@handoff to=Enforcer']);
      expect(state.done).toBe(false);
      answer.resolve({ outcome: allow });
      await turn;

      expect(rig.commands.at(-1)).toBe('@start');
      expect(requestsOf(cx)).toHaveLength(1);
   });

   it('a denial is not a stop', async () => {
      const rig = makeRig();
      const cx  = createCx({ permission: reject });
      rig.scripted.alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      rig.scripted.alpha.script(handoffTurn(rig, 'Enforcer'));
      rig.scripted.beta.script([
         act(() => rig.writeStatus('Enforcer', 'Architect')), gate(editReport),
         say(`Reviewed.\n\n${nextLine('Architect')}`),
      ]);
      rig.scripted.beta.script(handoffTurn(rig, 'Architect'));
      rig.scripted.alpha.script([say('Built.')]);

      await sendPrompt(rig, await openChat(rig), 'as Planner go', cx);

      expect(rig.commands.slice(-2)).toEqual(['@handoff to=Architect', '@start']);
   });

   it('asks in two hops stay separate', async () => {
      const rig = makeRig();
      const cx  = createCx();
      const report = { ...editReport, id: 'c1' };
      rig.scripted.alpha.script([gate(report), ...suggests(rig, 'Planner', 'Enforcer')]);
      rig.scripted.alpha.script([gate(report), ...handoffTurn(rig, 'Enforcer')]);
      rig.scripted.beta.script([say('Reviewed.')]);

      await sendPrompt(rig, await openChat(rig), 'as Planner go', cx);

      const ids = requestsOf(cx).map(request => request.params.toolCall.toolCallId);
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
   });

   it('[H] a second prompt is rejected while a turn runs, and the loop is unaffected', async () => {
      const rig = makeRig();
      rig.scripted.alpha.script([wait('w'), ...suggests(rig, 'Planner', 'Enforcer')]);
      rig.scripted.alpha.script(handoffTurn(rig, 'Enforcer'));
      rig.scripted.beta.script([say('Reviewed.')]);
      const sessionId = await openChat(rig);
      const turn = sendPrompt(rig, sessionId, 'as Planner go');
      await rig.scripted.alpha.reached('w');

      await expect(sendPrompt(rig, sessionId, 'too soon')).rejects.toBeInstanceOf(TurnInProgressError);
      rig.scripted.alpha.release('w');
      await turn;

      expect(rig.commands).toEqual(['as Planner go', '@handoff to=Enforcer', '@start']);
   });

   it('a disconnect during a hop aborts it, sends nothing more and closes every driver', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      const closed = [vi.spyOn(alpha.driver, 'close'), vi.spyOn(beta.driver, 'close')];
      alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      alpha.script([wait('w')]);
      const turn = sendPrompt(rig, await openChat(rig), 'as Planner go');
      await alpha.reached('w');

      await rig.agent.onDisconnect();

      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(rig.commands).toEqual(['as Planner go', '@handoff to=Enforcer']);
      for (const spy of closed) { expect(spy).toHaveBeenCalledTimes(1); }
   });

   it('chats are independent: cancelling one leaves the other, and each releases its own ids', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      alpha.script([wait('a'), say('A is done.')], { sessionId: 'a-1' });
      const chatA = await openChat(rig);
      const turnA = sendPrompt(rig, chatA, 'as Planner go');
      await alpha.reached('a');
      alpha.script(suggests(rig, 'Planner', 'Enforcer'), { sessionId: 'b-1' });
      alpha.script([wait('b'), ...handoffTurn(rig, 'Enforcer')], { sessionId: 'b-1' });
      beta.script([say('Reviewed.')]);
      const turnB = sendPrompt(rig, await openChat(rig), 'as Planner go');
      await alpha.reached('b');

      await rig.agent.cancel({ sessionId: chatA });
      alpha.release('b');

      await expect(turnA).resolves.toEqual({ stopReason: 'cancelled' });
      await expect(turnB).resolves.toEqual({ stopReason: 'end_turn' });
      expect(alpha.released).toEqual(['b-1']);
   });
});

describe('the changeover loop: failures and abnormal ends', () => {
   it.each(ENDS)('[H] a turn that ends with %s stops the loop even with a valid next step', async (
      reason, stopReason,
   ) => {
      const rig = makeRig();
      rig.scripted.alpha.script([say(nextLine('Enforcer')), end(reason)]);

      const response = await sendPrompt(rig, await openChat(rig), 'as Planner go');

      expect(response).toEqual({ stopReason });
      expect(rig.commands).toEqual(['as Planner go']);
      expect(eventsOf(rig.logger, ABNORMAL_END_EVENT)).toHaveLength(1);
   });

   it('a turn that throws ends the prompt with its error, once, and the chat stays usable', async () => {
      const rig   = makeRig();
      const error = new Error('boom');
      rig.scripted.alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      rig.scripted.alpha.script(handoffTurn(rig, 'Enforcer'));
      rig.scripted.beta.script([throws(error)]);
      rig.scripted.beta.script([say('Back.')]);
      const sessionId = await openChat(rig);

      await expect(sendPrompt(rig, sessionId, 'as Planner go')).rejects.toBe(error);

      expect(rig.scripted.beta.seen).toHaveLength(1);
      expect(rig.sessionStore.hasActiveTurn(sessionId)).toBe(false);
      await expect(sendPrompt(rig, sessionId, 'again')).resolves.toEqual({ stopReason: 'end_turn' });
   });

   // error, the kind the log carries
   const FAILURES: Array<[Error, string]> = [
      [new ModelUnavailableError('m2'), 'internal'],
      [new SessionCollapseError('gone SECRET-ERR'), 'session_collapse'],
   ];

   it.each(FAILURES)('[H] the error %s reaches the IDE as it is, and its kind is logged', async (error, kind) => {
      const rig = makeRig();
      rig.scripted.alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      rig.scripted.alpha.script(handoffTurn(rig, 'Enforcer'));
      rig.scripted.beta.script([throws(error)]);

      await expect(sendPrompt(rig, await openChat(rig), 'as Planner go')).rejects.toBe(error);

      expect(eventsOf(rig.logger, 'prompt_failed').map(entry => entry.data.kind)).toEqual([kind]);
      expect(JSON.stringify(rig.logger.entries)).not.toContain('SECRET-ERR');
   });

   it('a driver that reports cancelled on its own stops the loop quietly', async () => {
      const rig = makeRig();
      const cx  = createCx();
      rig.scripted.alpha.script([say(nextLine('Enforcer'))], { cancelled: true });

      const response = await sendPrompt(rig, await openChat(rig), 'as Planner go', cx);

      expect(response).toEqual({ stopReason: 'cancelled' });
      expect(rig.commands).toEqual(['as Planner go']);
      expect(trimmed(cx)).not.toContain(STOPPED);
   });

   // the Nth update to the client, and every one after it, fails; commands sent before the stop
   it.each([[1, 1], [2, 2], [3, 2]])('[H] a failed delivery from update %i stops the loop', async (from, sent) => {
      const rig = makeRig();
      const cx  = createCx();
      plannerToEnforcer(rig, 'beta');
      cx.failNotify(from);

      const response = await sendPrompt(rig, await openChat(rig), 'as Planner go', cx);

      expect(response).toEqual({ stopReason: 'end_turn' });
      expect(rig.commands).toHaveLength(sent);
   });
});
