import { describe, it, expect } from 'vitest';
import { end, say } from '../../drivers/__tests__/fake-governed-driver.js';
import { useTempDir } from '../../drivers/__tests__/catalog-fixtures.js';
import {
   type LoopRig, eventsOf, handoffTurn, loopRig, loopRoutes, nextLine, openChat, plannerToEnforcer,
   scriptChain, sendPrompt, throws, wait,
} from './agent.helpers.js';

const dirOf = useTempDir();

const makeRig = (routes = loopRoutes) => loopRig({ routes, dir: dirOf() });

/** The data of every log entry of one event, in order. */
const dataOf = (rig: LoopRig, event: string) => eventsOf(rig.logger, event).map(entry => entry.data);

describe('the changeover loop: logging', () => {
   it('each command sent is logged with its profiles, trigger and hop', async () => {
      const rig = makeRig();
      plannerToEnforcer(rig, 'beta');
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, 'as Planner go');

      const sent = { sessionId, from: 'Planner', to: 'Enforcer', profileHop: 1 };
      expect(dataOf(rig, 'changeover_sent')).toEqual([
         { ...sent, trigger: 'handoff' }, { ...sent, trigger: 'start' },
      ]);
      expect(eventsOf(rig.logger, 'changeover_sent').every(entry => 'info' === entry.level)).toBe(true);
   });

   it('a typed handoff logs only the start, as hop 1, with no profile before it', async () => {
      const rig = makeRig();
      rig.scripted.alpha.script(handoffTurn(rig, 'Enforcer'));
      rig.scripted.beta.script([say('Reviewed.')]);
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, '@handoff');

      expect(dataOf(rig, 'changeover_sent')).toEqual([
         { sessionId, to: 'Enforcer', trigger: 'start', profileHop: 1 },
      ]);
   });

   // the reason, how the prompt gets there
   const STOPS: Array<[string, (rig: LoopRig, sessionId: string) => Promise<unknown>]> = [
      ['no_suggestion', async (rig, id) => {
         rig.scripted.alpha.script([say('Done.')]);
         await sendPrompt(rig, id, 'as Planner go');
      }],
      ['several_suggestions', async (rig, id) => {
         rig.scripted.alpha.script([say('Done.\n\n**Next**: `@handoff to=Planner` or `@handoff to=Enforcer`')]);
         await sendPrompt(rig, id, 'as Planner go');
      }],
      ['no_target', async (rig, id) => {
         rig.scripted.alpha.script([say('Done.\n\n**Next**: Run `@handoff`')]);
         await sendPrompt(rig, id, 'as Planner go');
      }],
      ['unknown_profile', async (rig, id) => {
         rig.scripted.alpha.script([say('Done.\n\n**Next**: Run `@handoff to=Nobody`')]);
         await sendPrompt(rig, id, 'as Planner go');
      }],
      ['handoff_not_written', async (rig, id) => {
         rig.scripted.alpha.script([say('Done.')]);
         await sendPrompt(rig, id, '@handoff to=Planner');
      }],
      ['abnormal_end', async (rig, id) => {
         rig.scripted.alpha.script([say('Cut.'), end('refused')]);
         await sendPrompt(rig, id, 'as Planner go');
      }],
      ['failed', async (rig, id) => {
         rig.scripted.alpha.script([throws(new Error('boom'))]);
         await sendPrompt(rig, id, 'as Planner go').catch(() => undefined);
      }],
      ['cancelled', async (rig, id) => {
         rig.scripted.alpha.script([wait('w')]);
         const turn = sendPrompt(rig, id, 'as Planner go');
         await rig.scripted.alpha.reached('w');
         await rig.agent.cancel({ sessionId: id });
         await turn;
      }],
   ];

   it.each(STOPS)('[H] a stop for %s is logged once, with its reason', async (reason, run) => {
      const rig = makeRig();
      const sessionId = await openChat(rig);

      await run(rig, sessionId);

      const stopped = dataOf(rig, 'loop_stopped');
      expect(stopped).toHaveLength(1);
      expect(stopped[0]).toMatchObject({ sessionId, reason });
   });

   it('[H] the log holds no agent text', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      alpha.script([say(`SECRET-TEXT body.\n\n${nextLine('Enforcer')} SECRET-TEXT`)]);
      alpha.script([...handoffTurn(rig, 'Enforcer'), say('SECRET-TEXT')]);
      beta.script([say('SECRET-TEXT reviewed.\n\n**Next**: `@handoff to=Planner` or `@handoff to=Doctor`')]);

      await sendPrompt(rig, await openChat(rig), 'as Planner go');

      expect(dataOf(rig, 'loop_stopped')).toHaveLength(1);
      expect(JSON.stringify(rig.logger.entries)).not.toContain('SECRET-TEXT');
   });

   // where the unknown name comes from, how it gets there
   const ORIGINS: Array<[string, (rig: LoopRig, name: string) => string]> = [
      ['the agent\'s suggestion', (rig, name) => {
         rig.scripted.alpha.script([say(`Done.\n\n**Next**: Run \`@handoff to=${name}\``)]);
         return 'as Planner go';
      }],
      ['the handoff file', (rig, name) => {
         rig.scripted.alpha.script(handoffTurn(rig, name));
         return '@handoff';
      }],
   ];

   it.each(ORIGINS)('[H] an unknown name from %s is cut to 64 characters', async (_origin, setup) => {
      const rig  = makeRig();
      const text = setup(rig, 'x'.repeat(200));

      await sendPrompt(rig, await openChat(rig), text);

      expect(dataOf(rig, 'loop_stopped')[0]).toMatchObject({ reason: 'unknown_profile' });
      expect(dataOf(rig, 'loop_stopped')[0].word).toHaveLength(64);
   });

   it.each(ORIGINS)('[H] an unknown name from %s that looks like a secret is redacted', async (_origin, setup) => {
      const token = 'a1b2c3d4e5'.repeat(4);
      const rig   = makeRig();
      const text  = setup(rig, token);

      await sendPrompt(rig, await openChat(rig), text);

      expect(dataOf(rig, 'loop_stopped')[0]).toMatchObject({ reason: 'unknown_profile' });
      expect(JSON.stringify(rig.logger.entries)).not.toContain(token);
   });

   it('the profile hop counts profile changes, not turns', async () => {
      const names = ['Planner', 'PromptEngineer', 'Architect', 'Doctor'];
      const rig   = makeRig(Object.fromEntries(names.map(name => [name, 'alpha'])));
      scriptChain(rig, 'alpha', names);

      await sendPrompt(rig, await openChat(rig), 'as Planner go');

      expect(dataOf(rig, 'changeover_sent').map(entry => entry.profileHop)).toEqual([1, 1, 2, 2, 3, 3]);
      expect(dataOf(rig, 'loop_stopped')).toMatchObject([{ reason: 'no_suggestion', profileHop: 3 }]);
   });

   it('[H] a loop activates each start once and logs no reactivation or switch', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      alpha.script([say(nextLine('Enforcer'))]);
      alpha.script(handoffTurn(rig, 'Enforcer'));
      beta.script([say(nextLine('Architect'))]);
      beta.script(handoffTurn(rig, 'Architect'));
      alpha.script([say('Done.')]);
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, 'as Planner go');

      expect(eventsOf(rig.logger, 'profile_activated').map(entry => [entry.level, entry.data])).toEqual([
         ['info', { sessionId, profile: 'Enforcer', source: 'changeover' }],
         ['info', { sessionId, profile: 'Architect', source: 'changeover' }],
      ]);
      expect(eventsOf(rig.logger, 'profile_reactivated')).toEqual([]);
      expect(eventsOf(rig.logger, 'profile_switched')).toEqual([]);
   });

   it('a prompt rejected before its first turn logs no stop', async () => {
      const rig = makeRig();
      rig.scripted.alpha.script([wait('w')]);
      const sessionId = await openChat(rig);
      const turn = sendPrompt(rig, sessionId, 'as Planner go');
      await rig.scripted.alpha.reached('w');

      await expect(sendPrompt(rig, sessionId, 'too soon')).rejects.toThrow();
      await expect(sendPrompt(rig, await openChat(rig), '')).rejects.toThrow();
      rig.scripted.alpha.release('w');
      await turn;

      expect(dataOf(rig, 'loop_stopped')).toHaveLength(1);
   });
});
