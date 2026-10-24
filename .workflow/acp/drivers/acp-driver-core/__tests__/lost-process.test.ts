import { describe, it, expect, afterEach, vi } from 'vitest';
import { SETUP_TIMEOUT_MS } from '../acp-driver.js';
import {
   AgentExitedError, AgentProtocolError, AgentRequestError, AgentSetupTimeoutError, ModelUnavailableError,
} from '../errors.js';
import { SessionCollapseError } from '../../../protocol/errors.js';
import { NEVER } from './fake-acp-agent.js';
import { createDiagnostics, deferred, flush, makeDriver } from './acp-driver.helpers.js';
import { ALLOW, REJECT, SESSION, entries, failureOf, logged } from './failures.helpers.js';

afterEach(() => { vi.useRealTimers(); });

const SETUP_ANSWER = { protocolVersion: 1, agentCapabilities: {}, authMethods: [] };

describe('a process that is lost', () => {
   it('[H] a crash in a turn fails it with the exit code and the output, '
      + 'and the old session is a collapse', async () => {
      const { driver, agents, connect, logger } = makeDriver(2);
      agents[1].respond('session/new', () => ({ sessionId: 'agent-sess-2' }));
      const first = await driver.execute('one');
      agents[0].respond('session/prompt', () => NEVER);
      const turn = failureOf(driver.execute('two', { sessionId: first.sessionId }));
      await flush();
      agents[0].stderr('fatal: out of memory\n');
      agents[0].exit(137);
      const error = await turn;
      expect(error).toBeInstanceOf(AgentExitedError);
      expect(error?.message).toContain('exit code 137');
      expect(error?.message).toContain('out of memory');
      expect(agents[0].stdinCloses).toBe(0);
      expect(agents[0].kills).toEqual([]);
      await flush();
      expect(entries(logger, 'agent_process_ended'))
         .toEqual([{ pid: 4000, agentSessionId: SESSION, reason: 'crash', stage: 'none' }]);

      await expect(driver.execute('three', { sessionId: first.sessionId }))
         .rejects.toBeInstanceOf(SessionCollapseError);
      expect(connect).toHaveBeenCalledTimes(1);

      const fresh = await driver.execute('four');
      expect(connect).toHaveBeenCalledTimes(2);
      expect(fresh.sessionId).toBe('agent-sess-2');
      expect(entries(logger, 'agent_relaunched')).toEqual([{ pid: 4001, after: 'crash' }]);
   });

   it('the first launch is not a relaunch, and neither is one after an abort', async () => {
      const { driver, agents, logger } = makeDriver(3);
      await driver.execute('one');
      const controller = new AbortController();
      agents[1].respond('session/new', () => { controller.abort(); return { sessionId: 'agent-sess-2' }; });
      await driver.execute('two', { signal: controller.signal });
      agents[1].exit(0);
      await driver.execute('three');
      expect(entries(logger, 'agent_relaunched')).toEqual([]);
   });

   it.each([
      ['session/new answers with a JSON-RPC error', 'session/new',
         () => { throw new Error('no capacity'); }, [AgentRequestError]],
      ['initialize answers without a protocolVersion', 'initialize',
         () => ({}), [AgentProtocolError, AgentRequestError]],
      ['session/new answers without a sessionId', 'session/new',
         () => ({}), [AgentProtocolError, AgentRequestError]],
      ['initialize answers with an unsupported version', 'initialize',
         () => ({ ...SETUP_ANSWER, protocolVersion: 99 }), [AgentProtocolError]],
   ] as Array<[string, string, () => unknown, Array<new (...args: any[]) => Error>]>)(
      '[H] when %s the turn fails, not cancelled, and the process is ended',
      async (_label, method, answer, errors) => {
         const { driver, agents, logger } = makeDriver();
         agents[0].respond(method, answer);
         const error = await failureOf(driver.execute('go'));
         expect(errors.some(type => error instanceof type)).toBe(true);
         expect(agents[0].stdinCloses).toBe(1);
         agents[0].exit(0);
         await flush();
         expect(entries(logger, 'agent_process_ended'))
            .toEqual([{ pid: 4000, reason: 'protocol_failure', stage: 'stdin_closed' }]);
      },
   );

   it('[H] a permission request still open when the connection is declared dead '
      + 'is not answered with an allow', async () => {
      const { driver, agents } = makeDriver();
      const agent   = agents[0];
      const gate    = deferred<'approve'>();
      const asked   = deferred();
      const failure = new Error('handler broke');
      let held: Promise<any> | undefined;
      agent.respond('session/prompt', async () => {
         held = agent.request('session/request_permission', {
            sessionId: SESSION, toolCall: { toolCallId: 'a', title: 'held' }, options: [ALLOW, REJECT],
         });
         await asked.promise;
         void agent.request('session/request_permission', {
            sessionId: SESSION, toolCall: { toolCallId: 'b', title: 'breaks' }, options: [ALLOW, REJECT],
         });
         return NEVER;
      });
      const onToolCall = async (report: { title: string }) => {
         if ('held' !== report.title) { throw failure; }
         asked.resolve();
         return gate.promise;
      };
      expect(await failureOf(driver.execute('go', { onToolCall }))).toBe(failure);
      gate.resolve('approve');
      expect((await held)?.result.outcome).toEqual({ outcome: 'cancelled' });
      agent.exit(0);
   });

   it('a late answer from the handler after a crash is harmless', async () => {
      const { driver, agents } = makeDriver();
      const agent = agents[0];
      const gate  = deferred<'approve'>();
      const asked = deferred();
      agent.respond('session/prompt', async () => {
         void agent.request('session/request_permission', {
            sessionId: SESSION, toolCall: { toolCallId: 'a' }, options: [ALLOW, REJECT],
         });
         return NEVER;
      });
      const turn = failureOf(driver.execute('go', { onToolCall: () => { asked.resolve(); return gate.promise; } }));
      await asked.promise;
      agent.exit(1);
      expect(await turn).toBeInstanceOf(AgentExitedError);
      gate.resolve('approve');
      await flush();
   });

   it('[H] a handler that fails ends the process, is logged as such, and the session is a collapse', async () => {
      const { driver, agents, logger } = makeDriver();
      const agent   = agents[0];
      const failure = new Error('handler broke');
      agent.respond('session/prompt', async () => {
         void agent.request('session/request_permission', {
            sessionId: SESSION, toolCall: { toolCallId: 'a' }, options: [ALLOW, REJECT],
         });
         return NEVER;
      });
      const error = await failureOf(driver.execute('go', { onToolCall: async () => { throw failure; } }));
      expect(error).toBe(failure);
      agent.exit(0);
      await flush();
      expect(entries(logger, 'agent_process_ended'))
         .toEqual([{ pid: 4000, agentSessionId: SESSION, reason: 'handler_failure', stage: 'stdin_closed' }]);
      await expect(driver.execute('again', { sessionId: SESSION })).rejects.toBeInstanceOf(SessionCollapseError);
   });

   it('a model the agent does not offer ends the process with its own reason', async () => {
      const { driver, agents, logger } = makeDriver();
      const error = await failureOf(driver.execute('go', { model: 'nope' }));
      expect(error).toBeInstanceOf(ModelUnavailableError);
      agents[0].exit(0);
      await flush();
      expect(entries(logger, 'agent_process_ended'))
         .toEqual([{ pid: 4000, agentSessionId: SESSION, reason: 'model_unavailable', stage: 'stdin_closed' }]);
   });
});

describe('setup abort and process end entries', () => {
   it('an abort before anything starts is logged as step entry, with no pid', async () => {
      const { driver, logger } = makeDriver();
      const controller = new AbortController();
      controller.abort();
      await driver.execute('go', { signal: controller.signal });
      expect(entries(logger, 'agent_setup_aborted')).toEqual([{ step: 'entry' }]);
   });

   it.each([
      ['launch',      'launch'],
      ['initialize',  'initialize'],
      ['session/new', 'session_new'],
   ])('an abort seen after %s is logged as step %s, and the end as an abort', async (held, step) => {
      const controller = new AbortController();
      const { driver, agents, logger } = makeDriver(
         1, 'launch' === held ? () => { controller.abort(); return undefined; } : undefined,
      );
      if ('initialize' === held) {
         agents[0].respond('initialize', () => { controller.abort(); return SETUP_ANSWER; });
      }
      if ('session/new' === held) {
         agents[0].respond('session/new', () => { controller.abort(); return { sessionId: SESSION }; });
      }
      await driver.execute('go', { signal: controller.signal });
      agents[0].exit(0);
      await flush();
      expect(entries(logger, 'agent_setup_aborted')).toEqual([{ step, pid: 4000 }]);
      expect(entries(logger, 'agent_process_ended'))
         .toEqual([{ pid: 4000, reason: 'aborted_during_setup', stage: 'stdin_closed' }]);
   });

   it('a setup step that times out is logged as such', async () => {
      vi.useFakeTimers();
      const { driver, agents, logger } = makeDriver();
      agents[0].respond('initialize', () => NEVER);
      const failure = failureOf(driver.execute('go'));
      await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS);
      expect(await failure).toBeInstanceOf(AgentSetupTimeoutError);
      agents[0].exit(0);
      await flush();
      expect(entries(logger, 'agent_process_ended'))
         .toEqual([{ pid: 4000, reason: 'setup_timeout', stage: 'stdin_closed' }]);
   });

   it('an exit before setup is logged as a failed launch', async () => {
      const { driver, agents, logger } = makeDriver();
      agents[0].respond('initialize', () => NEVER);
      const failure = failureOf(driver.execute('go'));
      await flush();
      agents[0].exit(1);
      expect(await failure).toBeInstanceOf(AgentExitedError);
      await flush();
      expect(entries(logger, 'agent_process_ended'))
         .toEqual([{ pid: 4000, reason: 'launch_failure', stage: 'none' }]);
   });

   it('closing the driver logs the end of each process as a disconnect, once', async () => {
      const { driver, agents, logger } = makeDriver();
      await driver.execute('go');
      const closing = driver.close();
      agents[0].exit(0);
      await closing;
      await driver.close();
      expect(entries(logger, 'agent_process_ended'))
         .toEqual([{ pid: 4000, agentSessionId: SESSION, reason: 'disconnect', stage: 'stdin_closed' }]);
   });
});

describe('what the core logs', () => {
   it('[H] no entry holds prompt text, context, agent text, a title, a diff, '
      + 'raw input or the agent output', async () => {
      const diagnostics = createDiagnostics();
      const { driver, agents, logger } = makeDriver(
         2, undefined, undefined, undefined, diagnostics,
      );
      const agent = agents[0];
      agent.respond('session/prompt', async () => {
         await agent.notify('session/update', {
            sessionId: SESSION,
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'CANARY-AGENT-TEXT' } },
         });
         await agent.notify('session/update', {
            sessionId: SESSION,
            update: {
               sessionUpdate: 'tool_call', toolCallId: 'u1', title: 'CANARY-TITLE', kind: 'edit', status: 'in_progress',
               rawInput: { command: 'CANARY-RAW' },
               content: [{ type: 'diff', path: '/r/a.ts', oldText: 'CANARY-OLD', newText: 'CANARY-NEW' }],
            },
         });
         await agent.request('session/request_permission', {
            sessionId: SESSION,
            toolCall:  { toolCallId: 'r1', title: 'CANARY-REQ-TITLE', rawInput: { command: 'CANARY-REQ-RAW' } },
            options:   [REJECT],
         });
         await agent.request('session/request_permission', {
            sessionId: 'CANARY-OTHER', toolCall: { toolCallId: 'r2' }, options: [ALLOW, REJECT],
         });
         await flush();
         return { stopReason: 'end_turn' };
      });
      const result = await driver.execute(
         'CANARY-PROMPT', { context: 'CANARY-CONTEXT', onToolCall: async () => 'approve' as const },
      );
      expect(result.text).toBe('CANARY-AGENT-TEXT');

      agents[1].respond('initialize', () => NEVER);
      const failure = failureOf(driver.execute('another'));
      await flush();
      agents[1].stderr('CANARY-STDERR\n');
      agents[1].exit(1);
      expect((await failure)?.message).toContain('CANARY-STDERR');

      const closing = driver.close();
      agent.exit(0);
      await closing;
      for (const canary of [
         'CANARY-AGENT-TEXT', 'CANARY-TITLE', 'CANARY-RAW', 'CANARY-OLD', 'CANARY-NEW', 'CANARY-REQ',
         'CANARY-PROMPT', 'CANARY-CONTEXT', 'CANARY-STDERR',
      ]) {
         expect(logged(logger)).not.toContain(canary);
      }
      // The id a request names is the one thing an unknown-session entry holds.
      expect(logged(logger).replace('CANARY-OTHER', '')).not.toContain('CANARY');

      // The record holds the agent's last words once, and none of the user's content.
      const recorded = JSON.stringify(diagnostics.records);
      expect(diagnostics.records).toHaveLength(1);
      expect(recorded.split('CANARY-STDERR')).toHaveLength(2);
      for (const canary of [
         'CANARY-AGENT-TEXT', 'CANARY-TITLE', 'CANARY-RAW', 'CANARY-OLD', 'CANARY-NEW',
         'CANARY-REQ', 'CANARY-PROMPT', 'CANARY-CONTEXT', 'CANARY-OTHER',
      ]) {
         expect(recorded).not.toContain(canary);
      }
   });
});
