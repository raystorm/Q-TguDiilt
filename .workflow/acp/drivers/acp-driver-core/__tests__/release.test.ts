import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionCollapseError } from '../../../protocol/errors.js';
import { ENDING_KILL_DELAY_MS, ENDING_TERM_DELAY_MS } from '../ending.js';
import {
   createDiagnostics, deferred, flush, makeDriver, type RecordingDiagnostics,
} from './acp-driver.helpers.js';
import { type Logger, entries, failureOf } from './failures.helpers.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(()  => { vi.useRealTimers(); });

const sessionOf = (index: number) => `agent-sess-${index + 1}`;

const chunk = (text: string) => ({
   sessionUpdate: 'agent_message_chunk', content: { type: 'text', text },
});

/**
 * A core driver over fake agents. Each agent answers `session/new` with its own id and exits
 * when its stdin closes, as a real agent does, unless its index is in `stubborn`.
 */
function setup(
   count = 2,
   diagnostics: RecordingDiagnostics = createDiagnostics(),
   stubborn: readonly number[] = [],
) {
   const made = makeDriver(count, undefined, undefined, undefined, diagnostics);
   made.agents.forEach((agent, index) => {
      agent.respond('session/new', () => ({ sessionId: sessionOf(index) }));
      if (stubborn.includes(index)) { return; }
      const closeStdin = agent.handle.closeStdin;
      agent.handle.closeStdin = () => { closeStdin(); agent.exit(0); };
   });
   return { ...made, diagnostics };
}

/** Two sessions, each opened by a turn without a session id. */
async function openTwo(driver: ReturnType<typeof setup>['driver']) {
   const a = await driver.execute('a');
   const b = await driver.execute('b');
   return { a: a.sessionId, b: b.sessionId };
}

/** The reason of each `agent_process_ended` entry, by agent session id. */
const reasonsOf = (logger: Logger) => Object.fromEntries(
   entries(logger, 'agent_process_ended').map(entry => [entry.agentSessionId, entry.reason]),
);

describe('release', () => {
   it('ends that session\'s agent through the ending sequence and logs it', async () => {
      const { driver, agents, logger } = setup();
      const { a } = await openTwo(driver);
      await driver.release(a);
      expect(agents[0].stdinCloses).toBe(1);
      expect(agents[1].stdinCloses).toBe(0);
      expect(entries(logger, 'agent_process_ended')).toEqual([
         { pid: 4000, agentSessionId: a, reason: 'release', stage: 'stdin_closed' },
      ]);
   });

   it('[H] a stubborn agent is ended in steps, and only that agent', async () => {
      const { driver, agents, logger } = setup(2, createDiagnostics(), [0]);
      const { a } = await openTwo(driver);
      const started = Date.now();
      let done = false;
      const releasing = driver.release(a).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(ENDING_TERM_DELAY_MS + ENDING_KILL_DELAY_MS);
      expect(done).toBe(false);
      expect(agents[0].kills.map(kill => [kill.signal, kill.at - started])).toEqual([
         ['SIGTERM', ENDING_TERM_DELAY_MS],
         ['SIGKILL', ENDING_TERM_DELAY_MS + ENDING_KILL_DELAY_MS],
      ]);
      agents[0].exit(null, 'SIGKILL');
      await releasing;
      expect(entries(logger, 'agent_process_ended')).toEqual([
         { pid: 4000, agentSessionId: a, reason: 'release', stage: 'sigkill' },
      ]);
      expect(agents[1].stdinCloses).toBe(0);
      expect(agents[1].kills).toEqual([]);
   });

   it('[H] a turn on another session is not disturbed', async () => {
      const { driver, agents } = setup();
      const { a, b } = await openTwo(driver);
      const gate = deferred();
      agents[1].respond('session/prompt', async () => {
         await gate.promise;
         await agents[1].notify('session/update', { sessionId: b, update: chunk('still here') });
         return { stopReason: 'end_turn' };
      });
      const turn = driver.execute('again', { sessionId: b });
      await flush();
      await driver.release(a);
      gate.resolve();
      expect(await turn).toStrictEqual({ text: 'still here', sessionId: b, toolCalls: [] });
      expect(agents[1].stdinCloses).toBe(0);
   });

   it('a release is not a loss', async () => {
      const diagnostics = createDiagnostics();
      const { driver, logger } = setup(3, diagnostics);
      const { a } = await openTwo(driver);
      await driver.release(a);
      await driver.execute('fresh');
      expect(diagnostics.records).toEqual([]);
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
      expect(entries(logger, 'agent_relaunched')).toEqual([]);
   });

   it('[H] the exit that follows a release records nothing', async () => {
      const diagnostics = createDiagnostics();
      const { driver, agents, logger } = setup(1, diagnostics, [0]);
      const first = await driver.execute('a');
      const releasing = driver.release(first.sessionId);
      await flush();
      agents[0].exit(0);
      await releasing;
      await flush();
      expect(diagnostics.records).toEqual([]);
      expect(entries(logger, 'agent_process_ended')).toEqual([
         { pid: 4000, agentSessionId: first.sessionId, reason: 'release', stage: 'stdin_closed' },
      ]);
   });

   it('[H] a release does not replace a pending loss', async () => {
      const { driver, agents, logger } = setup(3);
      const { b } = await openTwo(driver);
      agents[0].exit(137);
      await flush();
      await driver.release(b);
      await driver.execute('fresh');
      expect(entries(logger, 'agent_relaunched')).toEqual([{ pid: 4002, after: 'crash' }]);
   });

   it('releasing a session whose process already died does nothing', async () => {
      const diagnostics = createDiagnostics();
      const { driver, agents, logger } = setup(1, diagnostics);
      const first = await driver.execute('a');
      agents[0].exit(1);
      await flush();
      const recorded = [...diagnostics.records];
      expect(entries(logger, 'agent_process_ended')).toEqual([
         expect.objectContaining({ reason: 'crash' }),
      ]);
      await expect(driver.release(first.sessionId)).resolves.toBeUndefined();
      expect(entries(logger, 'agent_process_ended')).toHaveLength(1);
      expect(diagnostics.records).toEqual(recorded);
   });

   it('[H] the first reason for an ending wins, in either order', async () => {
      const closeFirst = setup();
      const one = await openTwo(closeFirst.driver);
      await closeFirst.driver.close();
      await closeFirst.driver.release(one.a);
      expect(reasonsOf(closeFirst.logger))
         .toEqual({ [one.a]: 'disconnect', [one.b]: 'disconnect' });
      expect(closeFirst.agents.map(agent => agent.stdinCloses)).toEqual([1, 1]);

      const releaseFirst = setup();
      const two = await openTwo(releaseFirst.driver);
      await releaseFirst.driver.release(two.a);
      await releaseFirst.driver.close();
      expect(reasonsOf(releaseFirst.logger))
         .toEqual({ [two.a]: 'release', [two.b]: 'disconnect' });
      expect(releaseFirst.agents.map(agent => agent.stdinCloses)).toEqual([1, 1]);
   });

   it('a turn on a released session is a collapse, with no relaunch and no record', async () => {
      const diagnostics = createDiagnostics();
      const { driver, connect } = setup(2, diagnostics);
      const first = await driver.execute('a');
      await driver.release(first.sessionId);
      const error = await failureOf(driver.execute('again', { sessionId: first.sessionId }));
      expect(error).toBeInstanceOf(SessionCollapseError);
      expect(error?.message).toContain(first.sessionId);
      expect(connect).toHaveBeenCalledTimes(1);
      expect(diagnostics.records).toEqual([]);
   });

   it('unknown and empty ids are silent', async () => {
      const { driver, agents, logger } = setup();
      const { a, b } = await openTwo(driver);
      await expect(driver.release('nope')).resolves.toBeUndefined();
      await expect(driver.release('')).resolves.toBeUndefined();
      expect(agents.map(agent => agent.stdinCloses)).toEqual([0, 0]);
      expect(entries(logger, 'agent_process_ended')).toEqual([]);
      for (const sessionId of [a, b]) {
         expect((await driver.execute('again', { sessionId })).sessionId).toBe(sessionId);
      }
   });
});
