import { describe, it, expect, afterEach, vi } from 'vitest';
import { createAcpDriver } from '../acp-driver.js';
import {
   AgentExitedError, AgentLaunchError, AgentNotFoundError, AgentProtocolError, AgentRequestError,
} from '../errors.js';
import { STDERR_TAIL_MAX_BYTES, STDERR_TAIL_MAX_LINES } from '../stderr-tail.js';
import { ProviderAuthError, boundaryErrorKind } from '../../../protocol/errors.js';
import { SECRET_LINES } from '../../../shared/__tests__/redaction.helpers.js';
import {
   LAUNCH, createDiagnostics, createLogger, makeDriver, sent,
} from './acp-driver.helpers.js';
import {
   NOT_LOGGED_IN, exitDuringInitialize, failingConnect, failureOf, logged, rpcError,
} from './failures.helpers.js';

afterEach(() => { vi.useRealTimers(); });

describe('a command that cannot start', () => {
   it('[H] a missing binary is an error that names the command and says what to do, and leaves no timer', async () => {
      vi.useFakeTimers();
      const missing = Object.assign(new Error('spawn agent-cli ENOENT'), { code: 'ENOENT' });
      const driver  = createAcpDriver({
         name: 'test', connect: failingConnect(missing), launch: LAUNCH, logger: createLogger(),
         diagnostics: createDiagnostics(),
      });
      const error = await failureOf(driver.execute('go'));
      expect(error).toBeInstanceOf(AgentNotFoundError);
      expect(error?.message).toContain('agent-cli');
      expect(error?.message).toMatch(/install it or fix PATH/);
      expect(vi.getTimerCount()).toBe(0);
   });

   it('any other failure to start names the command and the reason', async () => {
      const denied = Object.assign(new Error('spawn agent-cli EACCES'), { code: 'EACCES' });
      const driver = createAcpDriver({
         name: 'test', connect: failingConnect(denied), launch: LAUNCH, logger: createLogger(),
         diagnostics: createDiagnostics(),
      });
      const error = await failureOf(driver.execute('go'));
      expect(error).toBeInstanceOf(AgentLaunchError);
      expect(error?.message).toContain('"agent-cli"');
      expect(error?.message).toContain('EACCES');
   });

   it('[H] a working directory with shell metacharacters reaches session/new unchanged, '
      + 'and launch takes an argument array', async () => {
      const weird = '/tmp/a b/\'quoted\';$(touch pwned)/"dq"';
      const spy   = vi.spyOn(process, 'cwd').mockReturnValue(weird);
      try {
         const { driver, agents, connect } = makeDriver();
         await driver.execute('go');
         expect(connect).toHaveBeenCalledWith({ ...LAUNCH, cwd: weird });
         expect(Array.isArray(connect.mock.calls[0][0].args)).toBe(true);
         expect(sent(agents[0], 'session/new')[0].cwd).toBe(weird);
      }
      finally { spy.mockRestore(); }
   });
});

describe('the agent exits before it is set up', () => {
   it('[H] the error carries the exit code and what the agent printed, and the turn does not hang', async () => {
      const { error } = await exitDuringInitialize('segmentation fault', 139);
      expect(error).toBeInstanceOf(AgentExitedError);
      expect(error?.message).toContain('exit code 139');
      expect(error?.message).toContain('segmentation fault');
   });

   it('[H] "not logged in" is a provider authentication error that keeps the text, '
      + 'and nothing is authenticated', async () => {
      const { error, agent } = await exitDuringInitialize(`${NOT_LOGGED_IN}\n`);
      expect(error).toBeInstanceOf(ProviderAuthError);
      expect(boundaryErrorKind(error)).toBe('provider_auth');
      expect(error?.message).toMatch(/log in with the agent's own login command/);
      expect(error?.message).toContain(NOT_LOGGED_IN);
      expect(agent.methods()).not.toContain('authenticate');
   });

   it.each([
      'keyboard layout not found',
      'monkey patch applied',
      'the security of the build is unaffected',
   ])('ordinary words are not redacted: %s', async text => {
      const { error } = await exitDuringInitialize(`${text}\n`);
      expect(error).toBeInstanceOf(AgentExitedError);
      expect(error?.message).toContain(text);
   });
});

describe('authentication failures from the agent', () => {
   it.each(['initialize', 'session/new', 'session/prompt'])(
      '[H] an authentication-required answer to %s is a provider authentication error, with the agent output',
      async method => {
         const { driver, agents } = makeDriver();
         agents[0].respond(method, rpcError('Authentication required', -32000));
         agents[0].stderr('run: copilot login\n');
         const error = await failureOf(driver.execute('go'));
         expect(error).toBeInstanceOf(ProviderAuthError);
         expect(boundaryErrorKind(error)).toBe('provider_auth');
         expect(error?.message).toMatch(/log in with the agent's own login command/);
         expect(error?.message).toContain('run: copilot login');
         expect(agents[0].methods()).not.toContain('authenticate');
         agents[0].exit(0);
      },
   );

   it('any other error answer is an ordinary actionable error '
      + 'naming the request and the agent\'s message', async () => {
      const { driver, agents } = makeDriver();
      agents[0].respond('session/new', rpcError('no capacity', -32603));
      const error = await failureOf(driver.execute('go'));
      expect(error).toBeInstanceOf(AgentRequestError);
      expect(error?.message).toContain('session/new');
      expect(error?.message).toContain('no capacity');
      agents[0].exit(0);
   });

   it('a protocol failure is not an authentication error', async () => {
      const { driver, agents } = makeDriver();
      agents[0].respond('initialize', () => ({ protocolVersion: 99, agentCapabilities: {}, authMethods: [] }));
      const error = await failureOf(driver.execute('go'));
      expect(error).toBeInstanceOf(AgentProtocolError);
      expect(boundaryErrorKind(error)).toBeUndefined();
      agents[0].exit(0);
   });
});

describe('secrets in the agent output', () => {
   it.each(SECRET_LINES)('[H] %s stays out of the error and the log, '
      + 'and the rest of the line is kept', async (_label, secretText, secrets) => {
      const { error, logger } = await exitDuringInitialize(`startup failed: ${secretText} (while starting)\n`);
      expect(error).toBeInstanceOf(AgentExitedError);
      for (const secret of secrets) {
         expect(error?.message).not.toContain(secret);
         expect(logged(logger)).not.toContain(secret);
      }
      expect(error?.message).toContain('startup failed:');
      expect(error?.message).toContain('(while starting)');
   });

   it('the output in an error is bounded and keeps the end', async () => {
      const output = Array.from({ length: 50000 }, (_, i) => `line ${String(i).padStart(5, '0')} xxxxxxxx`);
      const { error } = await exitDuringInitialize(`${output.join('\n')}\n`);
      const printed = (error?.message ?? '').split('\n');
      expect(printed.length).toBeLessThanOrEqual(STDERR_TAIL_MAX_LINES + 3);
      expect(error?.message).toContain('line 49999');
      expect(error?.message).not.toContain('line 00000');
      expect(Buffer.byteLength(error?.message ?? '')).toBeLessThan(STDERR_TAIL_MAX_BYTES + 300);
   });
});
