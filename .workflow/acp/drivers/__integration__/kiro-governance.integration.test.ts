/**
 * Live tests of the real governance engine in front of the real `kiro-cli`. Manual only: they cost
 * money and need a logged-in kiro-cli on PATH. Excluded from `npm test`. Run one file at a time:
 *
 *    npx vitest run --config vitest.integration.config.ts drivers/__integration__/kiro-governance.integration.test.ts
 *
 * Every prompt is tiny and runs in a throwaway directory. The fake IDE rejects every request except
 * the one for the harmless control command `touch live-allow.txt`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGovernanceEngine } from '../../governance/engine.js';
import {
   createCx, createLogger, detailsOf, eventsOf, makeAgent, newSessionArgs, requestsOf, textParam,
} from '../../protocol/__tests__/agent.helpers.js';
import type { DriverResult } from '../governed-driver.js';
import { createKiroAcpDriver } from '../kiro-driver-acp.js';

console.log(`live run: ${execFileSync('kiro-cli', ['--version'], { encoding: 'utf8' }).trim()}`);

const CONFIG          = fileURLToPath(new URL('../../governance/config.yaml', import.meta.url));
const LIVE_TIMEOUT_MS = 180000;
const CONTROL         = 'live-allow.txt';

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

/** One real turn through the real engine; the fake IDE allows only the control command. */
async function liveTurn(prompt: string) {
   const logger  = createLogger();
   const real    = createKiroAcpDriver({ logger });
   const results: DriverResult[] = [];
   const driver  = {
      ...real,
      execute: async (command: string, options?: any) => {
         const result = await real.execute(command, options);
         results.push(result);
         return result;
      },
   };
   const shown = () => JSON.stringify(detailsOf(cx).slice(-1));
   const cx    = createCx({
      respond: () => ({ outcome: { outcome: 'selected', optionId: shown().includes(CONTROL) ? 'allow' : 'reject' } }),
   });
   const governance = createGovernanceEngine({ configPath: CONFIG, logger });
   const { agent }  = makeAgent({ driver, logger, governance });
   const session    = await agent.newSession(newSessionArgs());
   try {
      const stop  = await agent.prompt({ sessionId: session.sessionId, ...textParam(prompt) }, cx);
      const calls = results.flatMap(result => result.toolCalls)
         .map(call => ({ kind: call.report.kind, command: call.report.command, decision: call.decision }));
      console.log('live calls:', JSON.stringify(calls));
      console.log('live outcomes:', JSON.stringify(eventsOf(logger, 'governance_outcome').map(e => e.data)));
      return { stop, cx, calls, unrequested: logger.entries.filter(e => 'governance_unrequested' === e.event) };
   }
   finally { await agent.onDisconnect().catch(() => undefined); }
}

describe('governance in front of the real kiro-cli (live)', () => {
   it('[H] a rule-approved command runs without asking the IDE, and is never denied', async () => {
      const run = await liveTurn('Run the shell command `ls` in the current directory and tell me what it printed.');
      expect(requestsOf(run.cx)).toHaveLength(0);
      expect(run.calls.filter(call => 'ls' === call.command).map(call => call.decision)).not.toContain('deny');
      console.log('live path:', 0 < run.unrequested.length ? 'Kiro ran it without a request' : 'asked and approved by rule');
   }, LIVE_TIMEOUT_MS);

   it('[H] an asked command that the IDE rejects does not run', async () => {
      const run = await liveTurn('Run the shell command `touch live-reject.txt`.');
      expect(existsSync(join(dir, 'live-reject.txt'))).toBe(false);
      expect(requestsOf(run.cx).length).toBeGreaterThan(0);
      expect(run.calls.filter(call => 'touch live-reject.txt' === call.command).map(call => call.decision))
         .toContain('deny');
      expect(run.unrequested).toEqual([]);
      expect(run.stop.stopReason).toBe('end_turn');
   }, LIVE_TIMEOUT_MS);

   it('an asked command that the IDE allows once runs', async () => {
      const run = await liveTurn(`Run the shell command \`touch ${CONTROL}\`.`);
      expect(requestsOf(run.cx).length).toBeGreaterThan(0);
      expect(existsSync(join(dir, CONTROL))).toBe(true);
      expect(run.unrequested).toEqual([]);
   }, LIVE_TIMEOUT_MS);

   it('[H] a command denied by rule does not run and nobody is asked', async () => {
      const run = await liveTurn('Run the shell command `git checkout main`.');
      expect(requestsOf(run.cx)).toHaveLength(0);
      expect(run.calls.filter(call => 'git checkout main' === call.command).map(call => call.decision))
         .not.toContain('approve');
   }, LIVE_TIMEOUT_MS);
});
