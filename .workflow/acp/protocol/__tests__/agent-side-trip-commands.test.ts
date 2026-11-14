import { describe, it, expect, vi } from 'vitest';
import { gate, say } from '../../drivers/__tests__/fake-governed-driver.js';
import { useTempDir } from '../../drivers/__tests__/catalog-fixtures.js';
import { TurnInProgressError } from '../errors.js';
import { returnPrompt } from '../agent/side-trip.js';
import {
   type Cx, type LoopRig, act, allow, asks, closesTrip, createCx, deferred, doctorFile, editReport, eventsOf,
   expectOpen, flush, handoffTurn, loopRig, loopRoutes, openChat, readyFile, reject, requestsOf,
   scriptSideTrip, sendLine, sendPrompt, sendTurn, suggests, suggestsSend, textsIn, wait, watch,
} from './agent.helpers.js';

const dirOf = useTempDir();

const makeRig = () => loopRig({ routes: loopRoutes, dir: dirOf() });

/** The data of every log entry of one event, in order. */
const dataOf = (rig: LoopRig, event: string) => eventsOf(rig.logger, event).map(entry => entry.data);

/** What the client was sent as text, one entry per update, without the padding. */
const trimmed = (cx: Cx) => textsIn(cx).map(text => text.trim());

/** The commands up to the start of the side profile. */
const TO_RECEIVE = ['as Enforcer go', '@send to=Doctor', '@receive'];

const CLOSE_TEXT = 'Close this tab and return to Enforcer.';

describe('the main thread after the return', () => {
   it('[H] a handoff after the return is carried, and it releases the unparked session', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      scriptSideTrip(rig, [closesTrip(rig, 'Doctor', 'Enforcer')], suggests(rig, 'Enforcer', 'Planner'));
      beta.script(handoffTurn(rig, 'Planner'), { sessionId: 'enf-1' });
      alpha.script([say('Planned.')], { sessionId: 'pl-1' });
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, 'as Enforcer go');

      const record = rig.sessionStore.get(sessionId);
      expect(rig.commands).toEqual([...TO_RECEIVE, returnPrompt('Doctor'), '@handoff to=Planner', '@start']);
      expect(beta.released).toEqual(['doc-1', 'enf-1']);
      expect(record).toMatchObject({ profile: 'Planner', driverSessionId: 'pl-1' });
      expect(record?.parked).toBeUndefined();
   });
});

describe('asks and prompts during a side trip', () => {
   it('[H] an ask in the side turn waits for the user, and the trip goes on after the answer', async () => {
      const rig    = makeRig();
      const answer = deferred<unknown>();
      const cx     = createCx({ respond: () => answer.promise });
      scriptSideTrip(rig, [[gate(editReport), ...closesTrip(rig, 'Doctor', 'Enforcer')]]);
      const turn  = sendPrompt(rig, await openChat(rig), 'as Enforcer go', cx);
      const state = watch(turn);
      await vi.waitFor(() => expect(requestsOf(cx)).toHaveLength(1));
      await flush();

      expect(rig.commands).toEqual(TO_RECEIVE);
      expect(state.done).toBe(false);
      answer.resolve({ outcome: allow });
      await turn;

      expect(rig.commands.at(-1)).toBe(returnPrompt('Doctor'));
      expect(requestsOf(cx)).toHaveLength(1);
      expect(rig.scripted.beta.decisions).toEqual(['approve']);
   });

   it('a rejected ask lets the side turn end as usual', async () => {
      const rig = makeRig();
      const cx  = createCx({ permission: reject });
      scriptSideTrip(rig, [[gate(editReport), ...closesTrip(rig, 'Doctor', 'Enforcer')]]);

      await sendPrompt(rig, await openChat(rig), 'as Enforcer go', cx);

      expect(rig.scripted.beta.decisions).toEqual(['deny']);
      expect(rig.commands.at(-1)).toBe(returnPrompt('Doctor'));
   });

   it('[H] a prompt typed while the trip runs is rejected, and the trip is unaffected', async () => {
      const rig = makeRig();
      scriptSideTrip(rig, [[wait('w'), ...closesTrip(rig, 'Doctor', 'Enforcer')]]);
      const sessionId = await openChat(rig);
      const turn = sendPrompt(rig, sessionId, 'as Enforcer go');
      await rig.scripted.beta.reached('w');

      await expect(sendPrompt(rig, sessionId, 'too soon')).rejects.toBeInstanceOf(TurnInProgressError);
      rig.scripted.beta.release('w');
      await turn;

      expect(rig.commands).toEqual([...TO_RECEIVE, returnPrompt('Doctor')]);
   });

   it('[H] a disconnect with a parked session aborts the turn and empties the store', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      const closed = [vi.spyOn(alpha.driver, 'close'), vi.spyOn(beta.driver, 'close')];
      scriptSideTrip(rig, [[wait('w')]]);
      const sessionId = await openChat(rig);
      const turn = sendPrompt(rig, sessionId, 'as Enforcer go');
      await beta.reached('w');

      await rig.agent.onDisconnect();

      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(rig.commands).toEqual(TO_RECEIVE);
      for (const spy of closed) { expect(spy).toHaveBeenCalledTimes(1); }
      expect(rig.sessionStore.get(sessionId)).toBeUndefined();
   });
});

describe('commands typed by the user', () => {
   /** A chat in which Enforcer has had its first prompt; the typed command comes next. */
   async function afterFirstPrompt(rig: LoopRig)
   {
      rig.scripted.beta.script([say('Ready.')], { sessionId: 'enf-1' });
      const sessionId = await openChat(rig);
      await sendPrompt(rig, sessionId, 'as Enforcer go');
      return sessionId;
   }

   const TYPED_SENDS = ['@send to=Doctor', '/send to=Doctor', 'please @SEND to=Doctor'];

   it.each(TYPED_SENDS)('[H] "%s" starts a trip after the message check, with no status check', async text => {
      const rig = makeRig();
      const { beta } = rig.scripted;
      const sessionId = await afterFirstPrompt(rig);
      beta.script(sendTurn(rig, 'Enforcer', 'Doctor'), { sessionId: 'enf-1' });
      beta.script(closesTrip(rig, 'Doctor', 'Enforcer'), { sessionId: 'doc-1' });
      beta.script([say('Resumed.')], { sessionId: 'enf-1' });

      await sendPrompt(rig, sessionId, text);

      expect(rig.commands).toEqual(['as Enforcer go', text, '@receive', returnPrompt('Doctor')]);
      expect(dataOf(rig, 'status_check').map(data => data.check)).toEqual(['end']);
      expect(beta.released).toEqual(['doc-1']);
   });

   it('[H] a typed send with no message file stops with message_not_written', async () => {
      const rig = makeRig();
      const cx  = createCx();
      const sessionId = await afterFirstPrompt(rig);
      rig.scripted.beta.script([say('Nothing written.')], { sessionId: 'enf-1' });

      await sendPrompt(rig, sessionId, '@send to=Doctor', cx);

      expect(rig.commands).toEqual(['as Enforcer go', '@send to=Doctor']);
      expect(dataOf(rig, 'loop_stopped').at(-1)).toMatchObject({ reason: 'message_not_written' });
      expect(rig.sessionStore.get(sessionId)?.parked).toBeUndefined();
   });

   const BOTH_TYPED = ['@handoff to=Planner @send to=Doctor', 'please /send to=Doctor, or /handoff to=Planner'];

   it.each(BOTH_TYPED)('[H] "%s" holds a handoff and a send: it stops and starts nothing', async text => {
      const rig = makeRig();
      const cx  = createCx();
      const sessionId = await afterFirstPrompt(rig);
      rig.scripted.beta.script([
         act(() => { rig.writeHandoff('Planner'); rig.writeMessage('Doctor'); }),
         say('Both written.'),
      ], { sessionId: 'enf-1' });

      await sendPrompt(rig, sessionId, text, cx);

      expect(rig.commands).toEqual(['as Enforcer go', text]);
      expect(dataOf(rig, 'loop_stopped').at(-1)).toMatchObject({ reason: 'several_suggestions' });
      expect(trimmed(cx).at(-1)).toContain('Several next steps');
      expect(rig.scripted.alpha.seen).toHaveLength(0);
      expect(rig.sessionStore.get(sessionId)?.parked).toBeUndefined();
   });

   it('[H] a typed handoff inside a trip is not followed', async () => {
      const rig = makeRig();
      const cx  = createCx();
      scriptSideTrip(rig, [asks(rig), [act(() => rig.writeHandoff('PromptEngineer')), say('Handoff written.')]]);
      const sessionId = await openChat(rig);
      await sendPrompt(rig, sessionId, 'as Enforcer go');

      await sendPrompt(rig, sessionId, '@handoff to=PromptEngineer', cx);

      expect(rig.commands).toEqual([...TO_RECEIVE, '@handoff to=PromptEngineer']);
      expect(dataOf(rig, 'loop_stopped').at(-1)).toMatchObject({ reason: 'handoff_in_trip' });
      expect(trimmed(cx).at(-1)).toContain('@send to=');
      expect(rig.scripted.alpha.seen).toHaveLength(0);
      expectOpen(rig, sessionId);
   });

   it('[H] a typed send inside a trip moves it: the side session goes, the main one stays parked', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      const writesMessage = [
         act(() => {
            rig.writeMessage('PromptEngineer');
            doctorFile(rig, { status: 'waiting', next: undefined });
         }),
         say('Message written.'),
      ];
      scriptSideTrip(rig, [asks(rig), writesMessage]);
      alpha.script(closesTrip(rig, 'PromptEngineer', 'Enforcer'), { sessionId: 'pe-1' });
      const sessionId = await openChat(rig);
      await sendPrompt(rig, sessionId, 'as Enforcer go');

      await sendPrompt(rig, sessionId, '@send to=PromptEngineer');

      expect(rig.commands).toEqual([
         ...TO_RECEIVE, '@send to=PromptEngineer', '@receive', returnPrompt('PromptEngineer'),
      ]);
      expect(beta.released).toEqual(['doc-1']);
      expect(alpha.released).toEqual(['pe-1']);
      expect(beta.seen.at(-1)).toMatchObject({ options: { sessionId: 'enf-1' } });
      expect(rig.sessionStore.get(sessionId)?.parked).toBeUndefined();
   });
});

describe('what a side trip logs and shows', () => {
   // what the message file names, then what must not reach the log
   const NAMES: Array<[string, string]> = [
      ['200 characters', 'x'.repeat(200)],
      ['a secret-looking name', 'a1b2c3d4e5'.repeat(4)],
   ];

   it.each(NAMES)('[H] an unknown name in the message file (%s) is cut to 64 characters and redacted', async (
      _label, name,
   ) => {
      const rig = makeRig();
      const { beta } = rig.scripted;
      beta.script(suggestsSend(rig, 'Enforcer', 'Doctor'), { sessionId: 'enf-1' });
      beta.script([act(() => rig.writeMessage(name)), say('Message written.')], { sessionId: 'enf-1' });

      await sendPrompt(rig, await openChat(rig), 'as Enforcer go');

      const [stopped] = dataOf(rig, 'loop_stopped');
      expect(stopped).toMatchObject({ reason: 'unknown_profile' });
      expect(stopped.word.length).toBeLessThanOrEqual(64);
      expect(JSON.stringify(rig.logger.entries)).not.toContain(name);
   });

   const MARKER = 'SECRET-FILE-TEXT';

   it('[H] a status file read for a send check reaches neither the log nor the chat', async () => {
      const rig = makeRig();
      const cx  = createCx();
      rig.scripted.beta.script([
         act(() => readyFile(rig.workDir, 'Enforcer', MARKER, {
            workflowId: MARKER, note: MARKER, next: { command: 'send', to: MARKER },
         })),
         say(sendLine('Doctor')),
      ]);

      await sendPrompt(rig, await openChat(rig), 'as Enforcer go', cx);

      const seen = JSON.stringify(rig.logger.entries) + textsIn(cx).join('');
      expect(dataOf(rig, 'status_check')).toMatchObject([{ check: 'send', outcome: 'mismatch' }]);
      for (const text of [MARKER, dirOf()]) { expect(seen).not.toContain(text); }
   });

   it('[H] a status file read for an end check reaches neither the log nor the chat', async () => {
      const rig = makeRig();
      const cx  = createCx();
      scriptSideTrip(rig, [[
         act(() => doctorFile(rig, {
            status: 'complete', workflowId: MARKER, note: MARKER, next: { command: 'handoff', to: MARKER },
         })),
         say(CLOSE_TEXT),
      ]]);

      await sendPrompt(rig, await openChat(rig), 'as Enforcer go', cx);

      const seen = JSON.stringify(rig.logger.entries) + textsIn(cx).join('');
      expect(dataOf(rig, 'status_check').at(-1)).toMatchObject({ check: 'end', outcome: 'mismatch' });
      for (const text of [MARKER, dirOf()]) { expect(seen).not.toContain(text); }
   });
});
