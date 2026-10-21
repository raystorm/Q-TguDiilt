import { describe, it, expect } from 'vitest';
import { AgentRefusedError } from '../errors.js';
import type { UnsafeSetting } from '../types.js';
import { type FakeAgent, flush, makeDriver } from './acp-driver.helpers.js';
import { SESSION, failureOf } from './failures.helpers.js';

/** A switch with one unsafe value, and a mode whose unsafe value has two spellings. */
const SETTINGS: UnsafeSetting[] = [
   { name: 'blanket_approval', optionId: 'approval', values: ['on'] },
   { name: 'hands_off',        optionId: 'mode',     values: ['hands-off', 'urn:modes#hands-off'] },
];

const option = (id: string, currentValue: unknown, type = 'select') =>
   ({ id, name: id, type, currentValue, options: [] });
const SAFE   = [option('approval', 'off'), option('mode', 'urn:modes#normal')];

const sessionWith = (configOptions: unknown) => () => ({ sessionId: SESSION, configOptions });
const configUpdate = (configOptions: unknown, sessionId = SESSION) =>
   ({ sessionId, update: { sessionUpdate: 'config_option_update', configOptions } });
const said = (text: string) =>
   ({ sessionId: SESSION, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } });

const WARNING = /^Warning: .*blanket_approval/;

/** A driver whose agent starts with the safe values. `null` gives the driver no settings at all. */
function started(settings: UnsafeSetting[] | null = SETTINGS) {
   const made = makeDriver(1, undefined, undefined, settings ?? undefined);
   made.agents[0].respond('session/new', sessionWith(SAFE));
   return { ...made, agent: made.agents[0] };
}

/** The agent's next turn: it sends these notifications, says `text`, and ends the turn. */
function turnWith(agent: FakeAgent, updates: object[], text = 'hello') {
   agent.respond('session/prompt', async () => {
      for (const update of updates) { await agent.notify('session/update', update); }
      await agent.notify('session/update', said(text));
      return { stopReason: 'end_turn' };
   });
}

const changes = (logger: ReturnType<typeof started>['logger']) =>
   logger.warn.mock.calls.filter(([event]) => 'agent_setting_changed' === event).map(([, data]) => data);

describe('unsafe settings at session start', () => {
   it.each([
      ['a switch that is on',
         [option('approval', 'on'), option('mode', 'normal')], ['blanket_approval']],
      ['a mode in its first spelling',
         [option('approval', 'off'), option('mode', 'hands-off')], ['hands_off']],
      ['a mode in its second spelling',
         [option('approval', 'off'), option('mode', 'urn:modes#hands-off')], ['hands_off']],
      ['both',
         [option('approval', 'on'), option('mode', 'hands-off')], ['blanket_approval', 'hands_off']],
   ])('[H] the session is refused when it reports %s', async (_label, options, names) => {
      const { driver, agent } = started();
      agent.respond('session/new', sessionWith(options));
      const error = await failureOf(driver.execute('go'));
      expect(error).toBeInstanceOf(AgentRefusedError);
      names.forEach(name => expect(error?.message).toContain(name));
      expect(error?.message).toContain('cannot change');
      expect(agent.methods()).toEqual(['initialize', 'session/new']);
      expect(agent.stdinCloses).toBe(1);
      agent.exit(0);
   });

   it.each([
      ['the safe values',                      SAFE],
      ['no config options',                    undefined],
      ['config options that are not an array', 'none'],
      ['an option with another id',            [option('other', 'on')]],
      ['values that are not listed',           [option('approval', 'maybe'), option('mode', 'unknown')]],
      ['a value that is not a string',         [option('approval', true, 'boolean')]],
   ])('[H] the session is allowed with %s', async (_label, options) => {
      const { driver, agent } = started();
      agent.respond('session/new', sessionWith(options));
      await expect(driver.execute('go')).resolves.toMatchObject({ sessionId: SESSION });
      agent.exit(0);
   });

   it('[H] with no settings given nothing is checked, even when everything is on', async () => {
      const { driver, agent } = started(null);
      agent.respond('session/new', sessionWith([option('approval', 'on'), option('mode', 'hands-off')]));
      await expect(driver.execute('go')).resolves.toMatchObject({ sessionId: SESSION });
      agent.exit(0);
   });
});

describe('unsafe settings switched on during the session', () => {
   it('[H] the result starts with one warning paragraph, '
      + 'the agent\'s text follows unchanged, and the change is logged', async () => {
      const { driver, agent, logger } = started();
      turnWith(agent, [configUpdate([option('approval', 'on'), option('mode', 'urn:modes#normal')])]);
      const result = await driver.execute('go');
      expect(result.text.split('\n\n')).toEqual([expect.stringMatching(WARNING), 'hello']);
      expect(changes(logger)).toEqual([{ agentSessionId: SESSION, setting: 'blanket_approval' }]);
      turnWith(agent, [], 'next');
      await expect(driver.execute('more', { sessionId: SESSION })).resolves.toMatchObject({ text: 'next' });
      agent.exit(0);
   });

   it.each(['hands-off', 'urn:modes#hands-off'])('the mode value %s is a change too', async value => {
      const { driver, agent, logger } = started();
      turnWith(agent, [configUpdate([option('approval', 'off'), option('mode', value)])]);
      expect((await driver.execute('go')).text).toMatch(/^Warning: .*hands_off/);
      expect(changes(logger)).toEqual([{ agentSessionId: SESSION, setting: 'hands_off' }]);
      agent.exit(0);
   });

   it('[H] the warning comes once per change, not on every later turn', async () => {
      const { driver, agent, logger } = started();
      const on  = configUpdate([option('approval', 'on'),  option('mode', 'normal')]);
      const off = configUpdate([option('approval', 'off'), option('mode', 'normal')]);
      const texts: string[] = [];
      for (const updates of [[on], [on], [off], [on]]) {
         turnWith(agent, updates);
         texts.push((await driver.execute('go', { sessionId: 0 < texts.length ? SESSION : undefined })).text);
      }
      expect(texts.map(text => WARNING.test(text))).toEqual([true, false, false, true]);
      expect(changes(logger)).toHaveLength(2);
      agent.exit(0);
   });

   it('a change between turns is reported on the next turn', async () => {
      const { driver, agent, logger } = started();
      turnWith(agent, []);
      await driver.execute('go');
      await agent.notify('session/update', configUpdate([option('approval', 'on'), option('mode', 'normal')]));
      await flush();
      expect(changes(logger)).toHaveLength(1);
      turnWith(agent, []);
      expect((await driver.execute('again', { sessionId: SESSION })).text).toMatch(WARNING);
      agent.exit(0);
   });

   it('two settings switched on together give one paragraph naming both and one entry each', async () => {
      const { driver, agent, logger } = started();
      turnWith(agent, [configUpdate([option('approval', 'on'), option('mode', 'hands-off')])]);
      const parts = (await driver.execute('go')).text.split('\n\n');
      expect(parts).toHaveLength(2);
      expect(parts[0]).toContain('blanket_approval');
      expect(parts[0]).toContain('hands_off');
      expect(changes(logger).map((entry: any) => entry.setting)).toEqual(['blanket_approval', 'hands_off']);
      agent.exit(0);
   });

   it('updates that leave every setting safe change nothing', async () => {
      const { driver, agent, logger } = started();
      turnWith(agent, [configUpdate(SAFE), configUpdate([option('other', 'on')])]);
      expect((await driver.execute('go')).text).toBe('hello');
      expect(changes(logger)).toEqual([]);
      agent.exit(0);
   });

   it('an update for another session is ignored', async () => {
      const { driver, agent, logger } = started();
      turnWith(agent, [configUpdate([option('approval', 'on')], 'someone-else')]);
      expect((await driver.execute('go')).text).toBe('hello');
      expect(changes(logger)).toEqual([]);
      agent.exit(0);
   });

   it('with no settings given an update changes nothing', async () => {
      const { driver, agent, logger } = started(null);
      turnWith(agent, [configUpdate([option('approval', 'on')])]);
      expect((await driver.execute('go')).text).toBe('hello');
      expect(changes(logger)).toEqual([]);
      agent.exit(0);
   });

   it('the warning also leads the partial text of a cancelled turn', async () => {
      const { driver, agent } = started();
      const controller = new AbortController();
      agent.respond('session/prompt', async () => {
         await agent.notify('session/update', configUpdate([option('approval', 'on')]));
         await agent.notify('session/update', said('partial'));
         controller.abort();
         await agent.arrived('session/cancel');
         return { stopReason: 'cancelled' };
      });
      const result = await driver.execute('go', { signal: controller.signal });
      expect(result).toMatchObject({ cancelled: true });
      expect(result.text.split('\n\n')).toEqual([expect.stringMatching(WARNING), 'partial']);
      agent.exit(0);
   });

   it('a turn that fails loses the warning but not the log entry, and the failure is raised as usual', async () => {
      const { driver, agent, logger } = started();
      agent.respond('session/prompt', async () => {
         await agent.notify('session/update', configUpdate([option('approval', 'on')]));
         throw Object.assign(new Error('boom'), { code: -32603 });
      });
      const error = await failureOf(driver.execute('go'));
      expect(error?.message).toContain('boom');
      expect(changes(logger)).toEqual([{ agentSessionId: SESSION, setting: 'blanket_approval' }]);
      agent.exit(0);
   });
});
