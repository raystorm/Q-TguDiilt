import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { SETUP_TIMEOUT_MS } from '../acp-driver.js';
import { AgentSetupTimeoutError } from '../errors.js';
import { SessionCollapseError } from '../../../protocol/errors.js';
import { NEVER } from './fake-acp-agent.js';
import { LAUNCH, deferred, flush, makeDriver, sent, type FakeAgent } from './acp-driver.helpers.js';

const chunk = (sessionId: string, text: string) => ({
   sessionId,
   update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
});

/** Makes the agent stream these texts during a prompt, then end with `stopReason`. */
function sayDuringPrompt(agent: FakeAgent, texts: string[], stopReason = 'end_turn') {
   agent.respond('session/prompt', async (params: any) => {
      for (const text of texts) { await agent.notify('session/update', chunk(params.sessionId, text)); }
      return { stopReason };
   });
}

describe('launch and setup', () => {
   it('nothing is launched before the first prompt', () => {
      const { connect } = makeDriver();
      expect(connect).not.toHaveBeenCalled();
   });

   it('the first prompt launches one agent and runs initialize, session/new, session/prompt in order', async () => {
      const { driver, agents, connect } = makeDriver();
      const result = await driver.execute('hello');
      expect(connect).toHaveBeenCalledTimes(1);
      expect(connect).toHaveBeenCalledWith({ ...LAUNCH, cwd: process.cwd() });
      expect(agents[0].methods()).toEqual(['initialize', 'session/new', 'session/prompt']);
      expect(sent(agents[0], 'session/prompt')[0]).toEqual({
         sessionId: 'agent-sess-1', prompt: [{ type: 'text', text: 'hello' }],
      });
      expect(result.sessionId).toBe('agent-sess-1');
   });

   it('[H] an unknown downstream session id is a session collapse, never a silent new session', async () => {
      const { driver, connect } = makeDriver();
      await expect(driver.execute('go', { sessionId: 'ghost' })).rejects.toBeInstanceOf(SessionCollapseError);
      expect(connect).not.toHaveBeenCalled();
   });

   it('later turns reuse the process and the downstream session', async () => {
      const { driver, agents, connect } = makeDriver();
      const first  = await driver.execute('one');
      await driver.execute('two', { sessionId: first.sessionId });
      expect(connect).toHaveBeenCalledTimes(1);
      expect(agents[0].methods()).toEqual(['initialize', 'session/new', 'session/prompt', 'session/prompt']);
      expect(sent(agents[0], 'session/prompt')[1].sessionId).toBe(first.sessionId);
   });

   it('[H] two sessions get two processes and stay apart', async () => {
      const { driver, agents, connect } = makeDriver(2);
      agents[0].respond('session/new', () => ({ sessionId: 'sess-a' }));
      agents[1].respond('session/new', () => ({ sessionId: 'sess-b' }));
      sayDuringPrompt(agents[0], ['from-a']);
      sayDuringPrompt(agents[1], ['from-b']);
      const [a, b] = await Promise.all([driver.execute('one'), driver.execute('two')]);
      expect(connect).toHaveBeenCalledTimes(2);
      expect([a.text, a.sessionId]).toEqual(['from-a', 'sess-a']);
      expect([b.text, b.sessionId]).toEqual(['from-b', 'sess-b']);
      expect(JSON.stringify(agents[0].received)).toContain('one');
      expect(JSON.stringify(agents[0].received)).not.toContain('two');
      expect(JSON.stringify(agents[1].received)).not.toContain('one');
   });

   it('[H] no client capability is advertised', async () => {
      const { driver, agents } = makeDriver();
      await driver.execute('hello');
      expect(sent(agents[0], 'initialize')[0].clientCapabilities).toStrictEqual({});
      expect(JSON.stringify(agents[0].received)).not.toMatch(/"(fs|terminal)"/);
   });

   it('session/new gets the absolute service directory and no MCP servers', async () => {
      const { driver, agents } = makeDriver();
      await driver.execute('hello');
      const params = sent(agents[0], 'session/new')[0];
      expect(params.cwd).toBe(process.cwd());
      expect(isAbsolute(params.cwd)).toBe(true);
      expect(params.mcpServers).toEqual([]);
   });
});

describe('client surface', () => {
   const WRITE_TARGET = join(tmpdir(), 'acp-core-must-not-exist.txt');
   const unsupported: Array<[string, string, unknown]> = [
      ['fs/read_text_file for /etc/passwd', 'fs/read_text_file',  { sessionId: 'agent-sess-1', path: '/etc/passwd' }],
      ['fs/write_text_file',                'fs/write_text_file',
         { sessionId: 'agent-sess-1', path: WRITE_TARGET, content: 'x' }],
      ['terminal/create',                   'terminal/create',    { sessionId: 'agent-sess-1', command: 'ls' }],
      ['_kiro/terminal/shell_type',         '_kiro/terminal/shell_type', {}],
      ['an unknown extension method',       '_foo/bar',           {}],
   ];

   it.each(unsupported)('[H] %s gets an error response and the turn carries on', async (_label, method, params) => {
      const { driver, agents } = makeDriver();
      let response: any;
      agents[0].respond('session/prompt', async () => {
         response = await agents[0].request(method, params);
         return { stopReason: 'end_turn' };
      });
      const result = await driver.execute('go');
      expect(response).toHaveProperty('error');
      expect(response).not.toHaveProperty('result');
      expect(result.text).toBe('');
      expect(existsSync(WRITE_TARGET)).toBe(false);
   });

   it('an unknown agent notification and an unknown update kind are ignored', async () => {
      // The SDK writes an unknown update, in full, to the service's stderr. Held back here so the test run stays quiet.
      const echo = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
         const { driver, agents, logger } = makeDriver();
         agents[0].respond('session/prompt', async (params: any) => {
            await agents[0].notify('_kiro/sessions/changed', {});
            await agents[0].notify('session/update', {
               sessionId: params.sessionId, update: { sessionUpdate: 'something_new' },
            });
            await agents[0].notify('session/update', chunk(params.sessionId, 'ok'));
            return { stopReason: 'end_turn' };
         });
         const result = await driver.execute('go');
         await flush();
         expect(result.text).toBe('ok');
         expect(logger.error).not.toHaveBeenCalled();
         expect(logger.warn).not.toHaveBeenCalled();
         expect(echo).toHaveBeenCalledTimes(1);
         expect(echo.mock.calls[0][0]).toBe('Error handling notification');
      }
      finally { echo.mockRestore(); }
   });
});

describe('text, continuity and results', () => {
   it('agent text becomes the result text in order', async () => {
      const { driver, agents } = makeDriver();
      sayDuringPrompt(agents[0], ['a', 'b', 'c']);
      expect((await driver.execute('go')).text).toBe('abc');
   });

   it('only message text counts', async () => {
      const { driver, agents } = makeDriver();
      agents[0].respond('session/prompt', async (params: any) => {
         const id = params.sessionId;
         const update = (u: object) => agents[0].notify('session/update', { sessionId: id, update: u });
         await update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } });
         await update({ sessionUpdate: 'plan', entries: [] });
         await update({ sessionUpdate: 'available_commands_update', availableCommands: [] });
         await update({ sessionUpdate: 'current_mode_update', currentModeId: 'x' });
         await update({
            sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: 'AAAA', mimeType: 'image/png' },
         });
         await agents[0].notify('session/update', chunk(id, 'kept'));
         return { stopReason: 'end_turn' };
      });
      expect((await driver.execute('go')).text).toBe('kept');
   });

   it('the result carries the downstream session id and a clean shape', async () => {
      const { driver, agents } = makeDriver();
      sayDuringPrompt(agents[0], ['x']);
      expect(await driver.execute('go')).toStrictEqual({ text: 'x', sessionId: 'agent-sess-1', toolCalls: [] });
   });

   it.each(['end_turn', 'max_tokens', 'max_turn_requests', 'refusal'])(
      'stop reason %s is a normal result with the text so far',
      async reason => {
         const { driver, agents } = makeDriver();
         sayDuringPrompt(agents[0], ['so far'], reason);
         const result = await driver.execute('go');
         expect(result.text).toBe('so far');
         expect(Object.keys(result)).not.toContain('cancelled');
      },
   );

   it('an agent that reports cancelled without our abort is a normal result, and is logged', async () => {
      const { driver, agents, logger } = makeDriver();
      sayDuringPrompt(agents[0], ['partial'], 'cancelled');
      const result = await driver.execute('go');
      expect(result.text).toBe('partial');
      expect(Object.keys(result)).not.toContain('cancelled');
      expect(logger.info).toHaveBeenCalledWith('agent_cancel_unrequested', { agentSessionId: 'agent-sess-1' });
   });

   it('an empty command is rejected as the other drivers do, and starts no process', async () => {
      const { driver, connect } = makeDriver();
      await expect(driver.execute('')).rejects.toThrow(/command/i);
      expect(connect).not.toHaveBeenCalled();
   });

   it('an empty model is rejected as the other drivers do, and starts no process', async () => {
      const { driver, connect } = makeDriver();
      await expect(driver.execute('go', { model: '' })).rejects.toThrow(/model/i);
      expect(connect).not.toHaveBeenCalled();
   });
});

describe('context and model', () => {
   const modelOption = {
      id: 'model', name: 'Model', type: 'select', category: 'model', currentValue: 'm1',
      options: [{ value: 'm1', name: 'M1' }, { value: 'm2', name: 'M2' }],
   };
   const modeOption = {
      id: 'mode', name: 'Mode', type: 'select', category: 'mode', currentValue: 'ask',
      options: [{ value: 'ask', name: 'Ask' }, { value: 'm2', name: 'Autopilot' }],
   };

   /** The agent offers these config options and accepts any change. */
   function offering(agent: FakeAgent, options: object[]) {
      agent.respond('session/new', () => ({ sessionId: 'agent-sess-1', configOptions: options }));
      agent.respond('session/set_config_option', () => ({ configOptions: options }));
   }

   it('context is prepended to the prompt, separated by a blank line', async () => {
      const { driver, agents } = makeDriver();
      await driver.execute('do it', { context: 'background' });
      expect(sent(agents[0], 'session/prompt')[0].prompt)
         .toEqual([{ type: 'text', text: 'background\n\ndo it' }]);
   });

   it('[H] the requested model is selected once, on the model option only, before the prompt', async () => {
      const { driver, agents } = makeDriver();
      offering(agents[0], [modeOption, modelOption]);
      await driver.execute('go', { model: 'm2' });
      expect(agents[0].methods())
         .toEqual(['initialize', 'session/new', 'session/set_config_option', 'session/prompt']);
      expect(sent(agents[0], 'session/set_config_option'))
         .toEqual([{ sessionId: 'agent-sess-1', configId: 'model', value: 'm2' }]);
   });

   it('no model requested, or the model already current: nothing is set', async () => {
      const { driver, agents } = makeDriver(2);
      offering(agents[0], [modelOption]);
      offering(agents[1], [modelOption]);
      await driver.execute('go');
      await driver.execute('go', { model: 'm1' });
      expect(sent(agents[0], 'session/set_config_option')).toEqual([]);
      expect(sent(agents[1], 'session/set_config_option')).toEqual([]);
   });

   it('finds the model inside a group of options', async () => {
      const { driver, agents } = makeDriver();
      const grouped = { ...modelOption, options: [{ group: 'g', name: 'G', options: [{ value: 'm2', name: 'M2' }] }] };
      offering(agents[0], [grouped]);
      await driver.execute('go', { model: 'm2' });
      expect(sent(agents[0], 'session/set_config_option')).toHaveLength(1);
   });

   it('[H] a model the agent does not offer is rejected naming it, no prompt sent, process ended', async () => {
      const { driver, agents } = makeDriver();
      offering(agents[0], [modelOption]);
      await expect(driver.execute('go', { model: 'm3' })).rejects.toThrow(/m3/);
      expect(agents[0].methods()).not.toContain('session/prompt');
      expect(sent(agents[0], 'session/set_config_option')).toEqual([]);
      expect(agents[0].stdinCloses).toBe(1);
      agents[0].exit(0);
   });

   it('[H] a model with no model option offered is rejected the same way', async () => {
      const { driver, agents } = makeDriver();
      offering(agents[0], [modeOption]);
      await expect(driver.execute('go', { model: 'm3' })).rejects.toThrow(/m3/);
      expect(agents[0].methods()).not.toContain('session/prompt');
      expect(agents[0].stdinCloses).toBe(1);
      agents[0].exit(0);
   });

   it('auto is never an error: with no model option, nothing is set and the prompt is sent', async () => {
      const { driver, agents } = makeDriver();
      offering(agents[0], [modeOption]);
      await driver.execute('go', { model: 'auto' });
      expect(sent(agents[0], 'session/set_config_option')).toEqual([]);
      expect(agents[0].methods()).toContain('session/prompt');
   });

   it('auto is selected when the agent offers it as a model value', async () => {
      const { driver, agents } = makeDriver();
      const withAuto = { ...modelOption, options: [...modelOption.options, { value: 'auto', name: 'Auto' }] };
      offering(agents[0], [withAuto]);
      await driver.execute('go', { model: 'auto' });
      expect(sent(agents[0], 'session/set_config_option'))
         .toEqual([{ sessionId: 'agent-sess-1', configId: 'model', value: 'auto' }]);
   });

   it('a later turn on the same session switches the model only when it changes', async () => {
      const { driver, agents } = makeDriver();
      offering(agents[0], [modelOption]);
      const first = await driver.execute('one', { model: 'm1' });
      await driver.execute('two',   { sessionId: first.sessionId, model: 'm2' });
      await driver.execute('three', { sessionId: first.sessionId, model: 'm2' });
      expect(sent(agents[0], 'session/set_config_option'))
         .toEqual([{ sessionId: 'agent-sess-1', configId: 'model', value: 'm2' }]);
   });
});

describe('close', () => {
   it('ends every process the driver started, once, however often it is called', async () => {
      const { driver, agents } = makeDriver(3);
      await Promise.all([driver.execute('a'), driver.execute('b'), driver.execute('c')]);
      const closing = driver.close();
      agents.forEach(agent => agent.exit(0));
      await closing;
      expect(agents.map(agent => agent.stdinCloses)).toEqual([1, 1, 1]);
      await Promise.all([driver.close(), driver.close()]);
      await driver.close();
      expect(agents.map(agent => agent.stdinCloses)).toEqual([1, 1, 1]);
   });
});

const ANSWERS = {
   'initialize':  { protocolVersion: 1, agentCapabilities: {}, authMethods: [] },
   'session/new': { sessionId: 'agent-sess-1' },
};
const CANCELLED_RESULT = { text: '', sessionId: '', toolCalls: [], cancelled: true };

/** Answers `answer` after `ms` of (fake) time. */
const afterMs = (ms: number, answer: unknown) => async () => {
   await new Promise(resolve => setTimeout(resolve, ms));
   return answer;
};

describe('abort before and during setup', () => {
   it('[H] a signal already aborted at entry launches nothing', async () => {
      const { driver, connect } = makeDriver();
      const controller = new AbortController();
      controller.abort();
      expect(await driver.execute('go', { signal: controller.signal })).toStrictEqual(CANCELLED_RESULT);
      expect(connect).not.toHaveBeenCalled();
   });

   /** Aborts while `hold` is pending, lets it return, and reports what happened. */
   async function abortDuring(hold: 'connect' | 'initialize' | 'session/new' | 'after session/new') {
      const held       = deferred();
      const controller = new AbortController();
      const { driver, agents } = makeDriver(1, 'connect' === hold ? () => held.promise : undefined);
      if ('initialize' === hold || 'session/new' === hold) {
         agents[0].respond(hold, async () => { await held.promise; return ANSWERS[hold]; });
      }
      if ('after session/new' === hold) {
         agents[0].respond('session/new', () => { controller.abort(); return ANSWERS['session/new']; });
      }
      const turn = driver.execute('go', { signal: controller.signal });
      await flush();
      if ('after session/new' !== hold) { controller.abort(); }
      held.resolve();
      const result = await turn;
      const ended  = agents[0].stdinCloses;
      agents[0].exit(0);
      return { result, ended, methods: agents[0].methods() };
   }

   it.each([
      ['connect',            'connect',            []],
      ['initialize',         'initialize',         ['initialize']],
      ['session/new',        'session/new',        ['initialize', 'session/new']],
      ['after session/new',  'after session/new',  ['initialize', 'session/new']],
   ] as const)('[H] an abort while %s is pending '
      + 'ends the turn once the step returns', async (_label, hold, methods) => {
      const { result, ended, methods: sent } = await abortDuring(hold);
      expect(result).toStrictEqual(CANCELLED_RESULT);
      expect(sent).toEqual(methods);
      expect(ended).toBe(1);
   });

   it('[H] an abort during setup does not poison the session: the next prompt is a first turn', async () => {
      const held       = deferred();
      const controller = new AbortController();
      const { driver, agents, connect } = makeDriver(2);
      agents[0].respond('session/new', async () => { await held.promise; return ANSWERS['session/new']; });
      const first = driver.execute('one', { signal: controller.signal });
      await flush();
      controller.abort();
      held.resolve();
      expect((await first).cancelled).toBe(true);
      agents[0].exit(0);
      const second = await driver.execute('two');
      expect(second.sessionId).toBe('agent-sess-1');
      expect(Object.keys(second)).not.toContain('cancelled');
      expect(connect).toHaveBeenCalledTimes(2);
   });
});

describe('setup timeout', () => {
   beforeEach(() => { vi.useFakeTimers(); });
   afterEach(() => { vi.useRealTimers(); });

   it('[H] an abort does not interrupt a setup step; the setup timeout bounds it', async () => {
      const { driver, agents } = makeDriver();
      agents[0].respond('initialize', () => NEVER);
      const controller = new AbortController();
      let settled: unknown;
      const turn = driver.execute('go', { signal: controller.signal }).then(result => { settled = result; });
      await vi.advanceTimersByTimeAsync(1000);
      controller.abort();
      await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS - 1000 - 1);
      expect(settled).toBeUndefined();
      expect(agents[0].stdinCloses).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      await turn;
      expect(settled).toStrictEqual(CANCELLED_RESULT);
      expect(agents[0].stdinCloses).toBe(1);
      agents[0].exit(0);
   });

   it.each(['connect', 'initialize', 'session/new'] as const)(
      '[H] a %s that never answers fails the turn after the setup timeout, and the next prompt relaunches',
      async step => {
         const late = deferred();
         const { driver, agents, connect } = makeDriver(
            2, index => 0 === index && 'connect' === step ? late.promise : undefined,
         );
         if ('connect' !== step) { agents[0].respond(step, () => NEVER); }
         const failure = driver.execute('go').then(() => undefined, (err: unknown) => err);
         await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS);
         const error = await failure;
         expect(error).toBeInstanceOf(AgentSetupTimeoutError);
         expect((error as Error).message).toContain(step);
         if ('connect' !== step) { expect(agents[0].stdinCloses).toBe(1); }
         late.resolve();
         await flush();
         expect(agents[0].stdinCloses).toBe(1);
         agents[0].exit(0);
         await expect(driver.execute('again')).resolves.toMatchObject({ sessionId: 'agent-sess-1' });
         expect(connect).toHaveBeenCalledTimes(2);
      },
   );

   it('each setup step has its own timeout, and the turn itself has none', async () => {
      const { driver, agents } = makeDriver(1, () => new Promise<void>(resolve => setTimeout(resolve, 20000)));
      agents[0].respond('initialize',     afterMs(20000, ANSWERS.initialize));
      agents[0].respond('session/new',    afterMs(20000, ANSWERS['session/new']));
      agents[0].respond('session/prompt', afterMs(600000, { stopReason: 'end_turn' }));
      let result: any;
      const turn = driver.execute('go').then(r => { result = r; });
      await vi.advanceTimersByTimeAsync(3 * 20000);
      expect(agents[0].stdinCloses).toBe(0);
      await vi.advanceTimersByTimeAsync(600000);
      await turn;
      expect(result.sessionId).toBe('agent-sess-1');
      expect(agents[0].stdinCloses).toBe(0);
   });

   it('a step that answers just before the timeout leaves no stray timer', async () => {
      const { driver, agents } = makeDriver();
      agents[0].respond('initialize', afterMs(SETUP_TIMEOUT_MS - 1, ANSWERS.initialize));
      const turn = driver.execute('go');
      await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS - 1);
      await turn;
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS);
      expect(agents[0].stdinCloses).toBe(0);
   });
});
