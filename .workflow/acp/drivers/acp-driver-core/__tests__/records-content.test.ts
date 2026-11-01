import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDiagnosticLog } from '../../../shared/diagnostic-log.js';
import { REDACTED } from '../../../shared/redact.js';
import { readRecords, useTempFolder } from '../../../shared/__tests__/log-files.helpers.js';
import {
   LONG_SESSION_ID, SECRET_LINES,
} from '../../../shared/__tests__/redaction.helpers.js';
import { AGENT_FAILURE_KIND as KIND } from '../errors.js';
import { NEVER } from './fake-acp-agent.js';
import { createDiagnostics, createLogger, flush, makeDriver } from './acp-driver.helpers.js';
import {
   ALLOW, REJECT, SESSION, entries, exitDuringInitialize, failureOf, logged, rpcError,
} from './failures.helpers.js';
import { heldSecondTurn } from './records.helpers.js';

const folderOf = useTempFolder();
const fileOf   = () => join(folderOf(), 'work', 'acp-diagnostic.log');
const sinkOf   = () => createDiagnosticLog({ filePath: fileOf(), logger: createLogger() });

/** A driver with a recording seam. */
function recorded() {
   const diagnostics = createDiagnostics();
   const made        = makeDriver(1, undefined, undefined, undefined, diagnostics);
   return { ...made, diagnostics, agent: made.agents[0] };
}

describe('what a record holds', () => {
   it.each(SECRET_LINES)('[H] %s in the agent output is redacted in the diagnostic file',
      async (_label, line, secrets) => {
         await exitDuringInitialize(`startup failed: ${line} (while starting)\n`, 1, sinkOf());
         const text = readFileSync(fileOf(), 'utf8');
         for (const secret of secrets) { expect(text).not.toContain(secret); }
         expect(text).toContain('startup failed:');
         expect(text).toContain('(while starting)');
      });

   it('provider error text is redacted in the record', async () => {
      const { driver, agent, diagnostics } = recorded();
      agent.respond('session/prompt', rpcError('bad request: api_key=abc123def', -32603));
      await failureOf(driver.execute('go'));
      expect(diagnostics.records[0].message).toContain(`api_key=${REDACTED}`);
      expect(diagnostics.records[0].message).not.toContain('abc123def');
      agent.exit(0);
   });

   it('[H] the provider\'s error text is in the diagnostic log, not in the service log', async () => {
      const { driver, agent, diagnostics, logger } = recorded();
      agent.respond('session/prompt', rpcError('no capacity CANARY-ANSWER', -32603));
      await failureOf(driver.execute('go'));
      agent.exit(0);
      await flush();
      expect(JSON.stringify(diagnostics.records)).toContain('CANARY-ANSWER');
      expect(logged(logger)).not.toContain('CANARY-ANSWER');
   });

   it('[H] a long session id survives the sink and joins the service log', async () => {
      const { driver, agents, logger } = makeDriver(1, undefined, undefined, undefined, sinkOf());
      agents[0].respond('session/new', () => ({ sessionId: LONG_SESSION_ID }));
      agents[0].respond('session/prompt', () => NEVER);
      const turn = failureOf(driver.execute('go'));
      await agents[0].arrived('session/prompt');
      agents[0].exit(1);
      await turn;
      await flush();
      const [record] = readRecords(fileOf());
      expect(record.agentSessionId).toBe(LONG_SESSION_ID);
      expect(entries(logger, 'agent_process_ended')).toEqual([
         { pid: record.pid, agentSessionId: LONG_SESSION_ID, reason: 'crash', stage: 'none' },
      ]);
   });

   it('a failure before the agent names a session joins the service log by pid', async () => {
      const diagnostics = createDiagnostics();
      const { logger }  = await exitDuringInitialize('boom\n', 1, diagnostics);
      await flush();
      const [ended] = entries(logger, 'agent_process_ended');
      expect(ended.pid).toBe(diagnostics.records[0].pid);
      expect(ended).not.toHaveProperty('agentSessionId');
   });

   it('[H] the tail is in the record once', async () => {
      const t = await heldSecondTurn();
      t.agent.stderr('first-line-xyz\nsecond-line-xyz\n');
      t.agent.exit(1);
      await t.turn;
      const text = JSON.stringify(t.diagnostics.records[0]);
      expect(text.split('first-line-xyz')).toHaveLength(2);
      expect(text.split('second-line-xyz')).toHaveLength(2);
   });

   it('a quiet agent has no tail', async () => {
      const t = await heldSecondTurn();
      t.agent.exit(1);
      await t.turn;
      expect(t.diagnostics.records[0].tail ?? '').toBe('');
      expect(t.diagnostics.records[0].message).not.toContain('printed');
   });

   it('[H] an error text of 1 MiB keeps the record under 16 KiB, and the chat error whole', async () => {
      const { driver, agents } = makeDriver(1, undefined, undefined, undefined, sinkOf());
      agents[0].respond('session/prompt', rpcError('boom '.repeat(200_000), -32603));
      const error = await failureOf(driver.execute('go'));
      expect(Buffer.byteLength(readFileSync(fileOf(), 'utf8'))).toBeLessThan(16 * 1024);
      expect(error?.message.length).toBeGreaterThan(1_000_000);
      agents[0].exit(0);
   });

   it('[H] a handler error record holds none of the turn\'s user content', async () => {
      const { driver, agent, diagnostics } = recorded();
      agent.respond('session/prompt', async () => {
         await agent.notify('session/update', {
            sessionId: SESSION,
            update: {
               sessionUpdate: 'tool_call', toolCallId: 'u1', title: 'CANARY-TITLE', kind: 'edit',
               status: 'in_progress', rawInput: { command: 'CANARY-RAW' },
               content: [{ type: 'diff', path: '/r/a.ts', oldText: 'CANARY-OLD', newText: 'CANARY-NEW' }],
            },
         });
         void agent.request('session/request_permission', {
            sessionId: SESSION, toolCall: { toolCallId: 'u1', title: 'CANARY-REQ' }, options: [ALLOW, REJECT],
         });
         return NEVER;
      });
      const onToolCall = async () => { throw new Error('handler broke'); };
      await failureOf(driver.execute('CANARY-PROMPT', { context: 'CANARY-CONTEXT', onToolCall }));
      expect(diagnostics.records.map(record => record.kind)).toEqual([KIND.handlerFailed]);
      const text = JSON.stringify(diagnostics.records);
      for (const canary of [
         'CANARY-TITLE', 'CANARY-RAW', 'CANARY-OLD', 'CANARY-NEW', 'CANARY-REQ',
         'CANARY-PROMPT', 'CANARY-CONTEXT',
      ]) {
         expect(text).not.toContain(canary);
      }
      agent.exit(0);
   });
});

describe('streamed content', () => {
   it('[H] a crash after streamed text and a card leaves them out of the record and the error', async () => {
      const { driver, agent, diagnostics } = recorded();
      const send = (update: object) => agent.notify('session/update', { sessionId: SESSION, update });
      agent.respond('session/prompt', async () => {
         await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'CANARY-STREAM' } });
         await send({
            sessionUpdate: 'tool_call', toolCallId: 'CANARY-ID', title: 'CANARY-CARD', kind: 'execute',
            rawInput: { command: 'CANARY-COMMAND' }, locations: [{ path: '/CANARY-PATH' }],
         });
         await flush();
         agent.exit(1);
         return NEVER;
      });
      const error = await failureOf(driver.execute('go', { onUpdate: () => undefined }));
      expect(diagnostics.records).toHaveLength(1);
      const text = JSON.stringify([diagnostics.records, error?.message]);
      for (const canary of [
         'CANARY-STREAM', 'CANARY-ID', 'CANARY-CARD', 'CANARY-COMMAND', 'CANARY-PATH',
      ]) {
         expect(text).not.toContain(canary);
      }
   });
});
