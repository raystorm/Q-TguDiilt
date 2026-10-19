/**
 * Live test of the whole service against the real `kiro-cli`: the entry point runs as its own process,
 * a turn is in flight, then stdin closes or a signal arrives. Linux only (it reads /proc). Manual only:
 * it costs money and needs a logged-in kiro-cli on PATH. Excluded from `npm test`. Run one file at a time:
 *
 *    npx vitest run --config vitest.integration.config.ts drivers/__integration__/kiro-service.integration.test.ts
 *
 * Every prompt is tiny and runs in a throwaway directory. The fake IDE allows only `sleep 30; ls .`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { exitWithin, startLiveService, until } from '../../protocol/__tests__/service-process.helpers.js';
import { realSleep } from '../acp-client/__tests__/stub-agent.helpers.js';

console.log(`live run: ${execFileSync('kiro-cli', ['--version'], { encoding: 'utf8' }).trim()}`);

const LIVE_TIMEOUT_MS  = 240000;
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
const nameOf     = (pid: number) => { try { return readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch { return undefined; } };

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

describe.skipIf('linux' !== process.platform)('the whole service over the real kiro-cli (live)', () => {
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
   }, LIVE_TIMEOUT_MS);

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
   }, LIVE_TIMEOUT_MS);
});
