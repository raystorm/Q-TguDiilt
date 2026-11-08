import { describe, it, expect } from 'vitest';
import { useTempDir } from '../../drivers/__tests__/catalog-fixtures.js';
import { HANDOFF_PATH, MESSAGE_PATH } from '../workflow-command.js';
import {
   type LogEntry, changeover, createCx, createDriverSpy, createResolverStub, eventsOf, makeAgent,
   newSessionArgs, resolved, textParam,
} from './agent.helpers.js';

const dirOf = useTempDir();

function logged(overrides: any = {})
{
   const made = makeAgent({ workDir: dirOf(), ...overrides });
   const open = async () => (await made.agent.newSession(newSessionArgs())).sessionId;
   const say  = (id: string, text: string) =>
      made.agent.prompt({ sessionId: id, ...textParam(text) }, createCx());
   return { ...made, open, say };
}

const profileWarns = (entries: LogEntry[]) =>
   entries.filter(entry => 'warn' === entry.level && entry.event.startsWith('profile_'));
const dataOf = (entries: LogEntry[], event: string) =>
   eventsOf({ entries }, event).map(entry => entry.data);

describe('logging an activation', () => {
   it('a first user activation logs no warning', async () => {
      const { say, open, logger } = logged();
      await say(await open(), 'as Planner');
      expect(profileWarns(logger.entries)).toEqual([]);
   });

   it('[H] a repeat is a warning with the previous profile', async () => {
      const { say, open, logger } = logged();
      const id = await open();
      await say(id, 'as Planner');
      await say(id, 'as Planner');
      expect(dataOf(logger.entries, 'profile_reactivated'))
         .toEqual([{ sessionId: id, profile: 'Planner', previous: 'Planner' }]);
      expect(dataOf(logger.entries, 'profile_switched')).toEqual([]);
   });

   it('[H] a different profile logs two warnings', async () => {
      const { say, open, logger } = logged();
      const id = await open();
      await say(id, 'as Planner');
      await say(id, 'as Architect');
      const fields = { sessionId: id, profile: 'Architect', previous: 'Planner' };
      expect(dataOf(logger.entries, 'profile_reactivated')).toEqual([fields]);
      expect(dataOf(logger.entries, 'profile_switched')).toEqual([fields]);
   });

   it.each([
      ['@as Architect', 'Architect'], ['as td', 'TestDesigner'], ['@dr', 'Doctor'], ['@epr', 'Enforcer'],
      ['/dr', 'Doctor'], ['/epr', 'Enforcer'], ['/as td', 'TestDesigner'],
   ])('"%s" counts the same, with the canonical name %s', async (text, profile) => {
      const { say, open, logger } = logged();
      const id = await open();
      await say(id, 'as Planner');
      await say(id, text);
      const fields = { sessionId: id, profile, previous: 'Planner' };
      expect(dataOf(logger.entries, 'profile_reactivated')).toEqual([fields]);
      expect(dataOf(logger.entries, 'profile_switched')).toEqual([fields]);
   });

   it('the same profile typed in another case is a repeat, not a switch', async () => {
      const { say, open, logger } = logged();
      const id = await open();
      await say(id, 'as Planner');
      await say(id, 'AS planner');
      expect(dataOf(logger.entries, 'profile_reactivated')).toHaveLength(1);
      expect(dataOf(logger.entries, 'profile_switched')).toEqual([]);
   });

   it('[H] @start and @receive are expected switches', async () => {
      const { say, open, logger } = logged();
      changeover(HANDOFF_PATH, 'Planner', dirOf());
      changeover(MESSAGE_PATH, 'Doctor', dirOf());
      const id = await open();
      for (const text of ['@start', '@receive', '@start']) { await say(id, text); }
      expect(dataOf(logger.entries, 'profile_activated')).toEqual([
         { sessionId: id, profile: 'Planner', source: 'changeover' },
         { sessionId: id, profile: 'Doctor',  source: 'changeover' },
         { sessionId: id, profile: 'Planner', source: 'changeover' },
      ]);
      expect(eventsOf(logger, 'profile_activated').map(entry => entry.level))
         .toEqual(['info', 'info', 'info']);
      expect(profileWarns(logger.entries)).toEqual([]);
   });

   it('[H] a user activation after a changeover is a repeat', async () => {
      const { say, open, logger } = logged();
      changeover(HANDOFF_PATH, 'Planner', dirOf());
      const id = await open();
      await say(id, '@start');
      await say(id, 'as Doctor');
      const fields = { sessionId: id, profile: 'Doctor', previous: 'Planner' };
      expect(dataOf(logger.entries, 'profile_reactivated')).toEqual([fields]);
      expect(dataOf(logger.entries, 'profile_switched')).toEqual([fields]);
   });

   it('only an applied activation is logged as one', async () => {
      const driver   = createDriverSpy();
      const resolver = createResolverStub((_call, profile) =>
         'Planner' === profile ? new Error('no driver') : resolved(driver.name));
      const { say, open, logger } = logged({ driver, resolver });
      const id = await open();
      await say(id, 'as Nobody');
      await say(id, 'as Planner').catch(() => undefined);
      await say(id, '@start');
      for (const event of ['profile_reactivated', 'profile_switched', 'profile_activated']) {
         expect(eventsOf(logger, event)).toEqual([]);
      }
   });

   it('[H] an unknown name is logged as info, with the word as given', async () => {
      const { say, open, logger } = logged();
      const id = await open();
      await say(id, 'as Nobody and the rest of the line');
      expect(eventsOf(logger, 'profile_unknown').map(entry => ({ level: entry.level, ...entry.data })))
         .toEqual([{
            level: 'info', sessionId: id, source: 'prompt', reason: 'unknown name', word: 'Nobody',
         }]);
      expect(JSON.stringify(logger.entries)).not.toContain('rest of the line');
   });

   it('[H] an unknown name that looks like a secret is redacted', async () => {
      const token = 'a1b2c3d4e5'.repeat(4);
      const { say, open, logger } = logged();
      await say(await open(), `as ${token}`);
      const [entry] = eventsOf(logger, 'profile_unknown');
      expect(entry.data.word).not.toContain(token);
      expect(JSON.stringify(logger.entries)).not.toContain(token);
   });

   it('[H] an unknown name is cut to 64 characters', async () => {
      const { say, open, logger } = logged();
      await say(await open(), `as ${'x'.repeat(100)}`);
      expect(eventsOf(logger, 'profile_unknown')[0].data.word).toHaveLength(64);
   });

   it('the prompt text is never logged', async () => {
      const { say, open, logger } = logged();
      await say(await open(), 'as Planner password hunter2 do it');
      expect(JSON.stringify(logger.entries)).not.toContain('hunter2');
   });

   it.each([
      ['go'], ['as'], ['@asx'], ['please as Planner'],
      ['/etc/hosts'], ['/help'], ['@planner'], ['see /home/dr/notes'],
   ])('"%s" is not a command and logs nothing about a profile', async text => {
      const { say, open, logger } = logged();
      await say(await open(), text);
      expect(logger.entries.filter((entry: LogEntry) => entry.event.startsWith('profile_'))).toEqual([]);
   });
});
