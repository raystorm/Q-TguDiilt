import { describe, it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ModelUnavailableError } from '../../drivers/acp-driver-core/errors.js';
import { useTempDir, writeFile } from '../../drivers/__tests__/catalog-fixtures.js';
import type { DispatchResult } from '../../modelResolver/types.js';
import { SessionCollapseError } from '../errors.js';
import { HANDOFF_PATH, MESSAGE_PATH } from '../workflow-command.js';
import {
   catalogOf, changeover, createCx, createDriverSpy, createResolverStub, deferred, eventsOf, flush,
   makeAgent, newSessionArgs, resolved, watch,
} from './agent.helpers.js';

type Agent  = ReturnType<typeof makeAgent>['agent'];
type Result = DispatchResult | Error;

const dirOf = useTempDir();

const say = (agent: Agent, sessionId: string, ...texts: string[]) =>
   agent.prompt({ sessionId, prompt: texts.map(text => ({ type: 'text' as const, text })) }, createCx());

/**
 * Drivers "alpha" (first session id a-1) and "beta" (b-1). A profile resolves to what
 * `byProfile` says, or to alpha/m1; no profile resolves to alpha/m1.
 */
function setup(byProfile: Record<string, Result> = {}, results: { alpha?: any; beta?: any } = {})
{
   const alpha    = createDriverSpy(results.alpha ?? { text: 'a', sessionId: 'a-1' }, 'alpha');
   const beta     = createDriverSpy(results.beta  ?? { text: 'b', sessionId: 'b-1' }, 'beta');
   const resolver = createResolverStub((_call, profile) =>
      undefined === profile ? resolved('alpha', 'm1') : byProfile[profile] ?? resolved('alpha', 'm1'));
   const made   = makeAgent({ catalog: catalogOf({ alpha, beta }), resolver, workDir: dirOf() });
   const open   = async () => (await made.agent.newSession(newSessionArgs())).sessionId;
   const record = (sessionId: string) => made.sessionStore.get(sessionId)!;
   return { ...made, alpha, beta, open, record };
}

const toBeta = (model = 'm2') => ({ Planner: resolved('beta', model, 'profile') });
const END    = { stopReason: 'end_turn' };

describe('applying a found profile', () => {
   it('[H] the first prompt of a chat that starts with an activation uses the profile driver', async () => {
      const { agent, alpha, beta, resolver, open } = setup(toBeta());
      await say(agent, await open(), 'as Planner write it');
      expect(alpha.seen).toHaveLength(0);
      expect(beta.seen).toHaveLength(1);
      expect(beta.seen[0].command).toBe('as Planner write it');
      expect(beta.seen[0].options.model).toBe('m2');
      expect(beta.seen[0].options).not.toHaveProperty('sessionId');
      expect(resolver.calls).toEqual([undefined, 'Planner']);
   });

   it.each([
      ['as planner', 'Planner'], ['@AS po', 'Planner'], ['as STRATEGIST', 'Planner'],
      ['as Dr', 'Doctor'], ['@dr', 'Doctor'], ['@DR', 'Doctor'], ['as Medic', 'Doctor'],
      ['@epr', 'Enforcer'], ['as PE', 'PromptEngineer'],
   ])('[H] "%s" asks the resolver for the canonical name %s, once', async (text, profile) => {
      const { agent, resolver, open } = setup();
      await say(agent, await open(), text);
      expect(resolver.calls).toEqual([undefined, profile]);
   });

   it('the same driver and model change nothing', async () => {
      const { agent, alpha, open } = setup({ Planner: resolved('alpha', 'm1', 'profile') });
      const id = await open();
      await say(agent, id, 'go');
      await say(agent, id, 'as Planner go');
      expect(alpha.seen[1].options).toMatchObject({ sessionId: 'a-1', model: 'm1' });
      expect(alpha.released).toEqual([]);
   });

   it('the same driver, another model: the id is kept, the model changes', async () => {
      const { agent, alpha, open } = setup({ Planner: resolved('alpha', 'm2', 'profile') });
      const id = await open();
      await say(agent, id, 'go');
      await say(agent, id, 'as Planner go');
      await say(agent, id, 'again');
      expect(alpha.seen.slice(1).map(call => call.options))
         .toMatchObject([{ sessionId: 'a-1', model: 'm2' }, { sessionId: 'a-1', model: 'm2' }]);
      expect(alpha.released).toEqual([]);
   });

   it('[H] another driver: the id is dropped, the old session released, a new one started', async () => {
      const { agent, alpha, beta, record, open } = setup(toBeta());
      const id = await open();
      await say(agent, id, 'go');
      await say(agent, id, 'as Planner go');
      expect(alpha.released).toEqual(['a-1']);
      expect(beta.seen[0].options).not.toHaveProperty('sessionId');
      expect(beta.seen[0].options.model).toBe('m2');
      expect(record(id).driver).toBe('beta');
      await say(agent, id, 'again');
      expect(beta.seen[1].options.sessionId).toBe('b-1');
      expect(alpha.seen).toHaveLength(1);
   });

   it.each([[''], [undefined]])('[H] with the session id %j there is nothing to release', async sessionId => {
      const { agent, alpha, beta, open } = setup(toBeta(), { alpha: { text: 'a', sessionId } });
      const id = await open();
      await say(agent, id, 'go');
      await say(agent, id, 'as Planner go');
      expect(alpha.released).toEqual([]);
      expect(beta.seen).toHaveLength(1);
   });

   it.each([
      [new Error('boom SECRET-ERR'), 'internal'],
      [new SessionCollapseError('gone SECRET-ERR'), 'session_collapse'],
   ])('a release that fails does not fail the turn, and logs the kind only (%#)', async (error, kind) => {
      const { agent, alpha, beta, logger, open } = setup(toBeta());
      const id = await open();
      await say(agent, id, 'go');
      alpha.onRelease = async () => { throw error; };
      await expect(say(agent, id, 'as Planner go')).resolves.toEqual(END);
      expect(beta.seen[0].command).toBe('as Planner go');
      expect(eventsOf(logger, 'release_failed').map(entry => entry.data))
         .toEqual([{ sessionId: id, failureKind: kind }]);
      expect(JSON.stringify(logger.entries)).not.toContain('SECRET-ERR');
   });

   it('[H] a profile that cannot be resolved fails the turn and changes nothing', async () => {
      const error = new Error('no driver for Planner');
      const { agent, alpha, beta, sessionStore, record, open } = setup({ Planner: error });
      const id = await open();
      await say(agent, id, 'go');
      const before = { ...record(id) };
      await expect(say(agent, id, 'as Planner go')).rejects.toBe(error);
      expect(beta.seen).toHaveLength(0);
      expect(alpha.seen).toHaveLength(1);
      expect(alpha.released).toEqual([]);
      expect(record(id)).toEqual(before);
      expect(sessionStore.hasActiveTurn(id)).toBe(false);
      await say(agent, id, 'again');
      expect(alpha.seen[1].options.sessionId).toBe('a-1');
   });

   it('[H] a model the agent does not offer fails the turn, and the session keeps the choice', async () => {
      const beta = (_command: string, options: any) => {
         if ('m2' === options.model) { throw new ModelUnavailableError('m2'); }
         return { text: 'b', sessionId: 'b-1' };
      };
      const { agent, beta: spy, record, open } = setup(
         { ...toBeta(), Architect: resolved('beta', 'm1', 'profile') }, { beta },
      );
      const id = await open();
      await expect(say(agent, id, 'as Planner go')).rejects.toBeInstanceOf(ModelUnavailableError);
      expect(record(id).model).toBe('m2');
      await expect(say(agent, id, 'again')).rejects.toBeInstanceOf(ModelUnavailableError);
      await expect(say(agent, id, 'as Architect')).resolves.toEqual(END);
      expect(spy.seen.map(call => call.options.model)).toEqual(['m2', 'm2', 'm1']);
   });

   it.each([
      ['go'], ['as Nobody'], ['as'], ['@asx'], ['please as Planner'],
      ['/etc/hosts'], ['/help'], ['@planner'], ['see /home/dr/notes'],
   ])('text that is not an activation changes nothing: "%s"', async text => {
      const { agent, alpha, resolver, record, open } = setup(toBeta());
      const id = await open();
      await say(agent, id, text);
      expect(resolver.calls).toEqual([undefined]);
      expect(record(id)).toMatchObject({ driver: 'alpha', model: 'm1' });
      expect(record(id).profile).toBeUndefined();
      expect(alpha.seen[0].command).toBe(text);
   });

   it('[H] the activation must start the whole text, however it is split into blocks', async () => {
      const { agent, resolver, open } = setup();
      await say(agent, await open(), 'as Planner', 'do it');
      expect(resolver.calls).toEqual([undefined, 'Planner']);
      await say(agent, await open(), 'hello', 'as Planner');
      expect(resolver.calls).toEqual([undefined, 'Planner', undefined]);
      await say(agent, await open(), 'hello', '@dr');
      expect(resolver.calls.slice(3)).toEqual([undefined, 'Doctor']);
   });

   it('the record keeps the canonical profile', async () => {
      const { agent, record, open } = setup({ Architect: new Error('no driver') });
      const id = await open();
      await say(agent, id, 'as po go');
      expect(record(id).profile).toBe('Planner');
      await say(agent, id, 'as Nobody');
      expect(record(id).profile).toBe('Planner');
      await say(agent, id, 'as Architect').catch(() => undefined);
      expect(record(id).profile).toBe('Planner');
   });

   it('a reopened chat has no profile until the next activation', async () => {
      const { agent, record, resolver } = setup();
      await agent.loadSession({ sessionId: 'sess-prev', workflowId: 'wf-prev' });
      await say(agent, 'sess-prev', 'go');
      expect(resolver.calls).toEqual([undefined]);
      expect(record('sess-prev').profile).toBeUndefined();
      await say(agent, 'sess-prev', 'as Planner go');
      expect(record('sess-prev').profile).toBe('Planner');
   });

   it('sessions are independent', async () => {
      const { agent, alpha, beta, record, open } = setup(toBeta());
      const first  = await open();
      const second = await open();
      await say(agent, first, 'as Planner go');
      await say(agent, second, 'go');
      expect(beta.seen).toHaveLength(1);
      expect(alpha.seen).toHaveLength(1);
      expect([record(first).profile, record(second).profile]).toEqual(['Planner', undefined]);
   });
});

describe('changeover commands', () => {
   it('@start takes the profile from HANDOFF.md', async () => {
      const { agent, beta, resolver, record, open } = setup(toBeta());
      changeover(HANDOFF_PATH, 'Planner', dirOf());
      const id = await open();
      await say(agent, id, '@start');
      expect(resolver.calls).toEqual([undefined, 'Planner']);
      expect(beta.seen[0].command).toBe('@start');
      expect(record(id).profile).toBe('Planner');
   });

   it('@receive takes the profile from MESSAGE.md', async () => {
      const { agent, resolver, open } = setup();
      changeover(MESSAGE_PATH, 'Doctor', dirOf());
      await say(agent, await open(), '@receive');
      expect(resolver.calls).toEqual([undefined, 'Doctor']);
   });

   it('[H] each command reads its own file', async () => {
      const { agent, resolver, open } = setup();
      changeover(HANDOFF_PATH, 'Planner', dirOf());
      changeover(MESSAGE_PATH, 'Doctor', dirOf());
      const id = await open();
      await say(agent, id, '@start');
      await say(agent, id, '@receive');
      expect(resolver.calls).toEqual([undefined, 'Planner', 'Doctor']);
   });

   it('the name in the file may be an alias in any case', async () => {
      const { agent, resolver, open } = setup();
      const id = await open();
      for (const name of ['po', 'PE', 'planner']) {
         changeover(HANDOFF_PATH, name, dirOf());
         await say(agent, id, '@start');
      }
      expect(resolver.calls.slice(1)).toEqual(['Planner', 'PromptEngineer', 'Planner']);
   });

   it('[H] a first prompt @start resolves before any process', async () => {
      const { agent, alpha, beta, open } = setup(toBeta());
      changeover(HANDOFF_PATH, 'Planner', dirOf());
      await say(agent, await open(), '@start');
      expect(alpha.seen).toHaveLength(0);
      expect(beta.seen).toHaveLength(1);
      expect(beta.seen[0].options.model).toBe('m2');
      expect(beta.seen[0].options).not.toHaveProperty('sessionId');
   });

   const handoffFile = (text: string) => writeFile(join(dirOf(), HANDOFF_PATH), text);

   it.each([
      ['no file',                      () => undefined,                                 'no target'],
      ['a folder named HANDOFF.md',    () => mkdirSync(join(dirOf(), HANDOFF_PATH), { recursive: true }),
                                                                                        'no target'],
      ['an empty file',                () => handoffFile(''),                           'no target'],
      ['no ## To heading',             () => handoffFile('## From\nBuilder\n'),         'no target'],
      ['nothing under ## To',          () => handoffFile('## To\n\n## From\nBuilder\n'), 'no target'],
      ['a name that is not a profile', () => changeover(HANDOFF_PATH, 'Nobody', dirOf()), 'unknown name'],
   ])('[H] %s leaves the session as it is', async (_what, prepare, reason) => {
      const { agent, alpha, logger, resolver, record, open } = setup(toBeta());
      const id = await open();
      await say(agent, id, 'go');
      prepare();
      const before = { ...record(id) };
      await expect(say(agent, id, '@start')).resolves.toEqual(END);
      expect(resolver.calls).toEqual([undefined]);
      expect(record(id)).toEqual(before);
      expect(alpha.seen[1]).toMatchObject({ command: '@start', options: { sessionId: 'a-1' } });
      const unknown = eventsOf(logger, 'profile_unknown');
      expect(unknown).toHaveLength(1);
      expect(unknown[0]).toMatchObject({
         level: 'info', data: { sessionId: id, source: 'changeover', reason },
      });
   });

   it('[H] the file is read when the command is sent', async () => {
      const { agent, resolver, open } = setup();
      const id = await open();
      await say(agent, id, '@start');
      changeover(HANDOFF_PATH, 'Planner', dirOf());
      await say(agent, id, '@start');
      changeover(HANDOFF_PATH, 'Doctor', dirOf());
      await say(agent, id, '@start');
      expect(resolver.calls).toEqual([undefined, 'Planner', 'Doctor']);
   });

   it('[H] only the working directory given to the service is read', async () => {
      const { agent, resolver, open } = setup();
      changeover(HANDOFF_PATH, 'Planner', join(dirOf(), 'elsewhere'));
      await say(agent, await open(), '@start');
      expect(resolver.calls).toEqual([undefined]);
   });

   it.each([
      ['see @start now', 'Planner'], ['see /start now', 'Planner'],
      ['/start', 'Planner'], ['/receive', 'Doctor'],
   ])('"%s" reads the file of the command, anywhere in the text', async (text, profile) => {
      const { agent, alpha, resolver, open } = setup();
      changeover(HANDOFF_PATH, 'Planner', dirOf());
      changeover(MESSAGE_PATH, 'Doctor', dirOf());
      await say(agent, await open(), text);
      expect(resolver.calls).toEqual([undefined, profile]);
      expect(alpha.seen[0].command).toBe(text);
   });
});

describe('one step per command', () => {
   /** A session whose record is on alpha with the continuity id a-1, and no turn running. */
   async function onAlpha(byProfile: Record<string, Result> = toBeta())
   {
      const made = setup(byProfile);
      const id   = await made.open();
      made.record(id).driverSessionId = 'a-1';
      return { ...made, id, rec: made.record(id) };
   }

   it('[H] the step does the same work called directly as through a prompt', async () => {
      const { agent, alpha, logger, resolver, rec } = await onAlpha();
      changeover(HANDOFF_PATH, 'Planner', dirOf());
      await agent.applyActivation(rec, '@start');
      expect(rec).toMatchObject({ driver: 'beta', model: 'm2', profile: 'Planner' });
      expect(rec.driverSessionId).toBeUndefined();
      expect(alpha.released).toEqual(['a-1']);
      expect(resolver.calls).toEqual([undefined, 'Planner']);
      expect(eventsOf(logger, 'profile_activated').map(entry => entry.data))
         .toEqual([{ sessionId: rec.sessionId, profile: 'Planner', source: 'changeover' }]);
   });

   it('[H] commands in a row on one record', async () => {
      const { agent, logger, resolver, rec } = await onAlpha({});
      await agent.applyActivation(rec, 'as Planner');
      changeover(HANDOFF_PATH, 'Doctor', dirOf());
      await agent.applyActivation(rec, '@start');
      const settled = { ...rec, logged: logger.entries.length };
      await agent.applyActivation(rec, '@handoff to=Planner');
      expect({ ...rec, logged: logger.entries.length }).toEqual(settled);
      changeover(HANDOFF_PATH, 'Planner', dirOf());
      await agent.applyActivation(rec, '@start');
      expect(resolver.calls).toEqual([undefined, 'Planner', 'Doctor', 'Planner']);
      expect(rec.profile).toBe('Planner');
   });

   it.each([['@handoff to=Planner'], ['go'], ['@note x']])('"%s" does nothing', async text => {
      const { agent, logger, resolver, rec } = await onAlpha();
      changeover(HANDOFF_PATH, 'Planner', dirOf());
      const before = { ...rec, logged: logger.entries.length };
      await agent.applyActivation(rec, text);
      expect(resolver.calls).toEqual([undefined]);
      expect({ ...rec, logged: logger.entries.length }).toEqual(before);
   });

   it('the step leaves the active-turn flag alone', async () => {
      const { agent, sessionStore, open, record } = setup(toBeta());
      const [busy, idle] = [await open(), await open()];
      sessionStore.setActiveTurn(busy, true);
      for (const id of [busy, idle]) { await agent.applyActivation(record(id), 'as Planner'); }
      expect([sessionStore.hasActiveTurn(busy), sessionStore.hasActiveTurn(idle)]).toEqual([true, false]);
      expect([record(busy).driver, record(idle).driver]).toEqual(['beta', 'beta']);
   });

   it('the step finishes only after the release has', async () => {
      const { agent, alpha, rec } = await onAlpha();
      const hold = deferred();
      alpha.onRelease = () => hold.promise;
      const step = watch(agent.applyActivation(rec, 'as Planner'));
      await flush();
      expect(step.done).toBe(false);
      hold.resolve();
      await flush();
      expect(step.done).toBe(true);
   });

   it('[H] a driver change leaves no old id behind', async () => {
      const { agent, beta, id, rec } = await onAlpha();
      await agent.applyActivation(rec, 'as Planner');
      await say(agent, id, 'go');
      expect(beta.seen[0].options).not.toHaveProperty('sessionId');
   });
});
