import { describe, it, expect, vi } from 'vitest';
import type { PermissionOption } from '@agentclientprotocol/sdk';
import type { ToolCallDecision, ToolCallReport } from '../../governed-driver.js';
import { answerFor } from '../permissions.js';
import { NEVER } from './fake-acp-agent.js';
import { deferred, flush, makeDriver } from './acp-driver.helpers.js';
import {
   SESSION, ALLOW, REJECT, CANCELLED, picked, type Decide, approve, deny, runTurn,
} from './permissions.helpers.js';

describe('permission requests: options and answers', () => {
   const optionsOf = (kinds: string[]) => kinds.map(kind => ({ optionId: `id-${kind}`, name: kind, kind }));
   const ALL = ['allow_once', 'allow_always', 'reject_once', 'reject_always'];

   it.each([
      [['allow_once', 'allow_always', 'reject_once'],                  'approve', 'allow_once'],
      [['allow_once', 'allow_always', 'reject_once'],                  'deny',    'reject_once'],
      [['allow_once', 'allow_always', 'reject_once', 'reject_always'], 'deny',    'reject_once'],
      [['allow_always', 'reject_once'],                                'approve', 'reject_once'],
      [['allow_always', 'reject_always'],                              'approve', 'cancelled'],
      [['allow_always', 'reject_always'],                              'deny',    'cancelled'],
      [['allow_once'],                                                 'deny',    'cancelled'],
      [['reject_once'],                                                'approve', 'reject_once'],
      [[],                                                             'approve', 'cancelled'],
      [[],                                                             'deny',    'cancelled'],
   ] as Array<[string[], ToolCallDecision, string]>)(
      '[H] options %j answered %s select %s',
      async (kinds, decision, expected) => {
         const { scripted } = await runTurn(
            async ({ ask }) => ask({ toolCallId: 'a' }, optionsOf(kinds)),
            async () => decision,
         );
         expect(scripted.result.outcome).toEqual('cancelled' === expected ? CANCELLED : picked(`id-${expected}`));
      },
   );

   it('[H] names and ids never decide', async () => {
      const options = [
         { optionId: 'allow_once', name: 'Allow once', kind: 'reject_once' },
         { optionId: 'accept',     name: 'Accept',     kind: 'allow_once' },
      ];
      const approved = await runTurn(async ({ ask }) => ask({ toolCallId: 'a' }, options), approve);
      const denied   = await runTurn(async ({ ask }) => ask({ toolCallId: 'a' }, options), deny);
      expect(approved.scripted.result.outcome).toEqual(picked('accept'));
      expect(denied.scripted.result.outcome).toEqual(picked('allow_once'));
   });

   it('[H] allow_always and reject_always are never selected, and no option is invented', () => {
      for (let mask = 0; mask < 16; mask++) {
         const options = optionsOf(ALL.filter((_, bit) => 0 !== (mask & (1 << bit)))) as PermissionOption[];
         for (const decision of ['approve', 'deny'] as const) {
            const { outcome } = answerFor(options, decision, () => undefined);
            if ('selected' === outcome.outcome) {
               expect(options.map(option => option.optionId)).toContain(outcome.optionId);
               expect(outcome.optionId).not.toMatch(/always/);
            }
         }
      }
   });

   it('the response carries only the outcome', async () => {
      const { scripted } = await runTurn(async ({ ask }) => ask({ toolCallId: 'a' }));
      expect(scripted.result).toStrictEqual({ outcome: picked('allow') });
   });

   it.each([
      ['approve', [REJECT], approve],
      ['deny',    [ALLOW],  deny],
   ] as Array<[string, object[], Decide]>)(
      'a missing option for %s is logged with the session id and the wanted decision only',
      async (wanted, options, decide) => {
         const { logger } = await runTurn(async ({ ask }) => ask({ toolCallId: 'a' }, options), decide);
         expect(logger.warn).toHaveBeenCalledWith('permission_option_fallback', { agentSessionId: SESSION, wanted });
      },
   );

   it.each([
      ['missing',                     undefined],
      ['not an array',                'allow'],
      ['an entry without a kind',     [{ optionId: 'a', name: 'A' }]],
      ['an entry of an unknown kind', [{ optionId: 'a', name: 'A', kind: 'allow_forever' }]],
   ] as Array<[string, unknown]>)(
      'options that are %s get an error response from the SDK and never reach the handler',
      async (_label, options) => {
         const { reports, scripted, result } = await runTurn(async ({ agent }) =>
            agent.request('session/request_permission', {
               sessionId: SESSION, toolCall: { toolCallId: 'a' }, ...(undefined === options ? {} : { options }),
            }));
         expect(scripted).toHaveProperty('error');
         expect(scripted).not.toHaveProperty('result');
         expect(reports).toEqual([]);
         expect(result.text).toBe('');
      },
   );

   it('[H] the handler is called once per request, and the answer is sent only after it settles', async () => {
      const gate   = deferred<ToolCallDecision>();
      const decide = vi.fn(() => gate.promise);
      let before: [number, boolean] | undefined;
      const { scripted } = await runTurn(async ({ ask }) => {
         let answered = false;
         const pending = ask({ toolCallId: 'a' }).then(response => { answered = true; return response; });
         await flush();
         before = [decide.mock.calls.length, answered];
         gate.resolve('approve');
         return pending;
      }, decide);
      expect(before).toEqual([1, false]);
      expect(decide).toHaveBeenCalledTimes(1);
      expect(scripted.result.outcome).toEqual(picked('allow'));
   });

   it.each(['allow', 'APPROVE', '', undefined, true])(
      '[H] a handler answer of %j is a deny',
      async value => {
         const { scripted } = await runTurn(
            async ({ ask }) => ask({ toolCallId: 'a' }),
            (async () => value) as unknown as Decide,
         );
         expect(scripted.result.outcome).toEqual(picked('reject'));
      },
   );

   it('[H] with no handler a request is denied', async () => {
      const { scripted, result } = await runTurn(async ({ ask }) => ask({ toolCallId: 'a' }), null);
      expect(scripted.result.outcome).toEqual(picked('reject'));
      expect(result.toolCalls).toEqual([
         { report: { id: 'a', kind: 'other', title: '' }, decision: 'deny' },
      ]);
   });

   const failure = new Error('handler broke');
   it.each([
      ['throws',  () => { throw failure; }],
      ['rejects', async () => { throw failure; }],
   ])('[H] a handler that %s never lets the call run', async (_label, decide) => {
      const { driver, agents } = makeDriver();
      const agent = agents[0];
      let reply: Promise<any> | undefined;
      agent.respond('session/prompt', async () => {
         reply = agent.request('session/request_permission', {
            sessionId: SESSION, toolCall: { toolCallId: 'a' }, options: [ALLOW, REJECT],
         });
         return NEVER;
      });
      const error = await driver.execute('go', { onToolCall: decide as unknown as Decide })
         .then(() => undefined, (err: unknown) => err);
      expect(error).toBe(failure);
      expect((await reply)?.result.outcome).toEqual(CANCELLED);
      expect(agent.stdinCloses).toBe(1);
      agent.exit(0);
   });

   it('[H] parallel requests keep their own answers', async () => {
      const gates  = { first: deferred<ToolCallDecision>(), second: deferred<ToolCallDecision>() };
      const decide = (report: ToolCallReport) => gates[report.title as 'first' | 'second'].promise;
      const { scripted } = await runTurn(async ({ agent }) => {
         const ask = (id: string, title: string) => agent.request('session/request_permission', {
            sessionId: SESSION, toolCall: { toolCallId: id, title }, options: [ALLOW, REJECT],
         }, id);
         const first  = ask('req-1', 'first');
         const second = ask('req-2', 'second');
         await flush();
         gates.second.resolve('approve');
         await flush();
         gates.first.resolve('deny');
         return Promise.all([first, second]);
      }, decide);
      const [first, second] = scripted;
      expect([first.id, first.result.outcome]).toEqual(['req-1', picked('reject')]);
      expect([second.id, second.result.outcome]).toEqual(['req-2', picked('allow')]);
   });

   it('[H] a request for an unknown session is cancelled, logged, and the turn is unaffected', async () => {
      const { scripted, reports, logger, result } = await runTurn(async ({ agent }) => {
         const response = await agent.request('session/request_permission', {
            sessionId: 'other-sess', toolCall: { toolCallId: 'a' }, options: [ALLOW, REJECT],
         });
         await agent.notify('session/update', {
            sessionId: SESSION, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } },
         });
         return response;
      });
      expect(scripted.result.outcome).toEqual(CANCELLED);
      expect(reports).toEqual([]);
      expect(logger.warn)
         .toHaveBeenCalledWith('permission_unknown_session', { agentSessionId: 'other-sess', pid: 4000 });
      expect(result.text).toBe('ok');
   });

   it('[H] a request naming a session of another process is refused', async () => {
      const { driver, agents } = makeDriver(2);
      agents[0].respond('session/new', () => ({ sessionId: 'sess-a' }));
      agents[1].respond('session/new', () => ({ sessionId: 'sess-b' }));
      let response: any;
      agents[0].respond('session/prompt', async () => {
         response = await agents[0].request('session/request_permission', {
            sessionId: 'sess-b', toolCall: { toolCallId: 'x' }, options: [ALLOW, REJECT],
         });
         return { stopReason: 'end_turn' };
      });
      const onToolCall = vi.fn(approve);
      await Promise.all([driver.execute('one', { onToolCall }), driver.execute('two', { onToolCall })]);
      expect(response.result.outcome).toEqual(CANCELLED);
      expect(onToolCall).not.toHaveBeenCalled();
   });

   it('a request with no turn in flight is not allowed', async () => {
      const { driver, agents } = makeDriver();
      const onToolCall = vi.fn(approve);
      await driver.execute('go', { onToolCall });
      const response = await agents[0].request('session/request_permission', {
         sessionId: SESSION, toolCall: { toolCallId: 'a' }, options: [ALLOW, REJECT],
      });
      expect((response as any).result.outcome).toEqual(CANCELLED);
      expect(onToolCall).not.toHaveBeenCalled();
   });

   it('every reported request is recorded in order', async () => {
      const answers: ToolCallDecision[] = ['approve', 'deny', 'approve'];
      let n = 0;
      const { result } = await runTurn(async ({ ask }) => {
         for (const title of ['one', 'two', 'three']) { await ask({ toolCallId: title, title }); }
      }, async () => answers[n++]);
      expect(result.toolCalls).toEqual([
         { report: { id: 'one',   kind: 'other', title: 'one' },   decision: 'approve' },
         { report: { id: 'two',   kind: 'other', title: 'two' },   decision: 'deny' },
         { report: { id: 'three', kind: 'other', title: 'three' }, decision: 'approve' },
      ]);
   });

   it('duplicate requests for one call id are each reported', async () => {
      const { reports } = await runTurn(async ({ ask }) => {
         await ask({ toolCallId: 'same' });
         await ask({ toolCallId: 'same' });
      });
      expect(reports).toHaveLength(2);
   });
});
