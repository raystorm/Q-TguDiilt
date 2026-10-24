import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETUP_TIMEOUT_MS } from '../acp-driver.js';
import { AGENT_FAILURE_KIND as KIND, AgentExitedError, AgentRequestError } from '../errors.js';
import { NEVER } from './fake-acp-agent.js';
import {
   DIAGNOSTICS_PATH, createDiagnostics, deferred, flush, makeDriver,
} from './acp-driver.helpers.js';
import { ALLOW, REJECT, SESSION, entries, failureOf, rpcError } from './failures.helpers.js';
import { firstLine, heldSecondTurn } from './records.helpers.js';

afterEach(() => { vi.useRealTimers(); });

describe('one failure, one record', () => {
   it('[H] a crash while a request waits: the exit and the broken stream give one record',
      async () => {
         const t = await heldSecondTurn();
         t.agent.stderr('boom\n');
         t.agent.exit(137);
         const error = await t.turn;
         await flush();
         expect(error).toBeInstanceOf(AgentExitedError);
         expect(t.diagnostics.records).toHaveLength(1);
         expect(t.diagnostics.records[0])
            .toMatchObject({ kind: KIND.exited, message: firstLine(error!) });
      });

   it.each(['initialize', 'session/new'])('[H] a crash while %s waits is one record that agrees',
      async step => {
         const diagnostics = createDiagnostics();
         const { driver, agents } = makeDriver(1, undefined, undefined, undefined, diagnostics);
         agents[0].respond(step, () => NEVER);
         const failure = failureOf(driver.execute('go'));
         await agents[0].arrived(step);
         agents[0].exit(1);
         const error = await failure;
         await flush();
         expect(error).toBeInstanceOf(AgentExitedError);
         expect(diagnostics.records).toHaveLength(1);
         expect(diagnostics.records[0])
            .toMatchObject({ kind: KIND.exited, message: firstLine(error!) });
      });

   it('[H] the agent we ended after a start-up timeout exits: still one record', async () => {
      vi.useFakeTimers();
      const diagnostics = createDiagnostics();
      const { driver, agents } = makeDriver(1, undefined, undefined, undefined, diagnostics);
      agents[0].respond('initialize', () => NEVER);
      const failure = failureOf(driver.execute('go'));
      await flush();
      await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS);
      await failure;
      agents[0].exit(0);
      await vi.advanceTimersByTimeAsync(5000);
      expect(diagnostics.records).toHaveLength(1);
   });

   it('[H] a permission request is open when the agent crashes, and the handler answers late',
      async () => {
         const diagnostics = createDiagnostics();
         const { driver, agents } = makeDriver(1, undefined, undefined, undefined, diagnostics);
         const gate  = deferred<'approve'>();
         const asked = deferred();
         agents[0].respond('session/prompt', async () => {
            void agents[0].request('session/request_permission', {
               sessionId: SESSION, toolCall: { toolCallId: 'a' }, options: [ALLOW, REJECT],
            });
            return NEVER;
         });
         const onToolCall = () => { asked.resolve(); return gate.promise; };
         const turn       = failureOf(driver.execute('go', { onToolCall }));
         await asked.promise;
         agents[0].exit(1);
         await turn;
         gate.resolve('approve');
         await flush();
         expect(diagnostics.records).toHaveLength(1);
      });

   it('an error answer during setup, then the exit of the process the driver ended', async () => {
      const diagnostics = createDiagnostics();
      const { driver, agents } = makeDriver(1, undefined, undefined, undefined, diagnostics);
      agents[0].respond('initialize', rpcError('no capacity', -32603));
      expect(await failureOf(driver.execute('go'))).toBeInstanceOf(AgentRequestError);
      agents[0].exit(0);
      await flush();
      expect(diagnostics.records).toHaveLength(1);
   });

   it('a failure, then close, is still one record', async () => {
      const t = await heldSecondTurn();
      t.agent.exit(1);
      await t.turn;
      await t.driver.close();
      expect(t.diagnostics.records).toHaveLength(1);
   });

   it('[H] a seam that throws changes nothing', async () => {
      const diagnostics = { path: DIAGNOSTICS_PATH, record: () => { throw new Error('seam broke'); } };
      const { driver, agents, logger } = makeDriver(2, undefined, undefined, undefined, diagnostics);
      const first = await driver.execute('one');
      agents[0].respond('session/prompt', () => NEVER);
      const turn = failureOf(driver.execute('two', { sessionId: first.sessionId }));
      await flush();
      agents[0].exit(137);
      expect(await turn).toBeInstanceOf(AgentExitedError);
      await flush();
      expect(entries(logger, 'agent_process_ended')).toHaveLength(1);
      expect((await driver.execute('fresh')).sessionId).toBe(SESSION);
   });
});
