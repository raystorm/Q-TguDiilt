import { describe, it, expect } from 'vitest';
import { mkdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { end, say } from '../../drivers/__tests__/fake-governed-driver.js';
import { useTempDir, writeFile } from '../../drivers/__tests__/catalog-fixtures.js';
import { STATUS_DIR } from '../workflow-command.js';
import {
   type LogEntry, type LoopRig, act, createCx, eventsOf, handoffTurn, loopRig, loopRoutes, nextLine, openChat,
   plannerToEnforcer, readyFile, scriptChain, sendPrompt, statusFile, suggests, textsIn, throws,
   unconfirmed, wait,
} from './agent.helpers.js';

const dirOf = useTempDir();

const makeRig = (routes = loopRoutes) => loopRig({ routes, dir: dirOf() });

/** The data of every log entry of one event, in order. */
const dataOf = (rig: LoopRig, event: string) => eventsOf(rig.logger, event).map(entry => entry.data);

/** The event name of every log entry, in order. */
const eventNamesOf = (rig: LoopRig): string[] => rig.logger.entries.map((entry: LogEntry) => entry.event);

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
      alpha.script([
         act(() => rig.writeStatus('Planner', 'Enforcer')),
         say(`SECRET-TEXT body.\n\n${nextLine('Enforcer')} SECRET-TEXT`),
      ]);
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
      alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      alpha.script(handoffTurn(rig, 'Enforcer'));
      beta.script(suggests(rig, 'Enforcer', 'Architect'));
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

   it('[H] a check is logged once for each suggestion, before the command it allows', async () => {
      const names = ['Planner', 'PromptEngineer', 'Architect', 'Doctor'];
      const rig   = makeRig(Object.fromEntries(names.map(name => [name, 'alpha'])));
      scriptChain(rig, 'alpha', names);
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, 'as Planner go');

      expect(dataOf(rig, 'status_check')).toEqual([
         { sessionId, profile: 'Planner',        outcome: 'confirmed' },
         { sessionId, profile: 'PromptEngineer', outcome: 'confirmed' },
         { sessionId, profile: 'Architect',      outcome: 'confirmed' },
      ]);
      const order = eventNamesOf(rig).filter(event => 'status_check' === event || 'changeover_sent' === event);
      expect(order).toEqual(Array(3).fill(['status_check', 'changeover_sent', 'changeover_sent']).flat());
   });

   // outcome, how the folder is left: the one that continues, then the six that stop
   const CHECKS: Array<[string, (rig: LoopRig, dir: string) => void]> = [
      ['confirmed', rig => { rig.writeStatus('Planner', 'Enforcer'); }],
      ...unconfirmed,
   ];

   it.each(CHECKS)('a check that gives %s logs the session, the profile and the outcome only', async (
      outcome, arrange,
   ) => {
      const rig = makeRig();
      rig.scripted.alpha.script([act(() => arrange(rig, dirOf())), say(nextLine('Enforcer'))]);
      rig.scripted.alpha.script(handoffTurn(rig, 'Enforcer'));
      rig.scripted.beta.script([say('Reviewed.')]);
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, 'as Planner go');

      expect(eventsOf(rig.logger, 'status_check')).toEqual([
         { level: 'info', event: 'status_check', data: { sessionId, profile: 'Planner', outcome } },
      ]);
   });

   // how the folder is left, the code logged, the outcome
   const FAILED_READS: Array<[string, (dir: string) => void, string, string]> = [
      ['the status path is a file', dir => { writeFile(join(dir, STATUS_DIR), 'x'); }, 'ENOTDIR', 'missing'],
      ['a directory is named like a status file', dir => {
         const path  = join(dir, STATUS_DIR, 'Planner-wf-a.json');
         const ahead = (Date.now() + 5000) / 1000;
         mkdirSync(path, { recursive: true });
         utimesSync(path, ahead, ahead);
      }, 'EISDIR', 'invalid'],
   ];

   it.each(FAILED_READS)('[H] %s: a warning with the code only, then the check', async (
      _label, arrange, code, outcome,
   ) => {
      const rig = makeRig();
      arrange(dirOf());
      rig.scripted.alpha.script([say(nextLine('Enforcer'))]);
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, 'as Planner go');

      expect(eventsOf(rig.logger, 'status_read_failed')).toEqual([
         { level: 'warn', event: 'status_read_failed', data: { sessionId, code } },
      ]);
      expect(dataOf(rig, 'status_check')).toEqual([{ sessionId, profile: 'Planner', outcome }]);
      const order = eventNamesOf(rig).filter(event => event.startsWith('status_'));
      expect(order).toEqual(['status_read_failed', 'status_check']);
   });

   // how the folder is left when there is nothing to read
   const NOTHING_TO_READ: Array<[string, (dir: string) => void]> = [
      ['no status folder', () => {}],
      ['an empty status folder', dir => { mkdirSync(join(dir, STATUS_DIR), { recursive: true }); }],
      ['a status folder holding only .gitkeep', dir => { writeFile(join(dir, STATUS_DIR, '.gitkeep'), ''); }],
   ];

   it.each(NOTHING_TO_READ)('%s logs no failed read', async (_label, arrange) => {
      const rig = makeRig();
      arrange(dirOf());
      rig.scripted.alpha.script([say(nextLine('Enforcer'))]);

      await sendPrompt(rig, await openChat(rig), 'as Planner go');

      expect(eventsOf(rig.logger, 'status_read_failed')).toEqual([]);
      expect(dataOf(rig, 'status_check')).toMatchObject([{ outcome: 'missing' }]);
   });

   const MARKER = 'SECRET-FILE-TEXT';

   // where the marker sits, how the folder is left; each of these stops the loop
   const WITH_MARKER: Array<[string, (dir: string) => void]> = [
      ['next.to', dir => { readyFile(dir, 'Planner', MARKER); }],
      ['workflowId', dir => {
         readyFile(dir, 'Planner', 'Enforcer', { workflowId: MARKER, status: 'waiting', next: undefined });
      }],
      ['an extra field', dir => {
         readyFile(dir, 'Planner', 'Enforcer', { note: MARKER, status: 'started', next: undefined });
      }],
      ['the file name', dir => { statusFile(dir, `Planner-${MARKER}.json`, 'not json'); }],
      ...FAILED_READS.map(([label, arrange]): [string, (dir: string) => void] => [label, arrange]),
   ];

   it.each(WITH_MARKER)('[H] %s of a status file reaches neither the log nor the chat', async (
      _label, arrange,
   ) => {
      const rig = makeRig();
      const cx  = createCx();
      arrange(dirOf());
      rig.scripted.alpha.script([say(nextLine('Enforcer'))]);

      await sendPrompt(rig, await openChat(rig), 'as Planner go', cx);

      const seen = JSON.stringify(rig.logger.entries) + textsIn(cx).join('');
      for (const text of [MARKER, dirOf(), 'not a directory', 'scandir', 'illegal operation']) {
         expect(seen).not.toContain(text);
      }
   });

   it.each(unconfirmed)('a stop for %s is logged once, with its own reason and no word', async (
      _outcome, arrange,
   ) => {
      const rig = makeRig();
      rig.scripted.alpha.script([act(() => arrange(rig, dirOf())), say(nextLine('Enforcer'))]);
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, 'as Planner go');

      const stopped = dataOf(rig, 'loop_stopped');
      expect(stopped).toEqual([{ sessionId, reason: 'status_not_confirmed', profileHop: 0 }]);
      expect(STOPS.map(([reason]) => reason)).not.toContain(stopped[0].reason);
   });

   it('a status stop on a later hop carries the hops done', async () => {
      const rig = makeRig();
      rig.scripted.alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      rig.scripted.alpha.script(handoffTurn(rig, 'Enforcer'));
      rig.scripted.beta.script([say(nextLine('Architect'))]);

      await sendPrompt(rig, await openChat(rig), 'as Planner go');

      expect(dataOf(rig, 'loop_stopped')).toMatchObject([{ reason: 'status_not_confirmed', profileHop: 1 }]);
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
