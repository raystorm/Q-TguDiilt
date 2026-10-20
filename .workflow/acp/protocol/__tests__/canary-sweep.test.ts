import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createAcpDriver } from '../../drivers/acp-client/acp-driver.js';
import { LAUNCH, fakeAgents } from '../../drivers/acp-client/__tests__/acp-driver.helpers.js';
import { NEVER } from '../../drivers/acp-client/__tests__/fake-acp-agent.js';
import { SESSION, scriptFor } from '../../drivers/acp-client/__tests__/permissions.helpers.js';
import { createGovernanceEngine } from '../../governance/engine.js';
import {
   createCx, createLogger, makeAgent, newSessionArgs, reject, requestsOf, textParam,
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

   const logger     = createLogger();
   const driver     = createAcpDriver({ name: 'test', connect, launch: LAUNCH, logger });
   const governance = createGovernanceEngine({ configPath: CONFIG_PATH, logger });
   const script     = scriptFor(downstream, []);
   const command    = 'denied-by-rule' === ending ? 'git checkout main' : 'touch x';
   const held       = 'cancel' === ending || 'disconnect' === ending;

   downstream.respond('session/prompt', async () => {
      await script.call({
         toolCallId: 'c1', kind: 'execute', title: CANARY.title, status: 'pending',
         rawInput: { command, note: CANARY.raw },
      });
      await script.ask({ toolCallId: 'c1', title: CANARY.title });
      if ('crash' === ending) {
         downstream.stderr(CANARY.stderr);
         downstream.exit(1);
         return NEVER;
      }
      if ('denied-by-rule' !== ending) {
         await script.call({
            toolCallId: 'c2', kind: 'edit', title: CANARY.title, status: 'pending', locations: [{ path: '/repo/a.ts' }],
            content: [{ type: 'diff', path: '/repo/a.ts', oldText: 'a', newText: CANARY.diff }],
         });
         await script.ask({ toolCallId: 'c2', title: CANARY.title });
      }
      await downstream.notify('session/update', {
         sessionId: SESSION,
         update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: CANARY.text } },
      });
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
      logs:  JSON.stringify(logger.entries),
      ide:   JSON.stringify(cx.calls),
      error: error?.message ?? '',
   };
}

describe.each(ENDINGS)('the canary sweep: a turn that ends as %s', ending => {
   const asked = 'denied-by-rule' !== ending;

   it('[H] no canary reaches a log entry', async () => {
      const { logs } = await runTurn(ending);
      for (const canary of ALL) { expect(logs, canary).not.toContain(canary); }
   });

   it('[H] the IDE sees only what the user is meant to see', async () => {
      const { ide } = await runTurn(ending);
      // The agent's text is the answer; the title, diff and raw input appear only in an ask's detail.
      const allowed = asked ? [CANARY.text, CANARY.title, CANARY.diff, CANARY.raw] : [CANARY.text];
      for (const canary of ALL.filter(each => !allowed.includes(each))) { expect(ide, canary).not.toContain(canary); }
   });

   it('[H] no error message carries a canary except the agent\'s last words', async () => {
      const { error } = await runTurn(ending);
      for (const canary of ALL.filter(each => CANARY.stderr !== each)) { expect(error, canary).not.toContain(canary); }
   });
});

describe('the canary sweep: the canaries do reach where they are allowed', () => {
   it('an ask shows the title, raw input and diff, and the answer shows the agent\'s text', async () => {
      const { ide } = await runTurn('ide-rejects');
      for (const canary of [CANARY.title, CANARY.raw, CANARY.diff, CANARY.text]) {
         expect(ide, canary).toContain(canary);
      }
   });

   it('a rule-denied call is not shown to the IDE as an ask', async () => {
      const { ide } = await runTurn('denied-by-rule');
      expect(ide).toContain(CANARY.text);
      expect(ide).not.toContain(CANARY.title);
   });

   it('a crashed agent\'s last words reach the error message', async () => {
      const { error } = await runTurn('crash');
      expect(error).toContain(CANARY.stderr);
   });
});
