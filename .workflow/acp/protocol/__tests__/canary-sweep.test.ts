import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createAcpDriver } from '../../drivers/acp-driver-core/acp-driver.js';
import {
   LAUNCH, createDiagnostics, fakeAgents,
} from '../../drivers/acp-driver-core/__tests__/acp-driver.helpers.js';
import { NEVER } from '../../drivers/acp-driver-core/__tests__/fake-acp-agent.js';
import { SESSION, scriptFor } from '../../drivers/acp-driver-core/__tests__/permissions.helpers.js';
import { createGovernanceEngine } from '../../governance/engine.js';
import {
   createCx, createLogger, isAskDetail, makeAgent, newSessionArgs, reject, requestsOf, textParam,
} from './agent.helpers.js';

const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'governance', 'config.yaml');

/** One unique string per kind of text that must not leak. */
const CANARY = {
   prompt: 'CANARY-PROMPT-0a1b',
   text:   'CANARY-TEXT-2c3d',
   title:  'CANARY-TITLE-4e5f',
   diff:   'CANARY-DIFF-6a7b',
   raw:    'CANARY-RAW-8c9d',
   stderr: 'CANARY-STDERR-0e1f',
   chunk:   'CANARY-CHUNK-9a0b',
   command: 'CANARY-CMD-3a4b',
   path:    'CANARY-PATH-5c6d',
   callId:  'CANARY-ID-7e8f',
};
const ALL = Object.values(CANARY);

type Ending = 'ide-rejects' | 'denied-by-rule' | 'cancel' | 'crash' | 'disconnect';
const ENDINGS: Ending[] = ['ide-rejects', 'denied-by-rule', 'cancel', 'crash', 'disconnect'];

/** Runs one turn that ends in this way, and returns everything it wrote where a leak could show. */
async function runTurn(ending: Ending) {
   const { agents, connect } = fakeAgents(1);
   const downstream = agents[0];
   // A real agent exits when its input ends.
   const closeStdin = downstream.handle.closeStdin;
   downstream.handle.closeStdin = () => { closeStdin(); downstream.exit(0); };

   const diagnostics = createDiagnostics();
   const logger     = createLogger();
   const driver     = createAcpDriver({ name: 'test', connect, launch: LAUNCH, logger, diagnostics });
   const governance = createGovernanceEngine({ configPath: CONFIG_PATH, logger });
   const script     = scriptFor(downstream, []);
   const command    = 'denied-by-rule' === ending
      ? `git checkout main ${CANARY.command}` : `touch ${CANARY.command}`;
   const held       = 'cancel' === ending || 'disconnect' === ending;

   downstream.respond('session/prompt', async () => {
      await script.call({
         toolCallId: `${CANARY.callId}-1`, kind: 'execute', title: CANARY.title, status: 'pending',
         rawInput: { command, note: CANARY.raw },
      });
      await script.ask({ toolCallId: `${CANARY.callId}-1`, title: CANARY.title });
      if ('crash' === ending) {
         downstream.stderr(CANARY.stderr);
         downstream.exit(1);
         return NEVER;
      }
      if ('denied-by-rule' !== ending) {
         await script.call({
            toolCallId: `${CANARY.callId}-2`, kind: 'edit', title: CANARY.title, status: 'pending',
            locations: [{ path: `/repo/${CANARY.path}.ts` }],
            content: [{ type: 'diff', path: '/repo/a.ts', oldText: 'a', newText: CANARY.diff }],
         });
         await script.ask({ toolCallId: `${CANARY.callId}-2`, title: CANARY.title });
      }
      for (const text of [CANARY.text, CANARY.chunk]) {
         await downstream.notify('session/update', {
            sessionId: SESSION,
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
         });
      }
      return { stopReason: 'end_turn' };
   });

   const cx   = createCx({ respond: () => held ? new Promise(() => undefined) : { outcome: reject } });
   const made = makeAgent({ driver, logger, governance });
   const { sessionId } = await made.agent.newSession(newSessionArgs());
   const turn = made.agent.prompt({ sessionId, ...textParam(CANARY.prompt) }, cx)
      .then(() => undefined, (err: Error) => err);

   if (held) { await vi.waitFor(() => expect(requestsOf(cx)).toHaveLength(1)); }
   if ('cancel' === ending)     { await made.agent.cancel({ sessionId }); }
   if ('disconnect' === ending) { await made.agent.onDisconnect(); }
   const error = await turn;
   if ('disconnect' !== ending) { await driver.close(); }

   return {
      logs:    JSON.stringify(logger.entries),
      ide:     JSON.stringify(cx.calls),
      calls:   cx.calls,
      error:   error?.message ?? '',
      records: diagnostics.records,
   };
}

describe.each(ENDINGS)('the canary sweep: a turn that ends as %s', ending => {
   it('[H] no canary reaches a log entry', async () => {
      const { logs } = await runTurn(ending);
      // Governance logs the paths it matched, as given; every other canary stays out.
      for (const canary of ALL.filter(each => CANARY.path !== each)) {
         expect(logs, canary).not.toContain(canary);
      }
   });

   it('[H] the IDE never sees the prompt or the agent\'s last words', async () => {
      const { ide } = await runTurn(ending);
      for (const canary of [CANARY.prompt, CANARY.stderr]) {
         expect(ide, canary).not.toContain(canary);
      }
   });

   it('[H] the diff and the raw input appear only in an ask detail', async () => {
      const { calls } = await runTurn(ending);
      const elsewhere = JSON.stringify(calls.filter(call => !isAskDetail(call.params.update)));
      expect(elsewhere).not.toContain(CANARY.diff);
      expect(elsewhere).not.toContain(CANARY.raw);
   });

   it('the cards show the title, the command and the path; the text arrives once', async () => {
      const { ide } = await runTurn(ending);
      // After a cancel the script carries on to its second call; a crash or disconnect ends it.
      const reachesSecondCall = 'ide-rejects' === ending || 'cancel' === ending;
      const textArrives       = 'ide-rejects' === ending || 'denied-by-rule' === ending;
      for (const canary of [CANARY.title, CANARY.command, CANARY.callId]) {
         expect(ide, canary).toContain(canary);
      }
      expect(ide.includes(CANARY.path)).toBe(reachesSecondCall);
      for (const canary of [CANARY.text, CANARY.chunk]) {
         const count = ide.split(canary).length - 1;
         if ('cancel' === ending) { expect(count, canary).toBeLessThanOrEqual(1); }
         else { expect(count, canary).toBe(textArrives ? 1 : 0); }
      }
   });

   it('[H] no error message carries a canary except the agent\'s last words', async () => {
      const { error } = await runTurn(ending);
      for (const canary of ALL.filter(each => CANARY.stderr !== each)) { expect(error, canary).not.toContain(canary); }
   });

   it('[H] no canary reaches a diagnostic record except the agent\'s last words', async () => {
      const { records } = await runTurn(ending);
      const text        = JSON.stringify(records);
      for (const canary of ALL.filter(each => CANARY.stderr !== each)) {
         expect(text, canary).not.toContain(canary);
      }
   });

   it('only a crash gives a record, and it holds the last words once', async () => {
      const { records } = await runTurn(ending);
      expect(records).toHaveLength('crash' === ending ? 1 : 0);
      expect(JSON.stringify(records).split(CANARY.stderr))
         .toHaveLength('crash' === ending ? 2 : 1);
   });
});

describe('the canary sweep: the canaries do reach where they are allowed', () => {
   it('an ask shows the title, raw input and diff, and the answer shows the agent\'s text', async () => {
      const { ide } = await runTurn('ide-rejects');
      for (const canary of [CANARY.title, CANARY.raw, CANARY.diff, CANARY.text]) {
         expect(ide, canary).toContain(canary);
      }
   });

   it('a rule-denied call is a card with its outcome, not an ask', async () => {
      const { ide, calls } = await runTurn('denied-by-rule');
      expect(ide).toContain(CANARY.text);
      expect(ide).toContain(CANARY.title);
      expect(ide).toContain('denied by governance');
      const asked = calls.some(call =>
         isAskDetail(call.params.update) || 'session/request_permission' === call.method);
      expect(asked).toBe(false);
   });

   it('a crashed agent\'s last words reach the error message', async () => {
      const { error } = await runTurn('crash');
      expect(error).toContain(CANARY.stderr);
   });
});
