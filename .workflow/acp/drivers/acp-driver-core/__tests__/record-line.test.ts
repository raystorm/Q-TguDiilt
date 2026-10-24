import { afterEach, describe, expect, it, vi } from 'vitest';
import { OUTPUT_END_GRACE_MS, SETUP_TIMEOUT_MS, createAcpDriver } from '../acp-driver.js';
import type { Diagnostics } from '../../../shared/diagnostic-log.js';
import { NEVER } from './fake-acp-agent.js';
import {
   DIAGNOSTICS_PATH, type FakeAgent, LAUNCH, createDiagnostics, createLogger, makeDriver,
} from './acp-driver.helpers.js';
import { abortableTurn, wrapUp } from './cancel.helpers.js';
import {
   NOT_LOGGED_IN, SESSION, failingConnect, failureOf, rpcError,
} from './failures.helpers.js';

afterEach(() => { vi.useRealTimers(); });

const LINE         = `full record: ${DIAGNOSTICS_PATH}`;
const SETUP_ANSWER = { protocolVersion: 1, agentCapabilities: {}, authMethods: [] };
const lastLine     = (error?: Error) => (error?.message ?? '').split('\n').pop();

/** The agent prints `stderr` (when there is some) and exits while `initialize` is unanswered. */
const exits = (stderr: string, code: number | null, signal: string | null = null) =>
   (agent: FakeAgent) => agent.respond('initialize', () => {
      if ('' !== stderr) { agent.stderr(stderr); }
      agent.exit(code, signal);
      return NEVER;
   });

/** The failure types that end with the line. */
const CASES: Array<[string, (agent: FakeAgent) => void]> = [
   ['an exit by code',   exits('boom\n', 1)],
   ['an exit by signal', exits('boom\n', null, 'SIGTERM')],
   ['an error answer',   agent => agent.respond('session/new', rpcError('no capacity', -32603))],
   ['a protocol failure', agent =>
      agent.respond('initialize', () => ({ ...SETUP_ANSWER, protocolVersion: 99 }))],
   ['"not logged in" by exit text', exits(`${NOT_LOGGED_IN}\n`, 1)],
   ['"authentication required" by answer', agent =>
      agent.respond('initialize', rpcError('Authentication required', -32000))],
];

/** One turn against an agent set up by `setup`; resolves with the turn's error. */
async function failing(setup: (agent: FakeAgent) => void, diagnostics?: Diagnostics) {
   const { driver, agents } = makeDriver(1, undefined, undefined, undefined, diagnostics);
   setup(agents[0]);
   const error = await failureOf(driver.execute('go'));
   agents[0].exit(0);
   return error;
}

describe('the chat error names the file', () => {
   it.each(CASES)('[H] %s ends with the line', async (_label, setup) => {
      expect(lastLine(await failing(setup, createDiagnostics()))).toBe(LINE);
   });

   it('the line follows the tail, or the summary when there is no tail', async () => {
      const printed = (await failing(exits('boom\n', 1), createDiagnostics()))?.message.split('\n');
      expect(printed).toHaveLength(4);
      expect(printed?.[1]).toContain('the agent printed');
      expect(printed?.[2]).toBe('boom');
      const quiet = (await failing(exits('', 1), createDiagnostics()))?.message.split('\n');
      expect(quiet).toHaveLength(2);
      expect(quiet?.[1]).toBe(LINE);
   });

   it.each(['initialize', 'session/new'])('a start-up timeout at %s has the line and no tail',
      async step => {
         vi.useFakeTimers();
         const { driver, agents } = makeDriver(1, undefined, undefined, undefined, createDiagnostics());
         agents[0].respond(step, () => NEVER);
         agents[0].stderr('CANARY-STDERR\n');
         const failure = failureOf(driver.execute('go'));
         await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS);
         const error = await failure;
         expect(lastLine(error)).toBe(LINE);
         expect(error?.message).not.toContain('CANARY-STDERR');
         expect(error?.message).not.toContain('the agent printed');
         agents[0].exit(0);
      });

   it('a launch timeout has the line', async () => {
      vi.useFakeTimers();
      const { driver } = makeDriver(
         1, () => new Promise(() => undefined), undefined, undefined, createDiagnostics(),
      );
      const failure = failureOf(driver.execute('go'));
      await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS);
      expect(lastLine(await failure)).toBe(LINE);
   });

   it('a closed output has the line', async () => {
      vi.useFakeTimers();
      const t = await abortableTurn({}, 1, 'go', createDiagnostics());
      t.agent.endOutput();
      const failure = failureOf(t.turn);
      await vi.advanceTimersByTimeAsync(OUTPUT_END_GRACE_MS * 4);
      expect(lastLine(await failure)).toBe(LINE);
      await wrapUp(t);
   });

   it.each([
      ['a command that is not found', 'ENOENT'],
      ['another launch failure',      'EACCES'],
   ])('%s has the line', async (_label, code) => {
      const diagnostics = createDiagnostics();
      const driver = createAcpDriver({
         name: 'test', connect: failingConnect(Object.assign(new Error('spawn'), { code })),
         launch: LAUNCH, logger: createLogger(), diagnostics,
      });
      expect(lastLine(await failureOf(driver.execute('go')))).toBe(LINE);
   });

   it('[H] a long folder name is not mangled in the line', async () => {
      const path  = '/work/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6/acp-diagnostic.log';
      const error = await failing(exits('boom\n', 1), createDiagnostics(path));
      expect(lastLine(error)).toBe(`full record: ${path}`);
   });
});

describe('no line when there is no file', () => {
   it.each(CASES)('[H] %s has no line when the file could not be opened', async (_label, setup) => {
      const error = await failing(setup, createDiagnostics(null));
      expect(error).toBeDefined();
      expect(error?.message).not.toContain('full record:');
   });

   it.each(CASES)('[H] %s has no line when the driver has no diagnostics', async (_label, setup) => {
      const error = await failing(setup);
      expect(error).toBeDefined();
      expect(error?.message).not.toContain('full record:');
   });
});

describe('the other errors have no line', () => {
   it('a policy refusal, a model the agent does not offer, a collapse', async () => {
      const made = (policy?: object) =>
         makeDriver(1, undefined, policy, undefined, createDiagnostics());
      const refused = await failureOf(made({ verifyInitialize: () => 'not allowed' }).driver.execute('go'));
      const model   = await failureOf(made().driver.execute('go', { model: 'nope' }));
      const gone    = await failureOf(made().driver.execute('go', { sessionId: SESSION }));
      for (const error of [refused, model, gone]) {
         expect(error).toBeDefined();
         expect(error?.message).not.toContain('full record:');
      }
   });
});
