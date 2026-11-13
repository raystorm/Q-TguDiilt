import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { end, say } from '../../drivers/__tests__/fake-governed-driver.js';
import { useTempDir, writeFile } from '../../drivers/__tests__/catalog-fixtures.js';
import { STATUS_DIR } from '../workflow-command.js';
import {
   type Cx, type LoopRig, act, createCx, eventsOf, handoffTurn as writes, loopRig, loopRoutes as ROUTES,
   nextLine as next, openChat as open, readyFile, sendPrompt as send, suggests, textsIn, unconfirmed, wait,
} from './agent.helpers.js';

const dirOf = useTempDir();

const makeRig = () => loopRig({ routes: ROUTES, dir: dirOf() });

/** The data of every log entry of one event, in order. */
const dataOf = (rig: LoopRig, event: string) => eventsOf(rig.logger, event).map(entry => entry.data);

/** What the client was sent as text, one entry per update, without the padding. */
const trimmed = (cx: Cx) => textsIn(cx).map(text => text.trim());

describe('the changeover loop: the status file confirms completion', () => {
   it('continues only with a fresh ready file, hop after hop', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      alpha.script(writes(rig, 'Enforcer'));
      beta.script(suggests(rig, 'Enforcer', 'Architect'));
      beta.script(writes(rig, 'Architect'));
      alpha.script([say('Built.')]);

      const response = await send(rig, await open(rig), 'as Planner go');

      expect(rig.commands).toEqual([
         'as Planner go', '@handoff to=Enforcer', '@start', '@handoff to=Architect', '@start',
      ]);
      expect(response).toEqual({ stopReason: 'end_turn' });
   });

   it('[H] a profile that is waiting is not handed off', async () => {
      const rig = makeRig();
      rig.scripted.alpha.script([
         act(() => readyFile(dirOf(), 'Planner', 'Enforcer', { status: 'waiting', next: undefined })),
         say('After you send me the answer, run `@handoff to=Enforcer`.\n\n'
            + '**Next**: after you send me X, run `@handoff to=Enforcer`'),
      ]);

      const response = await send(rig, await open(rig), 'as Planner go');

      expect(rig.commands).toEqual(['as Planner go']);
      expect(response).toEqual({ stopReason: 'end_turn' });
      expect(rig.scripted.beta.seen).toHaveLength(0);
   });

   it.each(unconfirmed)('[H] a status file that gives %s stops the loop', async (outcome, arrange) => {
      const rig = makeRig();
      rig.scripted.alpha.script([act(() => arrange(rig, dirOf())), say(next('Enforcer'))]);
      const sessionId = await open(rig);

      const response = await send(rig, sessionId, 'as Planner go');

      expect(rig.commands).toEqual(['as Planner go']);
      expect(response).toEqual({ stopReason: 'end_turn' });
      expect(rig.scripted.beta.seen).toHaveLength(0);
      expect(dataOf(rig, 'status_check')).toEqual([{ sessionId, profile: 'Planner', outcome }]);
   });

   it.each(unconfirmed)('a stop for %s shows no chat line', async (_outcome, arrange) => {
      const rig = makeRig();
      const cx  = createCx();
      rig.scripted.alpha.script([act(() => arrange(rig, dirOf())), say(next('Enforcer'))]);

      await send(rig, await open(rig), 'as Planner go', cx);

      expect(trimmed(cx)).toEqual([next('Enforcer')]);
   });

   it('a stop on a later hop shows only the lines of the hops that ran', async () => {
      const rig = makeRig();
      const cx  = createCx();
      const { alpha, beta } = rig.scripted;
      alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      alpha.script(writes(rig, 'Enforcer'));
      beta.script([act(() => rig.writeStatus('Enforcer', 'Architect', -60_000)), say(next('Architect'))]);

      await send(rig, await open(rig), 'as Planner go', cx);

      expect(trimmed(cx)).toEqual([
         next('Enforcer'), 'Changeover: sending `@handoff to=Enforcer`', 'Handoff written.',
         'Changeover: sending `@start`', next('Architect'),
      ]);
      expect(dataOf(rig, 'status_check').map(data => data.outcome)).toEqual(['confirmed', 'stale']);
   });

   it('[H] the session\'s profile picks the file, an alias or not', async () => {
      const rig = makeRig();
      rig.scripted.alpha.script(suggests(rig, 'PromptEngineer', 'Enforcer'));
      rig.scripted.alpha.script(writes(rig, 'Enforcer'));
      rig.scripted.beta.script([say('Reviewed.')]);

      await send(rig, await open(rig), 'as PE go');

      expect(rig.commands).toEqual(['as PE go', '@handoff to=Enforcer', '@start']);
   });

   it('[H] the file of another profile does not confirm', async () => {
      const rig = makeRig();
      rig.scripted.alpha.script(suggests(rig, 'Enforcer', 'Enforcer'));

      await send(rig, await open(rig), 'as PE go');

      expect(rig.commands).toEqual(['as PE go']);
   });

   it('[H] the file of a previous profile never confirms the next hop', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      alpha.script(suggests(rig, 'PromptEngineer', 'Enforcer'));
      alpha.script(writes(rig, 'Enforcer'));
      beta.script([say(next('Architect'))]);

      await send(rig, await open(rig), 'as PE go');

      expect(rig.commands).toEqual(['as PE go', '@handoff to=Enforcer', '@start']);
      expect(dataOf(rig, 'status_check').map(data => data.outcome)).toEqual(['confirmed', 'missing']);
   });

   it('[H] a session with no profile stops and reads nothing', async () => {
      const rig = makeRig();
      rig.writeStatus('Planner', 'Enforcer');
      rig.writeStatus('Enforcer', 'Planner');
      rig.scripted.alpha.script([say(next('Enforcer'))]);
      const sessionId = await open(rig);

      await send(rig, sessionId, 'go');

      expect(rig.commands).toEqual(['go']);
      expect(dataOf(rig, 'status_check')).toEqual([{ sessionId, outcome: 'missing' }]);
   });

   it('[H] a follow-up turn needs a new write', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      alpha.script([act(() => rig.writeStatus('Planner', 'Enforcer', -60_000)), say('Planner is done.')]);
      alpha.script([say(next('Enforcer'))]);
      alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      alpha.script(writes(rig, 'Enforcer'));
      beta.script([say('Reviewed.')]);
      const sessionId = await open(rig);

      await send(rig, sessionId, 'as Planner go');
      await send(rig, sessionId, 'what comes next?');
      expect(rig.commands).toEqual(['as Planner go', 'what comes next?']);

      await send(rig, sessionId, 'and now?');
      expect(rig.commands.slice(2)).toEqual(['and now?', '@handoff to=Enforcer', '@start']);
      expect(dataOf(rig, 'status_check').map(data => data.outcome)).toEqual(['stale', 'confirmed']);
   });

   it('[H] a hop to the same profile needs a new write', async () => {
      const rig = makeRig();
      const { alpha } = rig.scripted;
      alpha.script(suggests(rig, 'Planner', 'Planner'));
      alpha.script([
         act(() => {
            rig.writeHandoff('Planner');
            readyFile(dirOf(), 'Planner', 'Planner', { status: 'complete' }, -60_000);
         }),
         say('Handoff written.'),
      ]);
      alpha.script([say(next('Enforcer'))]);

      await send(rig, await open(rig), 'as Planner go');

      expect(rig.commands).toEqual(['as Planner go', '@handoff to=Planner', '@start']);
      expect(dataOf(rig, 'status_check').map(data => data.outcome)).toEqual(['confirmed', 'stale']);
   });

   it('[H] no check runs after a handoff turn', async () => {
      const rig = makeRig();
      rig.scripted.alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      rig.scripted.alpha.script([
         act(() => {
            rig.writeHandoff('Enforcer');
            readyFile(dirOf(), 'Planner', 'Enforcer', { status: 'complete' });
         }),
         say('Created.\n\n**Next**: Open a new tab and run `@start` (or `@handoff to=Doctor`)'),
      ]);
      rig.scripted.beta.script([say('Reviewed.')]);
      const sessionId = await open(rig);

      await send(rig, sessionId, 'as Planner go');

      expect(rig.commands).toEqual(['as Planner go', '@handoff to=Enforcer', '@start']);
      expect(dataOf(rig, 'status_check')).toEqual([{ sessionId, profile: 'Planner', outcome: 'confirmed' }]);
   });

   it('[H] a typed handoff checks no status file', async () => {
      const rig = makeRig();
      rig.scripted.alpha.script(writes(rig, 'Enforcer'));
      rig.scripted.beta.script([say('Reviewed.')]);

      await send(rig, await open(rig), '@handoff to=Enforcer');

      expect(rig.commands).toEqual(['@handoff to=Enforcer', '@start']);
      expect(eventsOf(rig.logger, 'status_check')).toEqual([]);
   });

   // how the turn ends, the stop reason the loop gives
   const BEFORE_THE_CHECK: Array<[string, string, (rig: LoopRig, id: string) => Promise<unknown>]> = [
      ['two suggestions', 'several_suggestions', async (rig, id) => {
         rig.scripted.alpha.script([say('Done.\n\n**Next**: `@handoff to=Planner` or `@handoff to=Enforcer`')]);
         await send(rig, id, 'as Planner go');
      }],
      ['no target', 'no_target', async (rig, id) => {
         rig.scripted.alpha.script([say('Done.\n\n**Next**: Run `@handoff`')]);
         await send(rig, id, 'as Planner go');
      }],
      ['an unknown profile', 'unknown_profile', async (rig, id) => {
         rig.scripted.alpha.script([say('Done.\n\n**Next**: Run `@handoff to=Nobody`')]);
         await send(rig, id, 'as Planner go');
      }],
      ['no completion line', 'no_suggestion', async (rig, id) => {
         rig.scripted.alpha.script([say('Done.')]);
         await send(rig, id, 'as Planner go');
      }],
      ['a cancel', 'cancelled', async (rig, id) => {
         rig.scripted.alpha.script([wait('w'), say(next('Enforcer'))]);
         const turn = send(rig, id, 'as Planner go');
         await rig.scripted.alpha.reached('w');
         await rig.agent.cancel({ sessionId: id });
         await turn;
      }],
      ['an abnormal end', 'abnormal_end', async (rig, id) => {
         rig.scripted.alpha.script([say(next('Enforcer')), end('refused')]);
         await send(rig, id, 'as Planner go');
      }],
      ['a failed delivery', 'failed', async (rig, id) => {
         const cx = createCx();
         cx.failNotify(0);
         rig.scripted.alpha.script([say(next('Enforcer'))]);
         await send(rig, id, 'as Planner go', cx);
      }],
   ];

   it.each(BEFORE_THE_CHECK)('[H] %s stops the loop without a check', async (_label, reason, run) => {
      const rig = makeRig();
      rig.writeStatus('Planner', 'Enforcer');

      await run(rig, await open(rig));

      expect(eventsOf(rig.logger, 'status_check')).toEqual([]);
      expect(eventsOf(rig.logger, 'status_read_failed')).toEqual([]);
      expect(dataOf(rig, 'loop_stopped')).toMatchObject([{ reason }]);
   });

   it('[H] a status folder that cannot be read ends as a stop, not a throw', async () => {
      const rig = makeRig();
      writeFile(join(dirOf(), STATUS_DIR), 'not a folder');
      rig.scripted.alpha.script([say(next('Enforcer'))]);
      const sessionId = await open(rig);

      const response = await send(rig, sessionId, 'as Planner go');

      expect(response).toEqual({ stopReason: 'end_turn' });
      expect(dataOf(rig, 'loop_stopped')).toHaveLength(1);
      rig.scripted.alpha.script([say('Back.')]);
      await expect(send(rig, sessionId, 'again')).resolves.toEqual({ stopReason: 'end_turn' });
   });

   // whether Planner's file is written, the commands sent
   const TYPED_START: Array<[boolean, string[]]> = [
      [true,  ['@start', '@handoff to=Enforcer', '@start']],
      [false, ['@start']],
   ];

   it.each(TYPED_START)('a typed start joins the check: the file written is %s', async (written, commands) => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      rig.writeHandoff('Planner');
      alpha.script([
         ...(written ? [act(() => rig.writeStatus('Planner', 'Enforcer'))] : []),
         say(`Planner starts.\n\n${next('Enforcer')}`),
      ]);
      alpha.script(writes(rig, 'Enforcer'));
      beta.script([say('Reviewed.')]);

      await send(rig, await open(rig), '@start');

      expect(rig.commands).toEqual(commands);
   });
});
