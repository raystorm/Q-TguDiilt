import { describe, it, expect } from 'vitest';
import { end, say } from '../../drivers/__tests__/fake-governed-driver.js';
import { useTempDir } from '../../drivers/__tests__/catalog-fixtures.js';
import { returnPrompt } from '../agent/side-trip.js';
import {
   type Cx, type LoopRig, type ScriptStep, act, asks, closesTrip, createCx, doctorFile, eventsOf, expectOpen,
   loopRig, loopRoutes, openChat, scriptSideTrip, sendPrompt, textsIn, throws, wait,
} from './agent.helpers.js';

const dirOf = useTempDir();

const makeRig = () => loopRig({ routes: loopRoutes, dir: dirOf() });

/** The data of every log entry of one event, in order. */
const dataOf = (rig: LoopRig, event: string) => eventsOf(rig.logger, event).map(entry => entry.data);

/** What the client was sent as text, one entry per update, without the padding. */
const trimmed = (cx: Cx) => textsIn(cx).map(text => text.trim());

const STOPPED = 'Automatic changeover stopped.';
const CLOSE_TEXT = 'Close this tab and return to Enforcer.';

/** The commands up to the start of the side profile. */
const TO_RECEIVE = ['as Enforcer go', '@send to=Doctor', '@receive'];

// ---------------------------------------------------------------- the end of the trip

// label, outcome of the end check, how Doctor's file is left when the turn says it is done
const NOT_ENDED: Array<[string, string, (rig: LoopRig) => void]> = [
   ['a waiting file', 'not_ready', rig => { doctorFile(rig, { status: 'waiting', next: undefined }); }],
   ['a started file', 'not_ready', rig => { doctorFile(rig, { status: 'started', next: undefined }); }],
   ['a ready file for a send', 'not_ready', rig => {
      doctorFile(rig, { next: { command: 'send', to: 'PromptEngineer' } });
   }],
   ['a stale complete file', 'stale', rig => {
      doctorFile(rig, { status: 'complete', next: undefined }, -60_000);
   }],
   ['no file of Doctor', 'missing', () => {}],
   ['a complete file of another profile', 'invalid', rig => {
      doctorFile(rig, { status: 'complete', next: undefined, profile: 'Enforcer' });
   }],
   ['a complete file that handed off', 'mismatch', rig => {
      doctorFile(rig, { status: 'complete', next: { command: 'handoff', to: 'Planner' } });
   }],
];

describe('the end of a side trip', () => {
   it.each(NOT_ENDED)('[H] %s gives %s: the prose does not end the trip', async (_label, outcome, arrange) => {
      const rig = makeRig();
      const cx  = createCx();
      scriptSideTrip(rig, [[act(() => arrange(rig)), say(CLOSE_TEXT)]]);
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, 'as Enforcer go', cx);

      expect(rig.commands).toEqual(TO_RECEIVE);
      expect(dataOf(rig, 'status_check').at(-1)).toEqual({ sessionId, profile: 'Doctor', check: 'end', outcome });
      expect(dataOf(rig, 'loop_stopped')).toMatchObject([{ reason: 'status_not_confirmed' }]);
      expect(trimmed(cx).at(-1)).toBe(CLOSE_TEXT);
      expectOpen(rig, sessionId);
   });

   it('[H] the user answers the side profile, and the trip ends in that prompt', async () => {
      const rig = makeRig();
      const { beta } = rig.scripted;
      scriptSideTrip(rig, [asks(rig), closesTrip(rig, 'Doctor', 'Enforcer')]);
      const sessionId = await openChat(rig);
      await sendPrompt(rig, sessionId, 'as Enforcer go');
      expectOpen(rig, sessionId);

      await sendPrompt(rig, sessionId, 'the March report');

      expect(rig.commands).toEqual([...TO_RECEIVE, 'the March report', returnPrompt('Doctor')]);
      expect(beta.seen[3]).toMatchObject({ command: 'the March report', options: { sessionId: 'doc-1' } });
      expect(beta.seen[4].options.sessionId).toBe('enf-1');
      expect(beta.released).toEqual(['doc-1']);
      expect(rig.sessionStore.get(sessionId)?.parked).toBeUndefined();
      const reasons = dataOf(rig, 'loop_stopped').map(data => data.reason);
      expect(reasons).toEqual(['status_not_confirmed', 'no_suggestion']);
   });

   it('[H] the trip state survives between prompts, and a close drops both sessions', async () => {
      const rig = makeRig();
      scriptSideTrip(rig, [asks(rig)]);
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, 'as Enforcer go');

      expect(rig.sessionStore.get(sessionId)?.parked).toEqual({
         driver: 'beta', model: 'm2', driverSessionId: 'enf-1', profile: 'Enforcer',
      });
      rig.sessionStore.close(sessionId);
      expect(rig.sessionStore.get(sessionId)).toBeUndefined();
   });

   it('[H] a second trip after the first one returned starts clean', async () => {
      const rig = makeRig();
      const { beta } = rig.scripted;
      scriptSideTrip(rig, [closesTrip(rig, 'Doctor', 'Enforcer')]);
      scriptSideTrip(rig, [closesTrip(rig, 'Doctor', 'Enforcer')], undefined, 'doc-2');
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, 'as Enforcer go');
      expect(rig.sessionStore.get(sessionId)?.parked).toBeUndefined();
      await sendPrompt(rig, sessionId, 'go');

      const returns = rig.commands.filter(command => returnPrompt('Doctor') === command);
      expect(returns).toHaveLength(2);
      expect(beta.released).toEqual(['doc-1', 'doc-2']);
      expect(beta.seen[7].options.sessionId).toBe('enf-1');
      expect(rig.sessionStore.get(sessionId)?.parked).toBeUndefined();
   });
});

// ---------------------------------------------------------------- cancel

describe('cancelling a side trip', () => {
   it('[H] a cancel in the side turn sends nothing more, and the next prompt carries on in the trip', async () => {
      const rig = makeRig();
      const { beta } = rig.scripted;
      scriptSideTrip(rig, [[wait('w')], closesTrip(rig, 'Doctor', 'Enforcer')]);
      const sessionId = await openChat(rig);
      const turn = sendPrompt(rig, sessionId, 'as Enforcer go');
      await beta.reached('w');

      await rig.agent.cancel({ sessionId });

      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(rig.commands).toEqual(TO_RECEIVE);
      expect(rig.sessionStore.hasActiveTurn(sessionId)).toBe(false);
      expectOpen(rig, sessionId);

      await expect(sendPrompt(rig, sessionId, 'again')).resolves.toEqual({ stopReason: 'end_turn' });

      expect(rig.commands).toEqual([...TO_RECEIVE, 'again', returnPrompt('Doctor')]);
      expect(beta.seen[3].options.sessionId).toBe('doc-1');
      expect(beta.released).toEqual(['doc-1']);
   });

   it('[H] a cancel in the return turn leaves the trip closed, with no second return', async () => {
      const rig = makeRig();
      const { beta } = rig.scripted;
      scriptSideTrip(rig, [closesTrip(rig, 'Doctor', 'Enforcer')], [wait('r')]);
      beta.script([say('Fine.')], { sessionId: 'enf-1' });
      const sessionId = await openChat(rig);
      const turn = sendPrompt(rig, sessionId, 'as Enforcer go');
      await beta.reached('r');

      await rig.agent.cancel({ sessionId });

      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(rig.sessionStore.get(sessionId)?.parked).toBeUndefined();

      await sendPrompt(rig, sessionId, 'again');

      expect(rig.commands).toEqual([...TO_RECEIVE, returnPrompt('Doctor'), 'again']);
      expect(dataOf(rig, 'loop_stopped').at(-1)).toMatchObject({ reason: 'no_suggestion' });
   });
});

// ---------------------------------------------------------------- failures in the trip

describe('failures in a side trip', () => {
   it('[H] an abnormal end stops the trip, says so, and keeps it open', async () => {
      const rig = makeRig();
      const cx  = createCx();
      scriptSideTrip(rig, [[end('output_limit')]]);
      const sessionId = await openChat(rig);

      const response = await sendPrompt(rig, sessionId, 'as Enforcer go', cx);

      expect(response).toEqual({ stopReason: 'max_tokens' });
      expect(trimmed(cx)).toContain(STOPPED);
      expect(dataOf(rig, 'loop_stopped')).toMatchObject([{ reason: 'abnormal_end' }]);
      expectOpen(rig, sessionId);
   });

   it('[H] a throw reaches the caller, says so in the chat, and keeps the trip open', async () => {
      const rig = makeRig();
      const cx  = createCx();
      scriptSideTrip(rig, [[throws(new Error('SECRET-ERR'))]]);
      const sessionId = await openChat(rig);

      await expect(sendPrompt(rig, sessionId, 'as Enforcer go', cx)).rejects.toThrow('SECRET-ERR');

      expect(trimmed(cx)).toContain(STOPPED);
      expect(dataOf(rig, 'loop_stopped')).toMatchObject([{ reason: 'failed' }]);
      expectOpen(rig, sessionId, null);
   });

   it('[H] a failed delivery from the side turn stops the trip and keeps it open', async () => {
      const rig = makeRig();
      const cx  = createCx();
      scriptSideTrip(rig, [asks(rig)]);
      // The side profile's text is the sixth update: the sender's text, two command lines, the sender's
      // reply, the switch line, then this one.
      cx.failNotify(5);
      const sessionId = await openChat(rig);

      const response = await sendPrompt(rig, sessionId, 'as Enforcer go', cx);

      expect(response).toEqual({ stopReason: 'end_turn' });
      expect(rig.commands).toEqual(TO_RECEIVE);
      expect(dataOf(rig, 'loop_stopped')).toMatchObject([{ reason: 'failed' }]);
      expectOpen(rig, sessionId);
   });

   it('[H] a release that fails at the end does not block the return', async () => {
      const rig = makeRig();
      scriptSideTrip(rig, [closesTrip(rig, 'Doctor', 'Enforcer')]);
      rig.scripted.beta.onRelease = async () => { throw new Error('SECRET-ERR'); };
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, 'as Enforcer go');

      expect(eventsOf(rig.logger, 'release_failed')).toEqual([
         { level: 'warn', event: 'release_failed', data: { sessionId, failureKind: 'internal' } },
      ]);
      expect(rig.commands.at(-1)).toBe(returnPrompt('Doctor'));
      expect(rig.sessionStore.get(sessionId)?.parked).toBeUndefined();
   });

   // label, what the return turn does, how the prompt ends
   const RETURN_FAILS: Array<[string, ScriptStep[], string]> = [
      ['throws', [throws(new Error('SECRET-ERR'))], 'rejects'],
      ['ends at its output limit', [end('output_limit')], 'max_tokens'],
   ];

   it.each(RETURN_FAILS)('[H] a return turn that %s ends the prompt, after the side session was released', async (
      _label, back, ending,
   ) => {
      const rig = makeRig();
      const { beta } = rig.scripted;
      scriptSideTrip(rig, [closesTrip(rig, 'Doctor', 'Enforcer')], back);
      const releasedAt: number[] = [];
      beta.onRelease = async () => { releasedAt.push(rig.commands.length); };
      const sessionId = await openChat(rig);

      const ended = sendPrompt(rig, sessionId, 'as Enforcer go');

      if ('rejects' === ending) { await expect(ended).rejects.toThrow('SECRET-ERR'); }
      else { await expect(ended).resolves.toEqual({ stopReason: ending }); }
      expect(rig.commands.at(-1)).toBe(returnPrompt('Doctor'));
      expect(releasedAt).toEqual([3]);
      expect(beta.released).toEqual(['doc-1']);
      expect(rig.sessionStore.get(sessionId)?.parked).toBeUndefined();
   });
});
