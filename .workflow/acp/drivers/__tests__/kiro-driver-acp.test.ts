import { describe, it, expect } from 'vitest';
import { AgentRefusedError } from '../acp-driver-core/errors.js';
import { createLogger, fakeAgents, sent } from '../acp-driver-core/__tests__/acp-driver.helpers.js';
import { SESSION, failureOf } from '../acp-driver-core/__tests__/failures.helpers.js';
import { declaresToolCallGovernance } from '../governed-driver.js';
import type { ToolCallReport } from '../governed-driver.js';
import { KIRO_ARGS, KIRO_COMMAND, createKiroAcpDriver } from '../kiro-driver-acp.js';

/** What Kiro's V3 server reports at initialize: extension methods and a session list capability. */
const capabilities = (extensionMethods: unknown, list: unknown) => ({
   sessionCapabilities: { list }, _meta: { kiro: { extensionMethods } },
});

const initializeWith = (agentCapabilities: object) => ({ protocolVersion: 1, authMethods: [], agentCapabilities });

const V3 = initializeWith(capabilities(['_kiro/example'], {}));
const LEGACY = initializeWith({});

/** The options Kiro offers with every permission request (recorded, kiro-cli 2.22.0). */
const KIRO_OPTIONS = [
   { optionId: 'accept',        name: 'Allow',        kind: 'allow_once' },
   { optionId: 'always-accept', name: 'Always allow', kind: 'allow_always' },
   { optionId: 'reject',        name: 'Deny',         kind: 'reject_once' },
   { optionId: 'always-reject', name: 'Always deny',  kind: 'reject_always' },
];

/** A Kiro driver over fake agents; each answers initialize as V3 unless told otherwise. */
function makeKiro(count = 1) {
   const { agents, connect } = fakeAgents(count);
   agents.forEach(agent => agent.respond('initialize', () => V3));
   const logger = createLogger();
   return { driver: createKiroAcpDriver({ connect, logger }), agents, connect, logger };
}

describe('Kiro launch', () => {
   it('[H] launches kiro-cli exactly as specified, in the service\'s working directory', async () => {
      const { driver, connect } = makeKiro();
      await driver.execute('go');
      expect(connect).toHaveBeenCalledWith({
         command: 'kiro-cli', args: ['acp', '--agent-engine=v3', '--auth-method=cli'], cwd: process.cwd(),
      });
      expect(KIRO_COMMAND).toBe('kiro-cli');
      expect([...KIRO_ARGS]).toEqual(['acp', '--agent-engine=v3', '--auth-method=cli']);
   });

   it('is named kiro and declares tool-call governance', () => {
      const { driver } = makeKiro();
      expect(driver.name).toBe('kiro');
      expect(declaresToolCallGovernance(driver)).toBe(true);
   });

   it.each(['--trust-all-tools', '--trust-tools', '--trust'])(
      '[H] no launch argument equals or starts with %s',
      async flag => {
         const { driver, connect } = makeKiro();
         await driver.execute('go');
         const launched = connect.mock.calls[0][0].args;
         for (const args of [KIRO_ARGS, launched]) {
            expect(args.every(arg => flag !== arg && !arg.startsWith(flag))).toBe(true);
         }
      },
   );

   it('[H] no policy preset and no trust option is ever sent', async () => {
      const { driver, agents } = makeKiro();
      agents[0].respond('session/prompt', async () => {
         await agents[0].request('session/request_permission', {
            sessionId: SESSION, toolCall: { toolCallId: 't', title: 'ls' }, options: KIRO_OPTIONS,
         });
         return { stopReason: 'end_turn' };
      });
      await driver.execute('go', { model: 'auto', context: 'background', onToolCall: async () => 'approve' });
      const traffic = JSON.stringify(agents[0].received);
      expect(traffic).not.toMatch(/"policyPreset"/);
      expect(traffic).not.toMatch(/"trustOptions?"/);
   });
});

describe('Kiro V3 check', () => {
   it.each([
      ['extensionMethods array and sessionCapabilities.list',
       initializeWith(capabilities(['m'], {})), true],
      ['an empty extensionMethods array and sessionCapabilities.list',
       initializeWith(capabilities([], {})),    true],
      ['neither (legacy server)',       LEGACY,                                                false],
      ['extensionMethods only',
       initializeWith({ _meta: { kiro: { extensionMethods: ['m'] } } }),                       false],
      ['sessionCapabilities.list only', initializeWith({ sessionCapabilities: { list: {} } }), false],
      ['sessionCapabilities.list null', initializeWith(capabilities(['m'], null)),             false],
      ['extensionMethods as a string',  initializeWith(capabilities('m', {})),                 false],
      ['extensionMethods as an object', initializeWith(capabilities({ a: 1 }, {})),            false],
      ['extensionMethods as null',      initializeWith(capabilities(null, {})),                false],
      ['no _meta at all',               initializeWith({ sessionCapabilities: { list: {} } }), false],
   ] as Array<[string, object, boolean]>)('the session is allowed or refused '
      + 'by the initialize answer: %s', async (_label, answer, allowed) => {
      const { driver, agents } = makeKiro();
      agents[0].respond('initialize', () => answer);
      if (allowed) { await expect(driver.execute('go')).resolves.toMatchObject({ sessionId: SESSION }); }
      else { expect(await failureOf(driver.execute('go'))).toBeInstanceOf(AgentRefusedError); }
      agents[0].exit(0);
   });

   it('[H] a refusal says V3 is required and how Kiro is launched, '
      + 'ends the process, and the next prompt launches again', async () => {
      const { driver, agents, connect } = makeKiro(2);
      agents[0].respond('initialize', () => LEGACY);
      const error = await failureOf(driver.execute('go'));
      expect(error).toBeInstanceOf(AgentRefusedError);
      expect(error?.message).toContain('V3');
      expect(error?.message).toContain('kiro-cli acp --agent-engine=v3 --auth-method=cli');
      expect(agents[0].methods()).toEqual(['initialize']);
      expect(agents[0].stdinCloses).toBe(1);
      agents[0].exit(0);

      await expect(driver.execute('again')).resolves.toMatchObject({ sessionId: SESSION });
      expect(connect).toHaveBeenCalledTimes(2);
      expect(sent(agents[1], 'session/new')).toHaveLength(1);
   });
});

describe('Kiro permission requests', () => {
   it('[H] an approve selects the allow-once option and a deny the reject-once option, '
      + 'never an always option', async () => {
      const { driver, agents } = makeKiro(2);
      const answers: unknown[] = [];
      for (const agent of agents) {
         agent.respond('session/prompt', async () => {
            answers.push((await agent.request('session/request_permission', {
               sessionId: SESSION, toolCall: { toolCallId: 't', title: 'ls' }, options: KIRO_OPTIONS,
            }) as any).result.outcome);
            return { stopReason: 'end_turn' };
         });
      }
      await driver.execute('one', { onToolCall: async () => 'approve' });
      await driver.execute('two', { onToolCall: async () => 'deny' });
      expect(answers).toEqual([
         { outcome: 'selected', optionId: 'accept' },
         { outcome: 'selected', optionId: 'reject' },
      ]);
   });

   /** The recorded Kiro shapes: the stream names the command; the request has an id, a status and a title. */
   const STREAM_RAW = { command: 'ls -la', cwd: '/work', run_in_background: false };
   const REQUEST = {
      sessionId: SESSION,
      toolCall:  { toolCallId: 'run_command_toolu_01', status: 'pending', title: 'ls -la' },
      options:   KIRO_OPTIONS,
      _meta:     { kiro: { toolId: 'run_command', command: 'ls -la', consentRound: 1 } },
   };

   async function reportFor(withStream: boolean): Promise<ToolCallReport> {
      const { driver, agents } = makeKiro();
      const agent = agents[0];
      agent.respond('session/prompt', async () => {
         if (withStream) {
            await agent.notify('session/update', {
               sessionId: SESSION,
               update: {
                  sessionUpdate: 'tool_call', toolCallId: 'run_command_toolu_01', title: 'Run Command',
                  kind: 'execute', status: 'pending', rawInput: STREAM_RAW, _meta: { kiro: { toolOrigin: 'default' } },
               },
            });
         }
         await agent.request('session/request_permission', REQUEST);
         return { stopReason: 'end_turn' };
      });
      const seen: ToolCallReport[] = [];
      await driver.execute('go', { onToolCall: async report => { seen.push(report); return 'deny'; } });
      return seen[0];
   }

   it('the command comes from the stream by id, and the title is display only', async () => {
      expect(await reportFor(true)).toStrictEqual({
         kind: 'execute', title: 'ls -la', command: 'ls -la', rawInput: STREAM_RAW,
      });
   });

   it('[H] without the stream record the request alone has no command, whatever its title or _meta says', async () => {
      expect(await reportFor(false)).toStrictEqual({ kind: 'other', title: 'ls -la' });
   });
});
