/**
 * Live tests of the Copilot driver against the real `copilot` CLI. Manual only: they cost money and need
 * a logged-in copilot on PATH. Excluded from `npm test`. Run the whole file, or one group with `-t`:
 *
 *    npx vitest run --config vitest.integration.config.ts drivers/__integration__/copilot.integration.test.ts
 *    npx vitest run --config vitest.integration.config.ts \
 *       drivers/__integration__/copilot.integration.test.ts -t "cancel with the real"
 *
 * The groups: a plain turn, governance in front of copilot, cancel, close leaves no process (Linux only),
 * autopilot (record only), and the adversarial run. The adversarial run uses the controls and the
 * destructive commands; LIVE_CASES overrides the list, and LIVE_CASES= (empty) skips it:
 *
 *    LIVE_CASES=c1-controls.txt,c8-destructive.txt npx vitest run --config vitest.integration.config.ts \
 *       drivers/__integration__/copilot.integration.test.ts -t "adversarial"
 *
 * Every prompt is tiny and runs in a throwaway directory. The fake IDE rejects every request except the
 * harmless controls: `touch live-allow.txt` (governance group) and `sleep 30; ls .` (cancel and close).
 * The adversarial run never allows anything.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSION, client, methods } from '@agentclientprotocol/sdk';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGovernanceEngine } from '../../governance/engine.js';
import {
   createCx, createLogger, detailsOf, eventsOf, makeAgent, newSessionArgs, requestsOf, textParam,
} from '../../protocol/__tests__/agent.helpers.js';
import { until } from '../../protocol/__tests__/service-process.helpers.js';
import { CANCEL_DEADLINE_MS } from '../acp-driver-core/acp-driver.js';
import { createLogger as createMockLogger } from '../acp-driver-core/__tests__/acp-driver.helpers.js';
import { realSleep } from '../acp-driver-core/__tests__/stub-agent.helpers.js';
import { spawnAgent } from '../acp-driver-core/connect.js';
import { endAgent } from '../acp-driver-core/ending.js';
import { COPILOT_ARGS, COPILOT_COMMAND, createCopilotAcpDriver } from '../copilot-driver-acp.js';
import type { DriverResult } from '../governed-driver.js';
import { describeAdversarialRun } from './adversarial.js';

console.log(`live run: copilot ${execFileSync(COPILOT_COMMAND, ['--version'], { encoding: 'utf8' }).trim()}`);

const CONFIG   = fileURLToPath(new URL('../../governance/config.yaml', import.meta.url));
const MODES    = 'https://agentclientprotocol.com/protocol/session-modes';

const PLAIN_TIMEOUT_MS        = 120000;
const GOVERNANCE_TIMEOUT_MS   = 180000;
const CANCEL_TIMEOUT_MS       = 180000;
const CLOSE_TIMEOUT_MS        = 180000;
const AUTOPILOT_TIMEOUT_MS    = 300000;

let previous: string;
let dir: string;

beforeAll(() => {
   previous = process.cwd();
   dir      = realpathSync(mkdtempSync(join(tmpdir(), 'copilot-live-')));
   process.chdir(dir);
});
afterAll(() => {
   process.chdir(previous);
   rmSync(dir, { recursive: true, force: true });
});

describe('copilot through the ACP driver (live)', () => {
   it('[H] setup and verify pass, and a plain turn returns text and no tool calls', async () => {
      const logger = createMockLogger();
      const driver = createCopilotAcpDriver({ logger });
      try {
         const result = await driver.execute('Reply with the single word: ok. Do not use any tools.', {
            onToolCall: async () => 'deny',
         });
         console.log('live turn:', JSON.stringify({ text: result.text, sessionId: result.sessionId }));
         expect(result.sessionId).not.toBe('');
         expect(result.text.length).toBeGreaterThan(0);
         expect(result.toolCalls).toEqual([]);
         expect(logger.warn.mock.calls.filter(([event]) => 'governance_unrequested' === event)).toEqual([]);
      }
      finally {
         await driver.close();
         console.log('live log:', JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]));
      }
   }, PLAIN_TIMEOUT_MS);
});

describe.skipIf('win32' === process.platform)('governance in front of the real copilot (live)', () => {
   const CONTROL = 'live-allow.txt';

   /** One real turn through the real engine; the fake IDE allows only the control command. */
   async function liveTurn(prompt: string) {
      const logger  = createLogger();
      const real    = createCopilotAcpDriver({ logger });
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
         respond: () => ({
            outcome: { outcome: 'selected', optionId: shown().includes(CONTROL) ? 'allow' : 'reject' },
         }),
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

   it('[H] a rule-approved command runs without asking the IDE, and is never denied', async () => {
      const run = await liveTurn('Run the shell command `ls` in the current directory and tell me what it printed.');
      expect(requestsOf(run.cx)).toHaveLength(0);
      expect(run.calls.filter(call => 'ls' === call.command).map(call => call.decision)).not.toContain('deny');
      console.log('live path:', 0 < run.unrequested.length
         ? 'Copilot ran it without a request'
         : 'asked and approved by rule');
   }, GOVERNANCE_TIMEOUT_MS);

   it('[H] an asked command that the IDE rejects does not run, '
      + 'and the request comes before the call runs', async () => {
      const run = await liveTurn('Run the shell command `touch live-reject.txt`.');
      expect(existsSync(join(dir, 'live-reject.txt'))).toBe(false);
      expect(requestsOf(run.cx).length).toBeGreaterThan(0);
      expect(run.calls.filter(call => 'touch live-reject.txt' === call.command).map(call => call.decision))
         .toContain('deny');
      // A call reported as running before its request would show here as an unrequested one.
      expect(run.unrequested).toEqual([]);
      expect(run.stop.stopReason).toBe('end_turn');
   }, GOVERNANCE_TIMEOUT_MS);

   it('an asked command that the IDE allows once runs', async () => {
      const run = await liveTurn(`Run the shell command \`touch ${CONTROL}\`.`);
      expect(requestsOf(run.cx).length).toBeGreaterThan(0);
      expect(existsSync(join(dir, CONTROL))).toBe(true);
      expect(run.unrequested).toEqual([]);
   }, GOVERNANCE_TIMEOUT_MS);

   it('[H] a command denied by rule does not run and nobody is asked', async () => {
      const run = await liveTurn('Run the shell command `git checkout main`.');
      expect(requestsOf(run.cx)).toHaveLength(0);
      expect(run.calls.filter(call => 'git checkout main' === call.command).map(call => call.decision))
         .not.toContain('approve');
   }, GOVERNANCE_TIMEOUT_MS);
});

describe.skipIf('win32' === process.platform)('cancel with the real copilot (live)', () => {
   const REQUEST_WAIT_MS = 90000;
   const SLACK_MS        = 3000;

   /** A real agent service over the real copilot. `decide` answers each permission request. */
   function liveSession(decide: (shown: string) => 'allow' | 'reject' | 'hold') {
      const logger = createLogger();
      const driver = createCopilotAcpDriver({ logger });
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

   it('[H] a cancel mid-turn ends within the deadline, and the next prompt reuses the process', async () => {
      const session = live = liveSession(shown => (shown.includes('sleep 30') ? 'allow' : 'reject'));
      const { sessionId } = await session.start();
      const turn = session.agent.prompt({
         sessionId, ...textParam('Run the shell command `sleep 30; ls .`, then say done.'),
      }, session.cx);

      const asked   = () => 0 < requestsOf(session.cx).length;
      const running = () => asked() || 0 < eventsOf(session.logger, 'governance_unrequested').length;
      let settled = false;
      void turn.then(() => { settled = true; }, () => { settled = true; });
      await until(() => running() || settled, REQUEST_WAIT_MS);
      console.log('live path:', asked() ? 'asked' : 'ran without a request');
      expect(settled).toBe(false);
      expect(running()).toBe(true);
      await realSleep(3000);
      const cancelledAt = Date.now();
      await session.agent.cancel({ sessionId });
      const stop = await turn;
      const took = Date.now() - cancelledAt;
      console.log('live cancel:', JSON.stringify({
         stopReason: stop.stopReason, ms: took,
         deadlineEntries: eventsOf(session.logger, 'agent_cancel_deadline').length,
      }));
      expect(stop.stopReason).toBe('cancelled');
      expect(took).toBeLessThan(CANCEL_DEADLINE_MS + SLACK_MS);

      const next = await session.agent.prompt({
         sessionId, ...textParam('Reply with the single word: ok. Do not use any tools.'),
      }, session.cx);
      expect(next.stopReason).toBe('end_turn');
      expect(eventsOf(session.logger, 'agent_relaunched')).toEqual([]);
      expect(eventsOf(session.logger, 'agent_process_ended')).toEqual([]);
   }, CANCEL_TIMEOUT_MS);

   it('[H] a cancel while a request is pending sends nothing and writes nothing', async () => {
      const session = live = liveSession(() => 'hold');
      const { sessionId } = await session.start();
      const turn = session.agent.prompt({
         sessionId,
         ...textParam(
            'Use your file writing tool, not a shell command, to create live-edit.txt containing the word hi.',
         ),
      }, session.cx);

      expect(await until(() => 0 < requestsOf(session.cx).length, REQUEST_WAIT_MS)).toBe(true);
      console.log('live pending request:', session.shown().slice(0, 900));
      await session.agent.cancel({ sessionId });
      const stop = await turn;
      console.log('live cancel with a pending request:', JSON.stringify({ stopReason: stop.stopReason }));
      expect(stop.stopReason).toBe('cancelled');
      expect(existsSync(join(dir, 'live-edit.txt'))).toBe(false);
   }, CANCEL_TIMEOUT_MS);
});

describe.skipIf('linux' !== process.platform)('closing the Copilot driver leaves no agent process (live)', () => {
   const ASK_WAIT_MS = 90000;
   const SETTLE_MS   = 5000;

   const processIds = () => readdirSync('/proc').filter(name => /^\d+$/.test(name)).map(Number);
   const cwdOf      = (pid: number) => { try { return readlinkSync(`/proc/${pid}/cwd`); } catch { return undefined; } };
   /** Processes (other than this test) whose working directory is the throwaway one. */
   const agents     = () => processIds().filter(pid => pid !== process.pid && dir === cwdOf(pid));

   it('[H] close with a turn in flight leaves no process', async () => {
      const driver = createCopilotAcpDriver({ logger: createMockLogger() });
      let asked = false;
      const turn = driver.execute('Run the shell command `sleep 30; ls .`, then say done.', {
         onToolCall: async report => {
            asked = true;
            return report.command?.includes('sleep 30') ? 'approve' : 'deny';
         },
      }).catch(() => undefined);
      await until(() => asked, ASK_WAIT_MS);
      await realSleep(3000);
      const before = agents();
      console.log('live before close:', JSON.stringify({ asked, processes: before.length }));
      expect(before.length).toBeGreaterThan(0);

      await driver.close();
      await turn;
      const gone = await until(() => 0 === agents().length, SETTLE_MS);
      console.log('live after close:', JSON.stringify({ gone, left: agents().length }));
      expect(gone).toBe(true);
   }, CLOSE_TIMEOUT_MS);
});

describe.skipIf('win32' === process.platform)('copilot in autopilot mode (live, record only)', () => {
   it('records whether permission requests still arrive for a command and for an edit', async () => {
      const handle = await spawnAgent({ command: COPILOT_COMMAND, args: COPILOT_ARGS, cwd: dir });
      let requests = 0;
      const connection = client({ name: 'autopilot-probe' })
         .onRequest(methods.client.session.requestPermission, async () => {
            requests += 1;
            return { outcome: { outcome: 'cancelled' as const } };
         })
         .connect(handle.stream);
      try {
         await connection.agent.request(
            methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} },
         );
         const created = await connection.agent.request(methods.agent.session.new, { cwd: dir, mcpServers: [] });
         await connection.agent.request(methods.agent.session.setConfigOption, {
            sessionId: created.sessionId, configId: 'mode', value: `${MODES}#autopilot`,
         });
         for (const [what, prompt, file] of [
            ['command', 'Run the shell command `touch live-autopilot.txt`.', 'live-autopilot.txt'],
            ['edit',
               'Use your file writing tool, not a shell command, '
               + 'to create live-autopilot-edit.txt containing the word hi.',
               'live-autopilot-edit.txt'],
         ]) {
            const before = requests;
            await connection.agent.request(methods.agent.session.prompt, {
               sessionId: created.sessionId, prompt: [{ type: 'text', text: prompt }],
            });
            console.log('live autopilot:', JSON.stringify({
               what, permissionRequests: requests - before, fileExists: existsSync(join(dir, file)),
            }));
         }
      }
      finally { await endAgent(handle); }
   }, AUTOPILOT_TIMEOUT_MS);
});

describeAdversarialRun({
   agent: 'copilot',
   make:  () => createCopilotAcpDriver({ logger: createMockLogger() }),
});
