import { describe, it, expect } from 'vitest';
import { say } from '../../drivers/__tests__/fake-governed-driver.js';
import { useTempDir } from '../../drivers/__tests__/catalog-fixtures.js';
import { returnPrompt } from '../agent/side-trip.js';
import {
   type Cx, type LoopRig, type ScriptStep, act, allOnAlpha, closesTrip, createCx, eventsOf, loopRig, loopRoutes,
   nextLine, openChat, readyFile, sendLine, sendPrompt, sendTurn, suggestsSend, textsIn,
} from './agent.helpers.js';

const dirOf = useTempDir();

const makeRig = (routes = loopRoutes) => loopRig({ routes, dir: dirOf() });

/** The data of every log entry of one event, in order. */
const dataOf = (rig: LoopRig, event: string) => eventsOf(rig.logger, event).map(entry => entry.data);

/** What the client was sent as text, one entry per update, without the padding. */
const trimmed = (cx: Cx) => textsIn(cx).map(text => text.trim());

type Routes = Record<string, string | [string, string]>;

/** One scripted turn: the profile it runs for, the driver session id that tells it apart, what it does. */
interface Turn { profile: string; id: string; steps: ScriptStep[] }

/** Queues each turn on the driver its profile runs on, in order. */
function play(rig: LoopRig, routes: Routes, turns: Turn[])
{
   for (const { profile, id, steps } of turns) {
      const route = routes[profile];
      rig.scripted['string' === typeof route ? route : route[0]].script(steps, { sessionId: id });
   }
}

/**
 * The chain: Enforcer sends to Doctor, Doctor sends to PromptEngineer, PromptEngineer sends to
 * PromptEngineer, and the last one closes the trip. The session ids tell the sessions apart.
 */
const chain = (rig: LoopRig): Turn[] => [
   { profile: 'Enforcer',       id: 'enf-1', steps: suggestsSend(rig, 'Enforcer', 'Doctor') },
   { profile: 'Enforcer',       id: 'enf-1', steps: sendTurn(rig, 'Enforcer', 'Doctor') },
   { profile: 'Doctor',         id: 'doc-1', steps: suggestsSend(rig, 'Doctor', 'PromptEngineer') },
   { profile: 'Doctor',         id: 'doc-1', steps: sendTurn(rig, 'Doctor', 'PromptEngineer') },
   { profile: 'PromptEngineer', id: 'pe-1',  steps: suggestsSend(rig, 'PromptEngineer', 'PromptEngineer') },
   { profile: 'PromptEngineer', id: 'pe-1',  steps: sendTurn(rig, 'PromptEngineer', 'PromptEngineer') },
   { profile: 'PromptEngineer', id: 'pe-2',  steps: closesTrip(rig, 'PromptEngineer', 'Enforcer') },
   { profile: 'Enforcer',       id: 'enf-1', steps: [say('Resumed.')] },
];

const CHAIN_COMMANDS = [
   'as Enforcer go', '@send to=Doctor', '@receive', '@send to=PromptEngineer', '@receive',
   '@send to=PromptEngineer', '@receive', returnPrompt('PromptEngineer'),
];

describe('moves inside a side trip', () => {
   it('[H] the chain, from the first send to the return', async () => {
      const rig = makeRig();
      play(rig, loopRoutes, chain(rig));
      const sessionId = await openChat(rig);

      const response = await sendPrompt(rig, sessionId, 'as Enforcer go');

      expect(rig.commands).toEqual(CHAIN_COMMANDS);
      expect(response).toEqual({ stopReason: 'end_turn' });
      expect(rig.scripted.beta.seen.at(-1)).toMatchObject({
         command: returnPrompt('PromptEngineer'), options: { sessionId: 'enf-1' },
      });
      expect(dataOf(rig, 'status_check').map(data => [data.check, data.profile])).toEqual([
         ['send', 'Enforcer'], ['send', 'Doctor'], ['send', 'PromptEngineer'], ['end', 'PromptEngineer'],
      ]);
   });

   // routes, the release calls expected on each driver
   const ROUTED: Array<[string, Routes, Record<string, string[]>]> = [
      ['two drivers', loopRoutes, { alpha: ['pe-1', 'pe-2'], beta: ['doc-1'] }],
      ['one driver',  allOnAlpha, { alpha: ['doc-1', 'pe-1', 'pe-2'] }],
   ];

   it.each(ROUTED)('[H] a hop releases the sender and never the parked session: %s', async (
      _label, routes, expected,
   ) => {
      const rig = makeRig(routes);
      play(rig, routes, chain(rig));
      // The id, how many commands had been sent, and how many resolutions had been made.
      const releases: Array<[string, number, number]> = [];
      for (const each of Object.values(rig.scripted)) {
         each.onRelease = async id => { releases.push([id, rig.commands.length, rig.resolver.calls.length]); };
      }

      await sendPrompt(rig, await openChat(rig), 'as Enforcer go');

      expect(releases).toEqual([['doc-1', 4, 4], ['pe-1', 6, 5], ['pe-2', 7, 5]]);
      for (const [name, each] of Object.entries(rig.scripted)) { expect(each.released).toEqual(expected[name]); }
   });

   it('[H] each command is logged with its trigger and its hop, and the stop carries the last hop', async () => {
      const rig = makeRig();
      play(rig, loopRoutes, chain(rig));
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, 'as Enforcer go');

      const sent = (from: string, to: string, trigger: string, profileHop: number) =>
         ({ sessionId, from, to, trigger, profileHop });
      expect(dataOf(rig, 'changeover_sent')).toEqual([
         sent('Enforcer',       'Doctor',         'send',    1),
         sent('Enforcer',       'Doctor',         'receive', 1),
         sent('Doctor',         'PromptEngineer', 'send',    2),
         sent('Doctor',         'PromptEngineer', 'receive', 2),
         sent('PromptEngineer', 'PromptEngineer', 'send',    3),
         sent('PromptEngineer', 'PromptEngineer', 'receive', 3),
         sent('PromptEngineer', 'Enforcer',       'return',  4),
      ]);
      expect(dataOf(rig, 'loop_stopped')).toEqual([{ sessionId, reason: 'no_suggestion', profileHop: 4 }]);
   });

   it('[H] a sender whose file names another target stops the chain there', async () => {
      const rig = makeRig();
      const turns = chain(rig).slice(0, 3);
      turns[2].steps = [
         act(() => readyFile(rig.workDir, 'Doctor', 'Planner', { next: { command: 'send', to: 'Planner' } })),
         say(sendLine('PromptEngineer')),
      ];
      play(rig, loopRoutes, turns);
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, 'as Enforcer go');

      const record = rig.sessionStore.get(sessionId);
      expect(rig.commands).toEqual(CHAIN_COMMANDS.slice(0, 3));
      expect(dataOf(rig, 'status_check').at(-1)).toEqual({
         sessionId, profile: 'Doctor', check: 'send', outcome: 'mismatch',
      });
      expect(dataOf(rig, 'loop_stopped')).toMatchObject([{ reason: 'status_not_confirmed' }]);
      expect(rig.scripted.beta.released).toEqual([]);
      expect(record?.driverSessionId).toBe('doc-1');
      expect(record?.parked?.driverSessionId).toBe('enf-1');
   });

   it('[H] a hop whose target cannot be resolved changes nothing', async () => {
      const { PromptEngineer: _missing, ...routes } = loopRoutes;
      const rig = makeRig(routes);
      play(rig, routes, chain(rig).slice(0, 4));
      const sessionId = await openChat(rig);

      await expect(sendPrompt(rig, sessionId, 'as Enforcer go')).rejects.toThrow('no route for PromptEngineer');

      const record = rig.sessionStore.get(sessionId);
      expect(rig.commands).toEqual(CHAIN_COMMANDS.slice(0, 4));
      expect(rig.scripted.beta.released).toEqual([]);
      expect(record?.profile).toBe('Doctor');
      expect(record?.driverSessionId).toBe('doc-1');
      expect(record?.parked?.driverSessionId).toBe('enf-1');
   });
});

describe('a side trip moves only by a send', () => {
   /** The chain up to Doctor's first turn, which says `text` after `arrange` ran. */
   const doctorSays = (rig: LoopRig, arrange: () => void, text: string) => {
      const turns = chain(rig).slice(0, 3);
      turns[2].steps = [act(arrange), say(text)];
      play(rig, loopRoutes, turns);
   };

   it('[H] a handoff suggestion stops, says why, and sends nothing', async () => {
      const rig = makeRig();
      const cx  = createCx();
      doctorSays(rig, () => {
         rig.writeStatus('Doctor', 'PromptEngineer');
         rig.writeHandoff('PromptEngineer');
      }, nextLine('PromptEngineer'));
      const sessionId = await openChat(rig);

      const response = await sendPrompt(rig, sessionId, 'as Enforcer go', cx);

      const record = rig.sessionStore.get(sessionId);
      expect(response).toEqual({ stopReason: 'end_turn' });
      expect(rig.commands).toEqual(CHAIN_COMMANDS.slice(0, 3));
      expect(dataOf(rig, 'loop_stopped')).toMatchObject([{ reason: 'handoff_in_trip' }]);
      expect(trimmed(cx).at(-1)).toContain('@send to=');
      expect(dataOf(rig, 'status_check').map(data => data.check)).toEqual(['send']);
      expect(rig.scripted.beta.released).toEqual([]);
      expect(record?.driverSessionId).toBe('doc-1');
      expect(record?.parked?.driverSessionId).toBe('enf-1');
   });

   const either = (one: string, other: string) => `**Next**: \`${one}\` or \`${other}\``;

   // label, what Doctor says, the stop, the word shown for an unknown profile
   const STOPS: Array<[string, string, string, string?]> = [
      ['two handoffs',         either('@handoff to=Planner', '@handoff to=Enforcer'), 'several_suggestions'],
      ['a handoff and a send', either('@handoff to=Planner', '@send to=Doctor'),      'several_suggestions'],
      ['two sends',            either('@send to=Planner', '@send to=Doctor'),         'several_suggestions'],
      ['a send with no target', '**Next**: Run `@send`',                              'no_target'],
      ['a send to a stranger', sendLine('Nobody'),                                    'unknown_profile', 'Nobody'],
   ];

   it.each(STOPS)('[H] %s stops as it does outside a trip, and the trip stays open', async (
      _label, text, reason, word,
   ) => {
      const rig = makeRig();
      doctorSays(rig, () => {}, text);
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, 'as Enforcer go');

      const record = rig.sessionStore.get(sessionId);
      expect(dataOf(rig, 'loop_stopped')).toMatchObject([{ reason, ...(undefined === word ? {} : { word }) }]);
      expect(dataOf(rig, 'status_check').map(data => data.check)).toEqual(['send']);
      expect(rig.commands).toEqual(CHAIN_COMMANDS.slice(0, 3));
      expect(rig.scripted.beta.released).toEqual([]);
      expect(record?.driverSessionId).toBe('doc-1');
      expect(record?.parked?.driverSessionId).toBe('enf-1');
   });
});
