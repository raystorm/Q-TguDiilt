import { describe, it, expect, vi } from 'vitest';
import { DriverGovernanceUnsupportedError } from '../errors.js';
import { DriverNotInCatalogError } from '../../drivers/errors.js';
import {
   catalogOf, createCx, createDriverSpy, createResolverStub, makeAgent, newSessionArgs, resolved,
   textParam, twoDrivers,
} from './agent.helpers.js';

type Agent = ReturnType<typeof makeAgent>['agent'];

const prompt = (agent: Agent, sessionId: string, text = 'go') =>
   agent.prompt({ sessionId, ...textParam(text) }, createCx());

const open = async (agent: Agent) => (await agent.newSession(newSessionArgs())).sessionId;

describe('dispatch once per session', () => {
   it('a new session is resolved once, and its prompt goes to that driver and model', async () => {
      const { agent, alpha, beta } = twoDrivers(['alpha', 'm1']);
      await prompt(agent, await open(agent));
      expect(alpha.seen).toHaveLength(1);
      expect(alpha.seen[0].options.model).toBe('m1');
      expect(beta.seen).toHaveLength(0);
   });

   it('the resolution takes no profile', async () => {
      const { agent, resolver } = twoDrivers(['alpha', 'm1']);
      await open(agent);
      expect(resolver.calls).toEqual([undefined]);
   });

   it('prompts do not resolve again, even when the answer would change', async () => {
      const { agent, alpha, beta, resolver } = twoDrivers(['alpha', 'm1'], ['beta', 'm1']);
      const sessionId = await open(agent);
      for (const text of ['one', 'two', 'three']) { await prompt(agent, sessionId, text); }
      expect(alpha.seen).toHaveLength(3);
      expect(beta.seen).toHaveLength(0);
      expect(resolver.calls).toHaveLength(1);
   });

   it('sessions are resolved independently', async () => {
      const { agent, alpha, beta } = twoDrivers(['alpha', 'm1'], ['beta', 'm3']);
      const first  = await open(agent);
      const second = await open(agent);
      await prompt(agent, first);
      await prompt(agent, second);
      expect(alpha.seen.map(call => call.options.model)).toEqual(['m1']);
      expect(beta.seen.map(call => call.options.model)).toEqual(['m3']);
   });

   it.each(['m1', 'auto'])('the resolved model "%s" reaches the driver', async model => {
      const { agent, alpha } = twoDrivers(['alpha', model]);
      await prompt(agent, await open(agent));
      expect(alpha.seen[0].options.model).toBe(model);
   });

   it('a loaded session is resolved the same way, with no continuity id at first', async () => {
      const { agent, beta, resolver } = twoDrivers(['beta', 'm3']);
      await agent.loadSession({ sessionId: 'sess-prev', workflowId: 'wf-prev' });
      expect(resolver.calls).toEqual([undefined]);
      await prompt(agent, 'sess-prev');
      expect(beta.seen[0].options.model).toBe('m3');
      expect(beta.seen[0].options).not.toHaveProperty('sessionId');
   });

   it('the continuity id stays with the driver that issued it', async () => {
      const { agent, alpha, beta } = twoDrivers(['alpha', 'm1'], ['beta', 'm1']);
      const a = await open(agent);
      const b = await open(agent);
      for (const id of [a, b, a, b]) { await prompt(agent, id); }
      expect(alpha.seen.map(call => call.options.sessionId)).toEqual([undefined, 'a-1']);
      expect(beta.seen.map(call => call.options.sessionId)).toEqual([undefined, 'b-1']);
   });

   it('the governance check runs on the driver of the session', async () => {
      const plain = Object.assign(createDriverSpy({ text: 'p', sessionId: 'p-1' }, 'plain'),
                                  { supportsToolCallGovernance: false });
      const alpha = createDriverSpy({ text: 'a', sessionId: 'a-1' }, 'alpha');
      const resolver = createResolverStub(call => resolved(0 === call ? 'plain' : 'alpha'));
      const { agent } = makeAgent({ catalog: catalogOf({ alpha, plain }), resolver });
      const refused = await open(agent);
      const served  = await open(agent);
      await expect(prompt(agent, refused)).rejects.toBeInstanceOf(DriverGovernanceUnsupportedError);
      await expect(prompt(agent, served)).resolves.toEqual({ stopReason: 'end_turn' });
      expect(plain.seen).toHaveLength(0);
      expect(alpha.seen).toHaveLength(1);
   });
});

describe('a resolution or catalog failure', () => {
   const alpha = () => createDriverSpy({ text: 'a', sessionId: 'a-1' }, 'alpha');

   it('a failed resolution when a session opens rejects, leaves no record, and the next one works', async () => {
      const error    = new Error('no driver');
      const resolver = createResolverStub(call => (0 === call ? error : resolved('alpha')));
      const { agent, sessionStore } = makeAgent({ catalog: catalogOf({ alpha: alpha() }), resolver });
      const create = vi.spyOn(sessionStore, 'create');
      await expect(agent.newSession(newSessionArgs())).rejects.toBe(error);
      expect(create).not.toHaveBeenCalled();
      const next = await agent.newSession(newSessionArgs());
      expect(sessionStore.get(next.sessionId)).toBeDefined();
   });

   it('a failed resolution when a session is loaded rejects and leaves no record', async () => {
      const error    = new Error('no driver');
      const resolver = createResolverStub(() => error);
      const { agent, sessionStore } = makeAgent({ catalog: catalogOf({ alpha: alpha() }), resolver });
      await expect(agent.loadSession({ sessionId: 'sess-prev', workflowId: 'wf-prev' }))
         .rejects.toBe(error);
      expect(sessionStore.get('sess-prev')).toBeUndefined();
   });

   it('a driver the catalog does not hold rejects the prompt and leaves the session free', async () => {
      const resolver = createResolverStub(() => resolved('gamma'));
      const { agent, sessionStore } = makeAgent({ catalog: catalogOf({ alpha: alpha() }), resolver });
      const sessionId = await open(agent);
      await expect(prompt(agent, sessionId)).rejects.toBeInstanceOf(DriverNotInCatalogError);
      await expect(prompt(agent, sessionId)).rejects.toThrow('gamma');
      expect(sessionStore.hasActiveTurn(sessionId)).toBe(false);
   });
});
