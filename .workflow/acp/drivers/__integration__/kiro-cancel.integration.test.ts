/**
 * Live tests of cancelling a turn against the real `kiro-cli`. Manual only: they cost money and need
 * a logged-in kiro-cli on PATH. Excluded from `npm test`. Run one file at a time:
 *
 *    npx vitest run --config vitest.integration.config.ts drivers/__integration__/kiro-cancel.integration.test.ts
 *
 * Every prompt is tiny and runs in a throwaway directory. The fake IDE allows nothing except, in the
 * first test, the one harmless `sleep 30`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGovernanceEngine } from '../../governance/engine.js';
import {
   createCx, createLogger, detailsOf, eventsOf, makeAgent, newSessionArgs, requestsOf, textParam,
} from '../../protocol/__tests__/agent.helpers.js';
import { until } from '../../protocol/__tests__/service-process.helpers.js';
import { CANCEL_DEADLINE_MS } from '../acp-client/acp-driver.js';
import { createKiroAcpDriver } from '../kiro-driver-acp.js';

console.log(`live run: ${execFileSync('kiro-cli', ['--version'], { encoding: 'utf8' }).trim()}`);

const CONFIG          = fileURLToPath(new URL('../../governance/config.yaml', import.meta.url));
const LIVE_TIMEOUT_MS = 180000;
const REQUEST_WAIT_MS = 90000;
const SLACK_MS        = 3000;

let previous: string;
let dir: string;

beforeAll(() => {
   previous = process.cwd();
   dir      = realpathSync(mkdtempSync(join(tmpdir(), 'kiro-live-')));
   process.chdir(dir);
});
afterAll(() => {
   process.chdir(previous);
   rmSync(dir, { recursive: true, force: true });
});

/** A real agent service over the real kiro-cli. `decide` answers each permission request. */
function liveSession(decide: (shown: string) => 'allow' | 'reject' | 'hold') {
   const logger = createLogger();
   const driver = createKiroAcpDriver({ logger });
   const shown  = () => JSON.stringify(detailsOf(cx).slice(-1));
   const cx     = createCx({
      respond: () => {
         const answer = decide(shown());
         if ('hold' === answer) { return new Promise(() => undefined); }
         return { outcome: { outcome: 'selected', optionId: answer } };
      },
   });
   const governance = createGovernanceEngine({ configPath: CONFIG, logger });
   const { agent }  = makeAgent({ driver, logger, governance });
   return { agent, logger, cx, shown, start: () => agent.newSession(newSessionArgs()) };
}

let live: ReturnType<typeof liveSession> | undefined;
afterEach(async () => { await live?.agent.onDisconnect().catch(() => undefined); live = undefined; });

describe('cancel with the real kiro-cli (live)', () => {
   it('[H] a cancel mid-turn ends within the deadline, and the next prompt reuses the process', async () => {
      const session = live = liveSession(shown => (shown.includes('sleep 30') ? 'allow' : 'reject'));
      const { sessionId } = await session.start();
      const turn = session.agent.prompt({
         sessionId, ...textParam('Run the shell command `sleep 30; ls .`, then say done.'),
      }, session.cx);

      // Kiro should ask about the compound; if it runs it without asking, it is running all the same.
      const asked   = () => 0 < requestsOf(session.cx).length;
      const running = () => asked() || 0 < eventsOf(session.logger, 'governance_unrequested').length;
      let settled = false;
      void turn.then(() => { settled = true; }, () => { settled = true; });
      await until(() => running() || settled, REQUEST_WAIT_MS);
      console.log('live path:', asked() ? 'asked' : 'ran without a request');
      expect(settled).toBe(false);
      expect(running()).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 3000));
      const cancelledAt = Date.now();
      await session.agent.cancel({ sessionId });
      const stop = await turn;
      const took = Date.now() - cancelledAt;
      const deadline = eventsOf(session.logger, 'agent_cancel_deadline');
      console.log('live cancel:', JSON.stringify({ stopReason: stop.stopReason, ms: took, deadlineEntries: deadline.length }));
      expect(stop.stopReason).toBe('cancelled');
      expect(took).toBeLessThan(CANCEL_DEADLINE_MS + SLACK_MS);

      const next = await session.agent.prompt({
         sessionId, ...textParam('Reply with the single word: ok. Do not use any tools.'),
      }, session.cx);
      expect(next.stopReason).toBe('end_turn');
      expect(eventsOf(session.logger, 'agent_relaunched')).toEqual([]);
      expect(eventsOf(session.logger, 'agent_process_ended')).toEqual([]);
   }, LIVE_TIMEOUT_MS);

   it('[H] a cancel while a request is pending sends nothing and writes nothing', async () => {
      const session = live = liveSession(() => 'hold');
      const { sessionId } = await session.start();
      const turn = session.agent.prompt({
         sessionId,
         ...textParam('Use your file writing tool, not a shell command, to create live-edit.txt containing the word hi.'),
      }, session.cx);

      expect(await until(() => 0 < requestsOf(session.cx).length, REQUEST_WAIT_MS)).toBe(true);
      console.log('live pending request:', session.shown().slice(0, 900));
      await session.agent.cancel({ sessionId });
      const stop = await turn;
      console.log('live cancel with a pending request:', JSON.stringify({ stopReason: stop.stopReason }));
      expect(stop.stopReason).toBe('cancelled');
      expect(existsSync(join(dir, 'live-edit.txt'))).toBe(false);
   }, LIVE_TIMEOUT_MS);
});
