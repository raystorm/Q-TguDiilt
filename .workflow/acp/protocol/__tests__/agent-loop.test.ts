import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { call, end, say, update } from '../../drivers/__tests__/fake-governed-driver.js';
import { useTempDir } from '../../drivers/__tests__/catalog-fixtures.js';
import { sent } from '../../drivers/acp-driver-core/__tests__/acp-driver.helpers.js';
import { ProfileError, TurnInProgressError } from '../errors.js';
import {
   type LoopRig as Rig, act, agentSays, allOnAlpha as ALL_ON_ALPHA, cardIds, createCx,
   createResolverStub, eventsOf, flush, handoffFile, handoffTurn as writes, holdRelease, loopRig,
   loopRoutes as ROUTES, newSessionArgs, nextLine as next, openChat as open, overRealCore,
   plannerToEnforcer as scriptPlannerToEnforcer, readReport, resolved, scriptChain,
   readyFile, sendPrompt as send, suggests, textParam, textsIn, throws, updatesOf, wait,
} from './agent.helpers.js';

const dirOf = useTempDir();

const makeRig = (routes = ROUTES) => loopRig({ routes, dir: dirOf() });

describe('the changeover loop: steps', () => {
   it('carries a workflow from one profile to the next inside one prompt', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      alpha.script([act(() => rig.writeStatus('Planner', 'Enforcer')), say(`Done.\n\n${next('Enforcer')}`)],
         { sessionId: 'p-1' });
      alpha.script(writes(rig, 'Enforcer'), { sessionId: 'p-1' });
      beta.script([say('Reviewed.')], { sessionId: 'e-1' });

      const response = await send(rig, await open(rig), 'as Planner go');

      expect(rig.commands).toEqual(['as Planner go', '@handoff to=Enforcer', '@start']);
      expect(response).toEqual({ stopReason: 'end_turn' });
      expect(alpha.seen[1].options).toMatchObject({ sessionId: 'p-1', model: 'm1' });
      expect(beta.seen[0].options.model).toBe('m2');
      expect(beta.seen[0].options.sessionId).toBeUndefined();
   });

   it('[H] a chain of four profiles needs no state between hops', async () => {
      const names = ['Planner', 'PromptEngineer', 'Architect', 'Doctor'];
      const rig   = makeRig(ALL_ON_ALPHA);
      scriptChain(rig, 'alpha', names);

      const response = await send(rig, await open(rig), 'as Planner go');

      expect(rig.commands).toEqual([
         'as Planner go',
         '@handoff to=PromptEngineer', '@start',
         '@handoff to=Architect',      '@start',
         '@handoff to=Doctor',         '@start',
      ]);
      expect(response).toEqual({ stopReason: 'end_turn' });
   });

   it('[H] the loop runs after any turn that ended normally, follow-ups included', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      alpha.script([say('Planner is done.')]);
      alpha.script([act(() => rig.writeStatus('Planner', 'Enforcer')), say(`Answer.\n\n${next('Enforcer')}`)]);
      alpha.script(writes(rig, 'Enforcer'));
      beta.script([say('Reviewed.')]);
      beta.script([say('A follow-up answer with no completion line.')]);
      const sessionId = await open(rig);

      await send(rig, sessionId, 'as Planner go');
      expect(rig.commands).toEqual(['as Planner go']);

      await send(rig, sessionId, 'what comes next?');
      expect(rig.commands.slice(1)).toEqual(['what comes next?', '@handoff to=Enforcer', '@start']);

      await send(rig, sessionId, 'one more question');
      expect(rig.commands.slice(4)).toEqual(['one more question']);
   });

   it('[H] a typed handoff after a stop resumes the loop, confirmation and handoff in one prompt', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      alpha.script([say('Pick one.\n\n**Next**: `@handoff to=Enforcer` or `@handoff to=Architect`')]);
      alpha.script(writes(rig, 'Planner'));
      alpha.script([
         act(() => rig.writeStatus('Planner', 'Enforcer')), say(`Planner again.\n\n${next('Enforcer')}`),
      ]);
      alpha.script(writes(rig, 'Enforcer'));
      beta.script([say('Reviewed.')]);
      const sessionId = await open(rig);
      await send(rig, sessionId, 'as Planner go');
      expect(rig.commands).toEqual(['as Planner go']);

      await send(rig, sessionId, 'yes, confirmed. @handoff to=Planner');

      expect(rig.commands.slice(1)).toEqual([
         'yes, confirmed. @handoff to=Planner', '@start', '@handoff to=Enforcer', '@start',
      ]);
   });

   it.each(['missing', 'stale'])('[H] a typed handoff whose file is %s stops', async kind => {
      const rig = makeRig();
      if ('stale' === kind) { rig.writeHandoff('Planner', -60_000); }
      rig.scripted.alpha.script([say('Done.')]);

      const response = await send(rig, await open(rig), '@handoff to=Planner');

      expect(rig.commands).toEqual(['@handoff to=Planner']);
      expect(response).toEqual({ stopReason: 'end_turn' });
   });

   it('the file decides the profile, not the typed text', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      alpha.script(writes(rig, 'Enforcer'));
      beta.script([say('Reviewed.')]);

      await send(rig, await open(rig), '@handoff to=Planner');

      expect(rig.commands).toEqual(['@handoff to=Planner', '@start']);
      expect(beta.seen[0].options.model).toBe('m2');
   });

   it('[H] a typed question that mentions the handoff stops harmlessly', async () => {
      const rig  = makeRig();
      const file = rig.writeHandoff('Planner', -60_000);
      const text = readFileSync(file, 'utf8');
      rig.scripted.alpha.script([say('It hands work to another profile.')]);

      const response = await send(rig, await open(rig), 'what does @handoff do?');

      expect(rig.commands).toEqual(['what does @handoff do?']);
      expect(response).toEqual({ stopReason: 'end_turn' });
      expect(readFileSync(file, 'utf8')).toBe(text);
   });

   // profile that suggests, profile it suggests
   const FOLLOWED: Array<[string, string]> = [
      ['Enforcer', 'PromptEngineer'], ['Planner', 'Planner'], ['Doctor', 'Planner'],
   ];

   it.each(FOLLOWED)('[H] %s suggesting %s is followed', async (from, to) => {
      const rig = makeRig(ALL_ON_ALPHA);
      const { alpha } = rig.scripted;
      alpha.script(suggests(rig, from, to));
      alpha.script(writes(rig, to));
      alpha.script([say('Done.')]);

      await send(rig, await open(rig), `as ${from} go`);

      expect(rig.commands).toEqual([`as ${from} go`, `@handoff to=${to}`, '@start']);
   });

   it('[H] the text of the handoff turn is not read', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      alpha.script([
         act(() => rig.writeHandoff('Enforcer')),
         say('Created.\n\n**Next**: Open a new tab and run `@start` (or `@handoff to=Doctor`)'),
      ]);
      beta.script([say('Reviewed.')]);

      await send(rig, await open(rig), 'as Planner go');

      expect(rig.commands).toEqual(['as Planner go', '@handoff to=Enforcer', '@start']);
   });

   it('after the start turn the next step comes from the completion line', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      alpha.script(writes(rig, 'Enforcer'));
      beta.script([act(() => rig.writeStatus('Enforcer', 'Architect')), say(`Reviewed.\n\n${next('Architect')}`)]);
      beta.script(writes(rig, 'Architect'));
      alpha.script([say('Built.')]);

      await send(rig, await open(rig), 'as Planner go');

      expect(rig.commands).toEqual([
         'as Planner go', '@handoff to=Enforcer', '@start', '@handoff to=Architect', '@start',
      ]);
   });

   it('a typed start joins the loop', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      rig.writeHandoff('Planner');
      alpha.script([
         act(() => rig.writeStatus('Planner', 'Enforcer')), say(`Planner starts.\n\n${next('Enforcer')}`),
      ], { sessionId: 'p-1' });
      alpha.script(writes(rig, 'Enforcer'));
      beta.script([say('Reviewed.')]);

      await send(rig, await open(rig), '@start');

      expect(rig.commands).toEqual(['@start', '@handoff to=Enforcer', '@start']);
      expect(alpha.seen[1].options.sessionId).toBe('p-1');
   });

   // reply, what the agent suggested
   const STOPPING_REPLIES: Array<[string, string]> = [
      ['several suggestions', '**Next**: `@handoff to=Planner` or `@handoff to=Enforcer`'],
      ['no target',           '**Next**: Run `@handoff`'],
      ['an unknown profile',  '**Next**: Run `@handoff to=Nobody`'],
   ];

   it.each(STOPPING_REPLIES)('a reply with %s sends nothing more', async (_label, reply) => {
      const rig = makeRig();
      rig.scripted.alpha.script([say(`Done.\n\n${reply}`)]);

      const response = await send(rig, await open(rig), 'as Planner go');

      expect(rig.commands).toEqual(['as Planner go']);
      expect(response).toEqual({ stopReason: 'end_turn' });
   });

   it('each command reaches the provider as plain text, and the chat shows it as its own line', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      const cx  = createCx();
      alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      alpha.script(writes(rig, 'Enforcer'));
      beta.script([say('Reviewed.')]);

      await send(rig, await open(rig), 'as Planner go', cx);

      expect(rig.commands).toEqual(['as Planner go', '@handoff to=Enforcer', '@start']);
      const lines = textsIn(cx).map(text => text.trim()).filter(text => text.startsWith('Changeover:'));
      expect(lines).toEqual([
         'Changeover: sending `@handoff to=Enforcer`', 'Changeover: sending `@start`',
      ]);
   });

   it('the name sent is the canonical one', async () => {
      const rig = makeRig(ALL_ON_ALPHA);
      const { alpha } = rig.scripted;
      alpha.script([act(() => rig.writeStatus('Planner', 'PromptEngineer')), say(next('pe'))]);
      alpha.script(writes(rig, 'PromptEngineer'));
      alpha.script([say('Done.')]);

      await send(rig, await open(rig), 'as Planner go');

      expect(rig.commands).toEqual(['as Planner go', '@handoff to=PromptEngineer', '@start']);
   });
});

describe('the changeover loop: a fresh session for every start', () => {
   it('[H] on the same driver the old session is released and its id dropped', async () => {
      const rig = makeRig(ALL_ON_ALPHA);
      const { alpha } = rig.scripted;
      scriptPlannerToEnforcer(rig, 'alpha');
      alpha.script([say('Again.')]);
      const sessionId = await open(rig);

      await send(rig, sessionId, 'as Planner go');

      expect(alpha.released).toEqual(['p-1']);
      expect(alpha.seen[2].options.sessionId).toBeUndefined();
      expect(eventsOf(rig.logger, 'agent_session_linked').map(entry => entry.data.agentSessionId))
         .toContain('e-1');
      await send(rig, sessionId, 'and now?');
      expect(alpha.seen[3].options.sessionId).toBe('e-1');
   });

   it('[H] on another driver the old session is released once', async () => {
      const rig = makeRig();
      scriptPlannerToEnforcer(rig, 'beta');

      await send(rig, await open(rig), 'as Planner go');

      expect(rig.scripted.alpha.released).toEqual(['p-1']);
      expect(rig.scripted.beta.released).toEqual([]);
      expect(rig.scripted.beta.seen[0].options.sessionId).toBeUndefined();
   });

   it('[H] the release is awaited before the start is sent', async () => {
      const rig = makeRig();
      scriptPlannerToEnforcer(rig, 'beta');
      const { reached, hold } = holdRelease(rig);

      const turn = send(rig, await open(rig), 'as Planner go');
      await reached;
      await flush();
      expect(rig.scripted.beta.seen).toHaveLength(0);

      hold.resolve();
      await turn;
      expect(rig.scripted.beta.seen).toHaveLength(1);
   });

   it('[H] a failed release is logged by kind only and the hop goes on', async () => {
      const rig = makeRig();
      scriptPlannerToEnforcer(rig, 'beta');
      rig.scripted.alpha.onRelease = async () => { throw new Error('SECRET-ERR'); };

      await send(rig, await open(rig), 'as Planner go');

      expect(rig.commands.at(-1)).toBe('@start');
      expect(eventsOf(rig.logger, 'release_failed')).toHaveLength(1);
      expect(JSON.stringify(rig.logger.entries)).not.toContain('SECRET-ERR');
   });

   it('the start carries only the changeover file', async () => {
      const rig = makeRig();
      scriptPlannerToEnforcer(rig, 'beta');

      await send(rig, await open(rig), 'as Planner go');

      const { command, options } = rig.scripted.beta.seen[0];
      expect(command).toBe('@start');
      expect(options).not.toHaveProperty('sessionId');
      expect(options).not.toHaveProperty('context');
      expect(options.model).toBe('m2');
   });

   it('[H] a profile that cannot be resolved keeps the old session and releases nothing', async () => {
      const resolver = createResolverStub((_call, profile) => 'Enforcer' === profile
         ? new ProfileError('profile "Enforcer": it has no entry') : resolved('alpha', 'm1'));
      const rig = loopRig({ routes: { Planner: ['alpha', 'm1'] }, dir: dirOf(), resolver });
      const { alpha } = rig.scripted;
      alpha.script(suggests(rig, 'Planner', 'Enforcer'), { sessionId: 'p-1' });
      alpha.script(writes(rig, 'Enforcer'), { sessionId: 'p-1' });
      alpha.script([say('Still here.')]);
      const sessionId = await open(rig);

      await expect(send(rig, sessionId, 'as Planner go')).rejects.toThrow(/^profile "Enforcer": /);

      expect(alpha.released).toEqual([]);
      expect(rig.commands).toEqual(['as Planner go', '@handoff to=Enforcer']);
      expect(rig.sessionStore.get(sessionId)).toMatchObject({
         driver: 'alpha', model: 'm1', profile: 'Planner', driverSessionId: 'p-1',
      });
      await send(rig, sessionId, 'and now?');
      expect(alpha.seen[2].options).toMatchObject({ sessionId: 'p-1', model: 'm1' });
   });

   it('a handoff to the same profile still starts a fresh session', async () => {
      const rig = makeRig();
      const { alpha } = rig.scripted;
      alpha.script(suggests(rig, 'Planner', 'Planner'), { sessionId: 'p-1' });
      alpha.script(writes(rig, 'Planner'), { sessionId: 'p-1' });
      alpha.script([say('Again.')], { sessionId: 'p-2' });

      await send(rig, await open(rig), 'as Planner go');

      expect(alpha.released).toEqual(['p-1']);
      expect(alpha.seen[2].options.sessionId).toBeUndefined();
   });

   it('an empty session id is not released', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      alpha.script(suggests(rig, 'Planner', 'Enforcer'), { sessionId: '' });
      alpha.script(writes(rig, 'Enforcer'), { sessionId: '' });
      beta.script([say('Reviewed.')]);

      await send(rig, await open(rig), 'as Planner go');

      expect(alpha.released).toEqual([]);
      expect(rig.commands.at(-1)).toBe('@start');
   });
});

describe('the changeover loop: one activation step for every command', () => {
   it('[H] the handoff turn activates nothing', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      const sessionId = await open(rig);
      let during: object | undefined;
      alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      alpha.script([
         act(() => {
            during = { calls: [...rig.resolver.calls], profile: rig.sessionStore.get(sessionId)?.profile };
         }),
         ...writes(rig, 'Enforcer'),
      ]);
      beta.script([say('Reviewed.')]);

      await send(rig, sessionId, 'as Planner go');

      expect(during).toEqual({ calls: [undefined, 'Planner'], profile: 'Planner' });
   });

   it('[H] the start is resolved once, from the file, with the canonical name', async () => {
      const rig = makeRig();
      rig.scripted.alpha.script(writes(rig, 'dr'));
      rig.scripted.beta.script([say('Diagnosed.')]);
      const sessionId = await open(rig);

      await send(rig, sessionId, '@handoff');

      expect(rig.resolver.calls).toEqual([undefined, 'Doctor']);
      expect(rig.sessionStore.get(sessionId))
         .toMatchObject({ driver: 'beta', model: 'm2', profile: 'Doctor' });
   });

   // A substitution for Enforcer, so the start turn has a notice.
   const noticeRig = () => {
      const resolver = createResolverStub((_call, profile) => 'Enforcer' === profile
         ? resolved('beta', 'm2', 'registry-default', {
            asked: { model: 'NOTICE-MODEL' }, reason: 'model not listed',
         })
         : resolved('alpha', 'm1'));
      const rig = loopRig({ routes: { Planner: 'alpha', Enforcer: 'beta' }, dir: dirOf(), resolver });
      rig.scripted.alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      rig.scripted.alpha.script(writes(rig, 'Enforcer'));
      return rig;
   };

   it('[H] the notice leads the start turn and is gone for the next turn', async () => {
      const rig = noticeRig();
      rig.scripted.beta.script([say('Reviewed.')]);
      rig.scripted.beta.script([say('Later.')]);
      const sessionId = await open(rig);
      const first = createCx();

      await send(rig, sessionId, 'as Planner go', first);

      const texts = textsIn(first);
      const at    = texts.findIndex(text => text.includes('NOTICE-MODEL'));
      expect(at).toBeGreaterThan(0);
      expect(texts[at - 1].trim()).toBe('Changeover: sending `@start`');
      expect(texts[at + 1]).toBe('Reviewed.');
      const second = createCx();
      await send(rig, sessionId, 'and later?', second);
      expect(textsIn(second)).toEqual(['Later.']);
   });

   it('[H] after an abnormal end the notice stays', async () => {
      const rig = noticeRig();
      rig.scripted.beta.script([say('Cut off.'), end('refused')]);
      rig.scripted.beta.script([say('Later.')]);
      const sessionId = await open(rig);
      await send(rig, sessionId, 'as Planner go');
      const second = createCx();

      await send(rig, sessionId, 'and later?', second);

      expect(textsIn(second)[0]).toContain('NOTICE-MODEL');
   });

   it('[H] the active-turn flag holds across the gap between turns', async () => {
      const rig = makeRig();
      scriptPlannerToEnforcer(rig, 'beta');
      const { reached, hold } = holdRelease(rig);
      const sessionId = await open(rig);

      const turn = send(rig, sessionId, 'as Planner go');
      await reached;
      await expect(send(rig, sessionId, 'too soon')).rejects.toBeInstanceOf(TurnInProgressError);
      hold.resolve();
      await turn;

      expect(rig.commands).not.toContain('too soon');
      expect(rig.sessionStore.hasActiveTurn(sessionId)).toBe(false);
      rig.scripted.beta.script([say('Welcome back.')]);
      await expect(send(rig, sessionId, 'now')).resolves.toEqual({ stopReason: 'end_turn' });
   });
});

describe('the changeover loop: long loops and isolation between turns', () => {
   it('[H] a loop of 300 profile changes completes', async () => {
      const rig   = makeRig(ALL_ON_ALPHA);
      const names = Array.from({ length: 301 }, (_, at) => 0 === at % 2 ? 'Planner' : 'PromptEngineer');
      scriptChain(rig, 'alpha', names);

      const response = await send(rig, await open(rig), 'as Planner go');

      expect(response).toEqual({ stopReason: 'end_turn' });
      expect(rig.scripted.alpha.released).toHaveLength(300);
      expect(rig.commands).toHaveLength(601);
   }, 30_000);

   it('[H] a late update from a finished hop does not reach a later hop', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      const cx  = createCx();
      alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      alpha.script(writes(rig, 'Enforcer'));
      beta.script([wait('w'), say('Reviewed.')]);
      const sessionId = await open(rig);
      const turn = send(rig, sessionId, 'as Planner go', cx);
      await beta.reached('w');

      alpha.lateUpdate({ type: 'text', text: 'LATE-TEXT' }, 0);
      await expect(alpha.seen[0].options.onToolCall!(readReport)).resolves.toBe('deny');
      await flush();
      beta.release('w');
      await turn;

      expect(textsIn(cx).join('')).not.toContain('LATE-TEXT');
      expect(eventsOf(rig.logger, 'governance_outcome')).toEqual([{
         level: 'info', event: 'governance_outcome',
         data:  {
            sessionId, callId: expect.any(Number), action: 'deny', answeredBy: 'failure', reason: 'turn_ended',
         },
      }]);
   });

   it('[H] card ids from two hops do not collide', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      const cx  = createCx();
      const card = (title: string) => [
         call({ id: 'c1', kind: 'read', title }), update({ id: 'c1', title: `${title} done` }),
      ];
      alpha.script([act(() => rig.writeStatus('Planner', 'Enforcer')), ...card('Read a'), say(next('Enforcer'))]);
      alpha.script(writes(rig, 'Enforcer'));
      beta.script([...card('Read b'), say('Reviewed.')]);

      await send(rig, await open(rig), 'as Planner go', cx);

      const ids = cardIds(cx);
      expect(new Set(ids).size).toBe(2);
      for (const id of ids) { expect(updatesOf(cx, id)).toHaveLength(2); }
   });

   it('[H] streaming state is per turn', async () => {
      const rig = makeRig();
      const { alpha, beta } = rig.scripted;
      const cx  = createCx();
      alpha.script(suggests(rig, 'Planner', 'Enforcer'));
      alpha.script(writes(rig, 'Enforcer'));
      beta.script([], { text: 'Reviewed once.' });

      await send(rig, await open(rig), 'as Planner go', cx);

      expect(textsIn(cx).filter(text => 'Reviewed once.' === text)).toHaveLength(1);
   });

   it('the active-turn flag is cleared after a stop', async () => {
      const rig = makeRig();
      rig.scripted.alpha.script([say('Done.')]);
      const sessionId = await open(rig);
      await send(rig, sessionId, 'as Planner go');
      expect(rig.sessionStore.hasActiveTurn(sessionId)).toBe(false);
   });

   it('the active-turn flag is cleared after a cancel', async () => {
      const rig = makeRig();
      rig.scripted.alpha.script([say('Working.'), wait('w')]);
      const sessionId = await open(rig);
      const turn = send(rig, sessionId, 'as Planner go');
      await rig.scripted.alpha.reached('w');

      await rig.agent.cancel({ sessionId });

      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(rig.sessionStore.hasActiveTurn(sessionId)).toBe(false);
   });

   it('the active-turn flag is cleared after a throw', async () => {
      const rig = makeRig();
      rig.scripted.alpha.script([throws(new Error('boom'))]);
      const sessionId = await open(rig);
      await expect(send(rig, sessionId, 'as Planner go')).rejects.toThrow('boom');
      expect(rig.sessionStore.hasActiveTurn(sessionId)).toBe(false);
   });
});

describe('the changeover loop: over the real driver core', () => {
   it('[H] a two-hop loop starts a second agent and ends the first', async () => {
      const { agent, downstreams, done } = overRealCore({ agents: 2, workDir: dirOf() });
      const [first, second] = downstreams;
      first.respond('session/new',  () => ({ sessionId: 'agent-sess-1' }));
      second.respond('session/new', () => ({ sessionId: 'agent-sess-2' }));
      let prompts = 0;
      first.respond('session/prompt', async () => {
         if (0 === prompts++) {
            await first.notify('session/update', agentSays(`Done.\n\n${next('Enforcer')}`, 'agent-sess-1'));
         }
         else {
            handoffFile(dirOf(), 'Enforcer');
            await first.notify('session/update', agentSays('Handoff written.', 'agent-sess-1'));
         }
         return { stopReason: 'end_turn' };
      });
      second.respond('session/prompt', async () => {
         await second.notify('session/update', agentSays('Reviewed.', 'agent-sess-2'));
         return { stopReason: 'end_turn' };
      });
      const { sessionId } = await agent.newSession(newSessionArgs());
      readyFile(dirOf(), 'Planner', 'Enforcer');

      const response = await agent.prompt({ sessionId, ...textParam('as Planner go') }, createCx());

      const promptsOf = (fake: typeof first) => sent(fake, 'session/prompt');
      expect(promptsOf(first).map(params => params.prompt[0].text))
         .toEqual(['as Planner go', '@handoff to=Enforcer']);
      expect(new Set(promptsOf(first).map(params => params.sessionId)).size).toBe(1);
      expect(first.stdinClosed).toBe(true);
      expect(sent(second, 'session/new')).toHaveLength(1);
      expect(promptsOf(second).map(params => params.prompt[0].text)).toEqual(['@start']);
      expect(response).toEqual({ stopReason: 'end_turn' });
      await done();
   });
});
