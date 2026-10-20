/**
 * Live tests of the Kiro driver against the real `kiro-cli`. Manual only: they cost money and need a
 * logged-in kiro-cli on PATH. Excluded from `npm test`. Run the whole file, or one group with `-t`:
 *
 *    npx vitest run --config vitest.integration.config.ts drivers/__integration__/kiro.integration.test.ts
 *    npx vitest run --config vitest.integration.config.ts \
 *       drivers/__integration__/kiro.integration.test.ts -t "cancel with the real"
 *
 * The groups: a plain turn, governance in front of kiro-cli, cancel, the whole service (Linux only), and
 * the adversarial run (the controls and the destructive commands; LIVE_CASES overrides, LIVE_CASES= skips).
 * Every prompt is tiny and runs in a throwaway directory. The fake IDE rejects every request except the
 * harmless controls: `touch live-allow.txt` (governance group) and `sleep 30; ls .` (cancel and service).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGovernanceEngine } from '../../governance/engine.js';
import {
   createCx, createLogger, detailsOf, eventsOf, makeAgent, newSessionArgs, requestsOf, textParam,
} from '../../protocol/__tests__/agent.helpers.js';
import { exitWithin, startLiveService, until } from '../../protocol/__tests__/service-process.helpers.js';
import { CANCEL_DEADLINE_MS } from '../acp-client/acp-driver.js';
import { createLogger as createMockLogger } from '../acp-client/__tests__/acp-driver.helpers.js';
import { realSleep } from '../acp-client/__tests__/stub-agent.helpers.js';
import type { DriverResult } from '../governed-driver.js';
import { createKiroAcpDriver } from '../kiro-driver-acp.js';
import { describeAdversarialRun } from './adversarial.js';

console.log(`live run: ${execFileSync('kiro-cli', ['--version'], { encoding: 'utf8' }).trim()}`);

const CONFIG = fileURLToPath(new URL('../../governance/config.yaml', import.meta.url));

const PLAIN_TIMEOUT_MS      = 120000;
const GOVERNANCE_TIMEOUT_MS = 180000;
const CANCEL_TIMEOUT_MS     = 180000;
const SERVICE_TIMEOUT_MS    = 240000;

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

describe('kiro-cli through the ACP driver (live)', () => {
   it('[H] setup and verify pass, and a plain turn returns text and no tool calls', async () => {
      const logger = createMockLogger();
      const driver = createKiroAcpDriver({ logger });
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

describe.skipIf('win32' === process.platform)('governance in front of the real kiro-cli (live)', () => {
   const CONTROL = 'live-allow.txt';

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
         ? 'Kiro ran it without a request'
         : 'asked and approved by rule');
   }, GOVERNANCE_TIMEOUT_MS);

   it('[H] an asked command that the IDE rejects does not run', async () => {
      const run = await liveTurn('Run the shell command `touch live-reject.txt`.');
      expect(existsSync(join(dir, 'live-reject.txt'))).toBe(false);
      expect(requestsOf(run.cx).length).toBeGreaterThan(0);
      expect(run.calls.filter(call => 'touch live-reject.txt' === call.command).map(call => call.decision))
         .toContain('deny');
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

describe.skipIf('win32' === process.platform)('cancel with the real kiro-cli (live)', () => {
   const REQUEST_WAIT_MS = 90000;
   const SLACK_MS        = 3000;

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
      console.log('live cancel:', JSON.stringify({
         stopReason: stop.stopReason, ms: took, deadlineEntries: deadline.length,
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

describe.skipIf('linux' !== process.platform)('the whole service over the real kiro-cli (live)', () => {
   const ASK_WAIT_MS      = 90000;
   const RUNNING_MS       = 3000;
   const SERVICE_EXIT_MS  = 10000;
   const SETTLE_MS        = 5000;
   const SIGKILL_WATCH_MS = 30000;

   const processIds = () => readdirSync('/proc').filter(name => /^\d+$/.test(name)).map(Number);
   const cwdOf      = (pid: number) => { try { return readlinkSync(`/proc/${pid}/cwd`); } catch { return undefined; } };
   const groupOf    = (pid: number) => {
      try { return Number(readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /, '').split(' ')[2]); }
      catch { return undefined; }
   };
   const nameOf     = (pid: number) => {
      try { return readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); }
      catch { return undefined; }
   };

   /** The real service, a turn in flight (Kiro asked about `sleep 30; ls .`, the IDE allowed it, it is running). */
   async function turnInFlight() {
      let detail = '';
      let asked  = false;
      const service = startLiveService(message => {
         if ('session/update' === message.method && 'tool_call' === message.params?.update?.sessionUpdate) {
            detail = JSON.stringify(message.params.update);
         }
         if ('session/request_permission' === message.method) {
            asked = true;
            const allowed = (detail + JSON.stringify(message.params)).includes('sleep 30');
            return { outcome: { outcome: 'selected', optionId: allowed ? 'allow' : 'reject' } };
         }
         return undefined;
      });
      // The service shares the test runner's process group; the agent is started in its own.
      const shared = new Set([groupOf(process.pid), groupOf(service.child.pid as number)]
         .filter((group): group is number => undefined !== group));
      await service.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
      const created = await service.request('session/new', { cwd: service.cwd, mcpServers: [] });
      void service.request('session/prompt', {
         sessionId: created.result.sessionId,
         prompt:    [{ type: 'text', text: 'Run the shell command `sleep 30; ls .`, then say done.' }],
      });
      await until(() => asked, ASK_WAIT_MS);
      await realSleep(RUNNING_MS);
      /** Processes (other than the service and this test) whose working directory is the service's. */
      const agents = () => processIds().filter(pid => pid !== service.child.pid && pid !== process.pid
         && service.cwd === cwdOf(pid) && !shared.has(groupOf(pid) as number));
      return { service, agents, wasAsked: () => asked };
   }

   let live: Awaited<ReturnType<typeof turnInFlight>> | undefined;
   afterEach(async () => {
      for (const pid of live?.agents() ?? []) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
      await live?.service.stop();
      live = undefined;
   });

   it.each([
      ['stdin closed', (service: { child: any }) => { service.child.stdin.end(); }],
      ['SIGTERM',      (service: { child: any }) => { service.child.kill('SIGTERM'); }],
   ])('[H] %s with a turn in flight leaves no agent process', async (_trigger, fire) => {
      const run     = live = await turnInFlight();
      const before  = run.agents();
      const groups  = new Set(before.map(groupOf).filter((group): group is number => undefined !== group));
      const inGroup = (pid: number) => { const group = groupOf(pid); return undefined !== group && groups.has(group); };
      console.log('live before:', JSON.stringify({
         asked: run.wasAsked(), processes: before.map(nameOf), groups: groups.size,
      }));
      expect(before.length).toBeGreaterThan(0);

      const started = Date.now();
      fire(run.service);
      const exit = await exitWithin(run.service.exited, SERVICE_EXIT_MS);
      console.log('live service exit:', JSON.stringify({ exit, ms: Date.now() - started }));
      expect(exit).toEqual({ code: 0, signal: null });

      const gone = await until(() => 0 === run.agents().length && !processIds().some(inGroup), SETTLE_MS);
      console.log('live after:', JSON.stringify({ gone, left: run.agents().length }));
      expect(gone).toBe(true);
      expect(run.service.log().filter(entry => 'disconnect' === entry.event)).toHaveLength(1);
   }, SERVICE_TIMEOUT_MS);

   it('records how long the agent takes to exit when the service is killed outright (accepted risk)', async () => {
      const run    = live = await turnInFlight();
      const before = run.agents();
      expect(before.length).toBeGreaterThan(0);
      run.service.child.kill('SIGKILL');
      const started = Date.now();
      const gone    = await until(() => 0 === run.agents().length, SIGKILL_WATCH_MS);
      console.log('live after SIGKILL of the service:', JSON.stringify({
         processesBefore: before.length, gone, goneAfterMs: Date.now() - started,
      }));
   }, SERVICE_TIMEOUT_MS);
});

describeAdversarialRun({
   agent: 'kiro',
   make:  () => createKiroAcpDriver({ logger: createMockLogger() }),
});
