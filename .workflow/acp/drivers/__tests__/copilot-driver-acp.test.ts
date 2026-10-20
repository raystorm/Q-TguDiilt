import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { AgentRefusedError } from '../acp-client/errors.js';
import { createLogger, fakeAgents } from '../acp-client/__tests__/acp-driver.helpers.js';
import { SESSION, failureOf } from '../acp-client/__tests__/failures.helpers.js';
import { evaluateToolCall, loadGovernanceConfig } from '../../governance/engine.js';
import { declaresToolCallGovernance } from '../governed-driver.js';
import type { ToolCallDecision, ToolCallReport } from '../governed-driver.js';
import { COPILOT_ARGS, COPILOT_COMMAND, createCopilotAcpDriver } from '../copilot-driver-acp.js';

const MODES = 'https://agentclientprotocol.com/protocol/session-modes';

/** Copilot's two permission-relevant config options, in the recorded shape (copilot 1.0.95). */
const mode     = (value: unknown) => ({
   id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: value, options: [],
});
const allowAll = (value: unknown) => ({
   id: 'allow_all', name: 'Allow all', category: 'permissions', type: 'select', currentValue: value, options: [],
});
const SAFE     = [mode(`${MODES}#agent`), allowAll('off')];

const configUpdate = (configOptions: unknown) =>
   ({ sessionId: SESSION, update: { sessionUpdate: 'config_option_update', configOptions } });
const said = (text: string) =>
   ({ sessionId: SESSION, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } });

/** A Copilot driver over fake agents; each answers session/new with these config options. */
function makeCopilot(count = 1, configOptions: unknown = SAFE) {
   const { agents, connect } = fakeAgents(count);
   agents.forEach(agent => agent.respond('session/new', () => ({ sessionId: SESSION, configOptions })));
   const logger = createLogger();
   return { driver: createCopilotAcpDriver({ connect, logger }), agents, connect, logger };
}

describe('Copilot launch', () => {
   it('[H] launches copilot exactly as specified, in the service\'s working directory', async () => {
      const { driver, connect, agents } = makeCopilot();
      await driver.execute('go');
      expect(connect).toHaveBeenCalledWith({ command: 'copilot', args: ['--acp', '--stdio'], cwd: process.cwd() });
      expect(COPILOT_COMMAND).toBe('copilot');
      expect([...COPILOT_ARGS]).toEqual(['--acp', '--stdio']);
      agents[0].exit(0);
   });

   it('is named copilot and declares tool-call governance', () => {
      const { driver } = makeCopilot();
      expect(driver.name).toBe('copilot');
      expect(declaresToolCallGovernance(driver)).toBe(true);
   });

   it.each([
      '--available-tools', '--excluded-tools', '--allow-all', '--allow-all-tools',
      '--allow-tool', '--yolo', '--autopilot',
   ])('[H] no launch argument equals or starts with %s', async flag => {
      const { driver, connect, agents } = makeCopilot();
      await driver.execute('go');
      const launched = connect.mock.calls[0][0].args;
      for (const args of [COPILOT_ARGS, launched]) {
         expect(args.every(arg => flag !== arg && !arg.startsWith(flag))).toBe(true);
      }
      agents[0].exit(0);
   });

   it('[H] it advertises no client capabilities and never authenticates or changes a setting', async () => {
      const { driver, agents } = makeCopilot();
      await driver.execute('go');
      const initialize = agents[0].received.find((m: any) => 'initialize' === m.method) as any;
      expect(initialize.params.clientCapabilities).toEqual({});
      expect(agents[0].methods()).toEqual(['initialize', 'session/new', 'session/prompt']);
      agents[0].exit(0);
   });
});

describe('Copilot session check', () => {
   it.each([
      ['off', `${MODES}#agent`,     true],
      ['off', `${MODES}#plan`,      true],
      ['on',  `${MODES}#agent`,     false],
      ['off', `${MODES}#autopilot`, false],
      ['on',  `${MODES}#autopilot`, false],
      ['off', 'autopilot',          false],
   ])('[H] allow_all %s and mode %s: allowed is %s', async (allow, modeValue, allowed) => {
      const { driver, agents } = makeCopilot(1, [mode(modeValue), allowAll(allow)]);
      if (allowed) { await expect(driver.execute('go')).resolves.toMatchObject({ sessionId: SESSION }); }
      else { expect(await failureOf(driver.execute('go'))).toBeInstanceOf(AgentRefusedError); }
      agents[0].exit(0);
   });

   it.each([
      ['allow_all', [mode(`${MODES}#agent`), allowAll('on')]],
      ['autopilot', [mode(`${MODES}#autopilot`), allowAll('off')]],
   ])('[H] the refusal names %s, says the client cannot change it, '
      + 'ends the process and sends no prompt', async (setting, options) => {
      const { driver, agents } = makeCopilot(1, options);
      const error = await failureOf(driver.execute('go'));
      expect(error?.message).toContain(setting);
      expect(error?.message).toContain('cannot change');
      expect(agents[0].methods()).toEqual(['initialize', 'session/new']);
      expect(agents[0].stdinCloses).toBe(1);
      agents[0].exit(0);
   });

   it.each([
      ['no allow_all option',                      [mode(`${MODES}#agent`)]],
      ['no mode option',                           [allowAll('off')]],
      ['allow_all with a value other than on/off', [mode(`${MODES}#agent`), allowAll('maybe')]],
      ['an unknown mode value',                    [mode(`${MODES}#something-new`), allowAll('off')]],
      ['configOptions missing',                    undefined],
      ['configOptions that are not an array',      'none'],
   ])('[H] the session is allowed with %s', async (_label, options) => {
      const { driver, agents } = makeCopilot(1, options);
      await expect(driver.execute('go')).resolves.toMatchObject({ sessionId: SESSION });
      agents[0].exit(0);
   });
});

describe('Copilot mid-session settings', () => {
   it.each([
      ['allow_all', [mode(`${MODES}#agent`), allowAll('on')]],
      ['autopilot', [mode(`${MODES}#autopilot`), allowAll('off')]],
   ])('[H] %s switched on during a turn warns in the reply, '
      + 'is logged, and the turn goes on', async (setting, options) => {
      const { driver, agents, logger } = makeCopilot();
      const agent = agents[0];
      agent.respond('session/prompt', async () => {
         await agent.notify('session/update', configUpdate(options));
         await agent.notify('session/update', said('hello'));
         return { stopReason: 'end_turn' };
      });
      const result = await driver.execute('go');
      expect(result.text.split('\n\n')).toEqual([expect.stringContaining(setting), 'hello']);
      expect(logger.warn).toHaveBeenCalledWith('agent_setting_changed', { agentSessionId: SESSION, setting });
      agent.exit(0);
   });

   it('[H] the config updates Copilot sends at the start of a session, '
      + 'with safe values, warn about nothing', async () => {
      const { driver, agents, logger } = makeCopilot();
      const agent = agents[0];
      agent.respond('session/prompt', async () => {
         await agent.notify('session/update', configUpdate(SAFE));
         await agent.notify('session/update', configUpdate([mode(`${MODES}#plan`), allowAll('off')]));
         await agent.notify('session/update', said('hello'));
         return { stopReason: 'end_turn' };
      });
      expect((await driver.execute('go')).text).toBe('hello');
      expect(logger.warn).not.toHaveBeenCalled();
      agent.exit(0);
   });
});

describe('Copilot permission requests', () => {
   /** The options Copilot offers with a permission request (recorded, copilot 1.0.95). */
   const OPTIONS = [
      { optionId: 'allow_once',   name: 'Allow',        kind: 'allow_once' },
      { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
      { optionId: 'reject_once',  name: 'Reject',       kind: 'reject_once' },
   ];

   /**
    * One turn in which Copilot asks to run `command`, in the recorded request shape.
    * Returns what the agent was answered.
    */
   async function askToRun(command: string, decide: (report: ToolCallReport) => Promise<ToolCallDecision>) {
      const { driver, agents } = makeCopilot();
      const agent = agents[0];
      let outcome: unknown;
      agent.respond('session/prompt', async () => {
         outcome = ((await agent.request('session/request_permission', {
            sessionId: SESSION,
            toolCall:  {
               toolCallId: 'call_1', kind: 'execute', status: 'pending', title: 'Create marker',
               rawInput: { command, commands: [command] },
            },
            options: OPTIONS,
         })) as any).result.outcome;
         return { stopReason: 'end_turn' };
      });
      await driver.execute('go', { onToolCall: decide });
      agent.exit(0);
      return outcome;
   }

   it('[H] the report carries the command and kind from the request alone', async () => {
      const seen: ToolCallReport[] = [];
      await askToRun('touch x', async report => { seen.push(report); return 'deny'; });
      expect(seen).toStrictEqual([{
         kind: 'execute', title: 'Create marker', command: 'touch x',
         rawInput: { command: 'touch x', commands: ['touch x'] },
      }]);
   });

   it.each([
      ['approve', { outcome: 'selected', optionId: 'allow_once' }],
      ['deny',    { outcome: 'selected', optionId: 'reject_once' }],
   ] as Array<[ToolCallDecision, unknown]>)('[H] a %s selects the once option, '
      + 'never allow_always', async (decision, expected) => {
      expect(await askToRun('touch x', async () => decision)).toEqual(expected);
   });

   const config = loadGovernanceConfig(fileURLToPath(new URL('../../governance/config.yaml', import.meta.url)));

   it.each(['ls && rm -rf build', 'ls; rm -rf build'])(
      '[H] the compound command "%s" reaches governance whole and is not approved', async command => {
         const decisions: string[] = [];
         const seen: ToolCallReport[] = [];
         await askToRun(command, async report => {
            seen.push(report);
            decisions.push(evaluateToolCall(config, report).action);
            return 'deny';
         });
         expect(seen[0].command).toBe(command);
         expect(decisions).toHaveLength(1);
         expect(decisions[0]).not.toBe('approve');
      },
   );
});

describe('Copilot driver file', () => {
   it('holds launch settings and the unsafe-setting list only: '
      + 'it imports the core\'s entry points and nothing else', () => {
      const source  = readFileSync(fileURLToPath(new URL('../copilot-driver-acp.ts', import.meta.url)), 'utf8');
      const imports = [...source.matchAll(/from '([^']+)'/g)].map(match => match[1]).sort();
      expect(imports).toEqual([
         '../shared/logger.js', './acp-client/acp-driver.js', './acp-client/connect.js',
         './acp-client/types.js', './governed-driver.js',
      ]);
   });
});
