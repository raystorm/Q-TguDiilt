import { afterEach, describe, expect, it, vi } from 'vitest';
import {
   CANCEL_DEADLINE_MS, OUTPUT_END_GRACE_MS, SETUP_TIMEOUT_MS, createAcpDriver,
} from '../acp-driver.js';
import {
   AGENT_FAILURE_KIND as KIND, AgentExitedError, AgentProtocolError, AgentRefusedError,
   AgentRequestError, AgentSetupTimeoutError, ModelUnavailableError,
} from '../errors.js';
import { ProviderAuthError, SessionCollapseError } from '../../../protocol/errors.js';
import type { AcpPolicy, UnsafeSetting } from '../types.js';
import { NEVER } from './fake-acp-agent.js';
import {
   LAUNCH, createDiagnostics, createLogger, deferred, flush, makeDriver,
} from './acp-driver.helpers.js';
import { abortableTurn, wrapUp } from './cancel.helpers.js';
import {
   ALLOW, NOT_LOGGED_IN, REJECT, SESSION, exitDuringInitialize, failingConnect, failureOf,
   rpcError,
} from './failures.helpers.js';
import { firstLine, heldSecondTurn, offeringModels } from './records.helpers.js';

afterEach(() => { vi.useRealTimers(); });

const SETUP_ANSWER = { protocolVersion: 1, agentCapabilities: {}, authMethods: [] };

/** One of the two errors a protocol failure can be, and the kind a record gives it. */
const isProtocolFailure = (error?: Error) =>
   error instanceof AgentProtocolError || error instanceof AgentRequestError;
const protocolKind = (error?: Error) =>
   error instanceof AgentProtocolError ? KIND.protocol : KIND.requestError;

/** A driver with a recording seam. */
function recorded(policy?: AcpPolicy, unsafe?: readonly UnsafeSetting[]) {
   const diagnostics = createDiagnostics();
   const made        = makeDriver(1, undefined, policy, unsafe, diagnostics);
   return { ...made, diagnostics, agent: made.agents[0] };
}

describe('an agent that exits', () => {
   it('[H] a crash during a turn: a complete record, written before the turn fails', async () => {
      const t = await heldSecondTurn();
      t.agent.stderr('fatal: out of memory\n');
      t.agent.exit(137);
      const error = await t.turn;
      expect(error).toBeInstanceOf(AgentExitedError);
      expect(t.recordsWhenFailed()).toBe(1);
      expect(t.diagnostics.records).toEqual([{
         kind:           KIND.exited,
         message:        firstLine(error!),
         driver:         'test',
         pid:            4000,
         agentSessionId: SESSION,
         exitCode:       137,
         tail:           'fatal: out of memory',
      }]);
      expect(t.diagnostics.records[0].message).toContain('exit code 137');
      expect(t.diagnostics.records[0].message).not.toContain('out of memory');
   });

   it('an agent ended by a signal has the signal and no exit code', async () => {
      const t = await heldSecondTurn();
      t.agent.exit(null, 'SIGSEGV');
      await t.turn;
      expect(t.diagnostics.records).toHaveLength(1);
      expect(t.diagnostics.records[0]).toMatchObject({ kind: KIND.exited, signal: 'SIGSEGV' });
      expect(t.diagnostics.records[0]).not.toHaveProperty('exitCode');
   });

   it('[H] a crash between turns is recorded once, and a later prompt adds nothing', async () => {
      const { driver, agent, diagnostics } = recorded();
      const first = await driver.execute('one');
      agent.stderr('died quietly\n');
      agent.exit(1);
      await flush();
      expect(diagnostics.records).toEqual([{
         kind:           KIND.exited,
         message:        expect.stringContaining('exit code 1'),
         driver:         'test',
         pid:            4000,
         agentSessionId: SESSION,
         exitCode:       1,
         tail:           'died quietly',
      }]);
      await expect(driver.execute('two', { sessionId: first.sessionId }))
         .rejects.toBeInstanceOf(SessionCollapseError);
      expect(diagnostics.records).toHaveLength(1);
   });

   it('an exit before the agent names a session has a pid and no session id', async () => {
      const diagnostics = createDiagnostics();
      await exitDuringInitialize('segmentation fault', 139, diagnostics);
      expect(diagnostics.records).toHaveLength(1);
      expect(diagnostics.records[0]).toMatchObject({ kind: KIND.exited, pid: 4000, exitCode: 139 });
      expect(diagnostics.records[0]).not.toHaveProperty('agentSessionId');
   });

   it('"not logged in" on exit is an authentication record', async () => {
      const diagnostics = createDiagnostics();
      const { error }   = await exitDuringInitialize(`${NOT_LOGGED_IN}\n`, 1, diagnostics);
      expect(error).toBeInstanceOf(ProviderAuthError);
      expect(diagnostics.records).toHaveLength(1);
      expect(diagnostics.records[0])
         .toMatchObject({ kind: KIND.authRequired, exitCode: 1, tail: NOT_LOGGED_IN });
   });

   it('[H] output ends, then the agent exits within the grace: one record, an exit', async () => {
      vi.useFakeTimers();
      const diagnostics = createDiagnostics();
      const t = await abortableTurn({}, 1, 'go', diagnostics);
      t.agent.stderr('bye\n');
      t.agent.endOutput();
      await flush();
      t.agent.exit(2);
      expect(await failureOf(t.turn)).toBeInstanceOf(AgentExitedError);
      await vi.advanceTimersByTimeAsync(OUTPUT_END_GRACE_MS);
      expect(diagnostics.records).toHaveLength(1);
      expect(diagnostics.records[0]).toMatchObject({ kind: KIND.exited, exitCode: 2, tail: 'bye' });
   });
});

describe('an agent that answers with an error', () => {
   it.each(['initialize', 'session/new', 'session/prompt'])(
      'an authentication-required answer to %s is one authentication record',
      async method => {
         const { driver, agent, diagnostics } = recorded();
         agent.respond(method, rpcError('Authentication required', -32000));
         expect(await failureOf(driver.execute('go'))).toBeInstanceOf(ProviderAuthError);
         expect(diagnostics.records.map(record => record.kind)).toEqual([KIND.authRequired]);
         agent.exit(0);
      },
   );

   it.each([
      ['session/prompt', true],
      ['session/new',    false],
   ])('another error answer to %s is a request record', async (method, hasSession) => {
      const { driver, agent, diagnostics } = recorded();
      agent.respond(method, rpcError('no capacity', -32603));
      expect(await failureOf(driver.execute('go'))).toBeInstanceOf(AgentRequestError);
      const [record] = diagnostics.records;
      expect(diagnostics.records).toHaveLength(1);
      expect(record).toMatchObject({ kind: KIND.requestError, pid: 4000 });
      expect(record.message).toContain(method);
      expect(record.message).toContain('no capacity');
      expect(undefined !== record.agentSessionId).toBe(hasSession);
      agent.exit(0);
   });

   it('[H] an error answer to the model change is one record, though two paths see it', async () => {
      const { driver, agent, diagnostics } = recorded();
      offeringModels(agent);
      agent.respond('session/set_config_option', rpcError('no switch', -32603));
      const error = await failureOf(driver.execute('go', { model: 'm2' }));
      expect(error).toBeInstanceOf(AgentRequestError);
      agent.exit(0);
      await flush();
      expect(diagnostics.records.map(record => record.kind)).toEqual([KIND.requestError]);
   });

   it('the model in the record is the one the agent has selected', async () => {
      const { driver, agent, diagnostics } = recorded();
      offeringModels(agent);
      const first = await driver.execute('one', { model: 'm2' });
      agent.respond('session/prompt', () => NEVER);
      const turn = failureOf(driver.execute('two', { sessionId: first.sessionId }));
      await flush();
      agent.exit(1);
      await turn;
      expect(diagnostics.records[0].model).toBe('m2');
   });

   it('an agent with no model option gives a record without a model', async () => {
      const t = await heldSecondTurn();
      t.agent.exit(1);
      await t.turn;
      expect(t.diagnostics.records[0]).not.toHaveProperty('model');
   });
});

describe('an agent that breaks the protocol', () => {
   it('[H] a closed output with a request waiting: one record, with the kind of the error', async () => {
      vi.useFakeTimers();
      const diagnostics = createDiagnostics();
      const t = await abortableTurn({}, 1, 'go', diagnostics);
      t.agent.stderr('closing time\n');
      t.agent.endOutput();
      const failure = failureOf(t.turn);
      await vi.advanceTimersByTimeAsync(OUTPUT_END_GRACE_MS * 4);
      const error = await failure;
      expect(isProtocolFailure(error)).toBe(true);
      expect(diagnostics.records).toHaveLength(1);
      expect(diagnostics.records[0])
         .toMatchObject({ kind: protocolKind(error), tail: 'closing time' });
      expect(diagnostics.records[0]).not.toHaveProperty('exitCode');
      await wrapUp(t);
   });

   const FOUND_AT_START: Array<[string, string, () => unknown]> = [
      ['an unsupported version', 'initialize',  () => ({ ...SETUP_ANSWER, protocolVersion: 99 })],
      ['no protocol version',    'initialize',  () => ({})],
      ['no session id',          'session/new', () => ({})],
   ];

   it.each(FOUND_AT_START)('[H] %s found at start-up is one record that matches the error',
      async (_label, method, answer) => {
         const { driver, agent, diagnostics } = recorded();
         agent.respond(method, answer);
         const error = await failureOf(driver.execute('go'));
         expect(isProtocolFailure(error)).toBe(true);
         expect(diagnostics.records.map(record => record.kind)).toEqual([protocolKind(error)]);
         agent.exit(0);
      });
});

describe('a start-up step that times out', () => {
   it('[H] carries the tail in the record, not in the message', async () => {
      vi.useFakeTimers();
      const { driver, agent, diagnostics } = recorded();
      agent.respond('initialize', () => NEVER);
      const failure = failureOf(driver.execute('go'));
      await flush();
      agent.stderr('CANARY-STDERR\n');
      await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS);
      const error = await failure;
      expect(error).toBeInstanceOf(AgentSetupTimeoutError);
      expect(error?.message).toContain('initialize');
      expect(error?.message).not.toContain('CANARY-STDERR');
      expect(diagnostics.records).toHaveLength(1);
      const [record] = diagnostics.records;
      expect(record).toMatchObject({ kind: KIND.setupTimeout, pid: 4000, tail: 'CANARY-STDERR' });
      expect(record).not.toHaveProperty('agentSessionId');
      expect(JSON.stringify(record).split('CANARY-STDERR')).toHaveLength(2);
      agent.exit(0);
   });

   it('the session/new step has its own record', async () => {
      vi.useFakeTimers();
      const { driver, agent, diagnostics } = recorded();
      agent.respond('session/new', () => NEVER);
      const failure = failureOf(driver.execute('go'));
      await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS);
      expect(await failure).toBeInstanceOf(AgentSetupTimeoutError);
      const [record] = diagnostics.records;
      expect(diagnostics.records).toHaveLength(1);
      expect(record).toMatchObject({ kind: KIND.setupTimeout, pid: 4000 });
      expect(record.message).toContain('session/new');
      expect(record).not.toHaveProperty('agentSessionId');
      agent.exit(0);
   });

   it('[H] a launch that never settles has no pid and no tail, and a late process adds nothing',
      async () => {
         vi.useFakeTimers();
         const diagnostics = createDiagnostics();
         const gate        = deferred();
         const { driver, agents } = makeDriver(
            1, () => gate.promise, undefined, undefined, diagnostics,
         );
         const failure = failureOf(driver.execute('go'));
         await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS);
         expect(await failure).toBeInstanceOf(AgentSetupTimeoutError);
         expect(diagnostics.records).toHaveLength(1);
         expect(diagnostics.records[0]).toMatchObject({ kind: KIND.setupTimeout });
         expect(diagnostics.records[0]).not.toHaveProperty('pid');
         expect(diagnostics.records[0]).not.toHaveProperty('tail');
         gate.resolve();
         await flush();
         expect(agents[0].stdinCloses).toBe(1);
         expect(diagnostics.records).toHaveLength(1);
         agents[0].exit(0);
      });
});

describe('an agent that cannot be started', () => {
   const withConnect = (error: Error) => {
      const diagnostics = createDiagnostics();
      const driver = createAcpDriver({
         name: 'test', connect: failingConnect(error), launch: LAUNCH, logger: createLogger(),
         diagnostics,
      });
      return { driver, diagnostics };
   };

   it('a command that is not found has no pid and no tail', async () => {
      const missing = Object.assign(new Error('spawn agent-cli ENOENT'), { code: 'ENOENT' });
      const { driver, diagnostics } = withConnect(missing);
      await failureOf(driver.execute('go'));
      expect(diagnostics.records).toHaveLength(1);
      expect(diagnostics.records[0]).toMatchObject({ kind: KIND.notStarted, driver: 'test' });
      expect(diagnostics.records[0].message).toContain('agent-cli');
      expect(diagnostics.records[0]).not.toHaveProperty('pid');
      expect(diagnostics.records[0]).not.toHaveProperty('tail');
   });

   it('another launch failure keeps the reason, redacted as in the error', async () => {
      const reason = 'spawn agent-cli EACCES token=abc123';
      const denied = Object.assign(new Error(reason), { code: 'EACCES' });
      const { driver, diagnostics } = withConnect(denied);
      const error = await failureOf(driver.execute('go'));
      const [record] = diagnostics.records;
      expect(diagnostics.records).toHaveLength(1);
      expect(record.kind).toBe(KIND.notStarted);
      expect(record.message).toContain('EACCES');
      expect(record.message).not.toContain('abc123');
      expect(error?.message).toContain(record.message);
   });
});

describe('each failure has its own record', () => {
   it('two agents that crash give two records with their own pids', async () => {
      const diagnostics = createDiagnostics();
      const { driver, agents } = makeDriver(2, undefined, undefined, undefined, diagnostics);
      for (const agent of agents) {
         agent.respond('session/prompt', () => NEVER);
         const turn = failureOf(driver.execute('go'));
         await agent.arrived('session/prompt');
         agent.exit(1);
         await turn;
      }
      expect(diagnostics.records.map(record => record.pid)).toEqual([4000, 4001]);
   });
});

describe('failures the driver finds itself', () => {
   it('[H] a policy refusal is a record with the pid and no exit', async () => {
      const { driver, agent, diagnostics } = recorded({ verifyInitialize: () => 'not allowed' });
      expect(await failureOf(driver.execute('go'))).toBeInstanceOf(AgentRefusedError);
      expect(diagnostics.records).toHaveLength(1);
      expect(diagnostics.records[0])
         .toMatchObject({ kind: KIND.refused, message: 'not allowed', pid: 4000 });
      expect(diagnostics.records[0]).not.toHaveProperty('exitCode');
      expect(diagnostics.records[0]).not.toHaveProperty('signal');
      agent.exit(0);
   });

   it('an unsafe setting at session start is a refused record', async () => {
      const unsafe = [{ name: 'blanket_approval', optionId: 'approval', values: ['on'] }];
      const { driver, agent, diagnostics } = recorded(undefined, unsafe);
      const approval = { id: 'approval', name: 'approval', type: 'select', currentValue: 'on', options: [] };
      agent.respond('session/new', () => ({ sessionId: SESSION, configOptions: [approval] }));
      expect(await failureOf(driver.execute('go'))).toBeInstanceOf(AgentRefusedError);
      expect(diagnostics.records.map(record => record.kind)).toEqual([KIND.refused]);
      agent.exit(0);
   });

   it('a model the agent does not offer is a record', async () => {
      const { driver, agent, diagnostics } = recorded();
      const error = await failureOf(driver.execute('go', { model: 'nope' }));
      expect(error).toBeInstanceOf(ModelUnavailableError);
      expect(diagnostics.records).toHaveLength(1);
      expect(diagnostics.records[0]).toMatchObject({ kind: KIND.modelUnavailable, pid: 4000 });
      expect(diagnostics.records[0].message).toContain('nope');
      agent.exit(0);
   });

   it('[H] a governance handler that throws is a record with the handler\'s own text', async () => {
      const { driver, agent, diagnostics } = recorded();
      agent.respond('session/prompt', async () => {
         void agent.request('session/request_permission', {
            sessionId: SESSION, toolCall: { toolCallId: 'a' }, options: [ALLOW, REJECT],
         });
         return NEVER;
      });
      const onToolCall = async () => { throw new Error('handler broke'); };
      const error      = await failureOf(driver.execute('go', { onToolCall }));
      expect(error?.message).toBe('handler broke');
      expect(diagnostics.records).toHaveLength(1);
      expect(diagnostics.records[0]).toMatchObject({
         kind: KIND.handlerFailed, message: 'handler broke', pid: 4000, agentSessionId: SESSION,
      });
      agent.exit(0);
   });

   it('[H] an agent that does not answer a cancel in time is one record, and its exit adds none',
      async () => {
         vi.useFakeTimers();
         const diagnostics = createDiagnostics();
         const t = await abortableTurn({}, 1, 'go', diagnostics);
         t.agent.stderr('still thinking\n');
         t.controller.abort();
         await vi.advanceTimersByTimeAsync(CANCEL_DEADLINE_MS);
         expect(await t.turn).toMatchObject({ cancelled: true });
         expect(diagnostics.records).toHaveLength(1);
         expect(diagnostics.records[0]).toMatchObject({
            kind: KIND.cancelTimeout, pid: 4000, agentSessionId: SESSION, tail: 'still thinking',
         });
         t.agent.exit(0);
         await vi.advanceTimersByTimeAsync(CANCEL_DEADLINE_MS);
         expect(diagnostics.records).toHaveLength(1);
      });

   it('[H] an agent that answers the cancel a moment before the deadline gives no record',
      async () => {
         vi.useFakeTimers();
         const diagnostics = createDiagnostics();
         const t = await abortableTurn({}, 1, 'go', diagnostics);
         t.controller.abort();
         await vi.advanceTimersByTimeAsync(CANCEL_DEADLINE_MS - 1);
         t.finish({ stopReason: 'cancelled' });
         expect(await t.turn).toMatchObject({ cancelled: true });
         await vi.advanceTimersByTimeAsync(CANCEL_DEADLINE_MS);
         expect(diagnostics.records).toEqual([]);
         await wrapUp(t);
      });

   it('[H] an agent that crashes after the cancel is recorded, and the turn settles cancelled',
      async () => {
         const diagnostics = createDiagnostics();
         const t = await abortableTurn({}, 1, 'go', diagnostics);
         t.controller.abort();
         await flush();
         t.agent.exit(1);
         expect(await t.turn).toMatchObject({ cancelled: true });
         expect(diagnostics.records.map(record => record.kind)).toEqual([KIND.exited]);
      });
});
