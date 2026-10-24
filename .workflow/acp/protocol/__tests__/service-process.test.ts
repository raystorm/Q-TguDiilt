import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_FAILURE_KIND } from '../../drivers/acp-driver-core/errors.js';
import { goneWithin, isAlive } from '../../drivers/acp-driver-core/__tests__/stub-agent.helpers.js';
import {
   exampleRegistry,
   exitWithin,
   registryWithExtra,
   startService,
   until,
   type DiagnosticRecord,
   type ServiceExit,
} from './service-process.helpers.js';

const INITIALIZE = { protocolVersion: 1, clientCapabilities: {} };
const SLOW_START = 30000;

const promptOf = (sessionId: string) => ({ sessionId, prompt: [{ type: 'text', text: 'go' }] });

type Service = ReturnType<typeof startService>;

let service: Service | undefined;
afterEach(async () => { await service?.stop(); service = undefined; });

describe.skipIf('win32' === process.platform)('the real service', () => {
   it.each([
      ['stdin closed', (s: Service) => { s.child.stdin.end(); }],
      ['SIGTERM',      (s: Service) => { s.child.kill('SIGTERM'); }],
      ['SIGINT',       (s: Service) => { s.child.kill('SIGINT'); }],
      ['SIGHUP',       (s: Service) => { s.child.kill('SIGHUP'); }],
   ])('[H] %s ends the service, the agent that holds a turn, and its grandchild', async (_trigger, fire) => {
      const running = service = startService('grandchild,hold-prompt');
      await running.request('initialize', INITIALIZE);
      const created = await running.request('session/new', { cwd: running.cwd, mcpServers: [] });
      void running.request('session/prompt', {
         sessionId: created.result.sessionId, prompt: [{ type: 'text', text: 'go' }],
      });
      expect(await until(() => running.stub.events().includes('prompt')), running.stderr()).toBe(true);
      const { pid, grandchild } = running.stub.state();
      expect(isAlive(pid)).toBe(true);
      expect(isAlive(grandchild as number)).toBe(true);

      fire(running);
      expect(await exitWithin(running.exited, 10000)).toEqual({ code: 0, signal: null });
      expect(running.log().filter(entry => 'disconnect' === entry.event)).toHaveLength(1);
      expect(await goneWithin(pid)).toBe(true);
      expect(await goneWithin(grandchild as number)).toBe(true);
   }, SLOW_START);

   it('with no agent started, SIGTERM ends the service promptly and starts nothing', async () => {
      const running = service = startService();
      await running.request('initialize', INITIALIZE);
      running.child.kill('SIGTERM');
      expect(await exitWithin(running.exited, 10000)).toEqual({ code: 0, signal: null });
      expect(running.log().filter(entry => 'disconnect' === entry.event)).toHaveLength(1);
      expect(existsSync(join(running.stub.dir, 'state.json'))).toBe(false);
   }, SLOW_START);

   it('[H] serves a session on the example registry; SIGTERM ends it', async () => {
      const running = service = startService();
      const init    = await running.request('initialize', INITIALIZE);
      expect(typeof init.result.protocolVersion).toBe('number');
      const created = await running.request('session/new', { cwd: running.cwd, mcpServers: [] });
      expect(typeof created.result.sessionId).toBe('string');
      const prompted = await running.request('session/prompt', promptOf(created.result.sessionId));
      expect(prompted.result).toEqual({ stopReason: 'end_turn' });
      running.child.kill('SIGTERM');
      expect(await exitWithin(running.exited, 10000)).toEqual({ code: 0, signal: null });
   }, SLOW_START);

   it('[H] the model of the registry defaults reaches the agent', async () => {
      const running = service = startService();
      await running.request('initialize', INITIALIZE);
      const created = await running.request('session/new', { cwd: running.cwd, mcpServers: [] });
      await running.request('session/prompt', promptOf(created.result.sessionId));
      expect(running.stub.events()).toContain(`model:${exampleRegistry().preferred?.model}`);
   }, SLOW_START);

   it('[H] a missing registry file stops the service before it answers', async () => {
      const absent  = join(tmpdir(), `no-registry-${process.pid}-${Date.now()}.yaml`);
      const running = service = startService('', absent);
      let answered  = false;
      void running.request('initialize', INITIALIZE).then(() => { answered = true; });
      const exit = await exitWithin(running.exited, 20000);
      expect(exit).not.toBe('timeout');
      expect((exit as ServiceExit).code).toBeGreaterThan(0);
      expect(answered).toBe(false);
      // The file and the example are both named, in the error and in the service log.
      expect(running.stderr()).toContain(absent);
      expect(running.stderr()).toContain('registry.example.yaml');
      const logged = running.log().some(entry => 'error' === entry.level && absent === entry.filePath);
      expect(logged).toBe(true);
   }, SLOW_START);
});

const FIXTURES = join(
   dirname(fileURLToPath(import.meta.url)), '..', '..', 'drivers', '__tests__', 'fixtures',
   'driver-modules',
);
const THROWS_SECRET = join(FIXTURES, 'throws-secret-on-import.js');
const SECRET        = 'abc123def';
const CANARY        = 'CANARY-STDERR-9z';

const isFailure = (record: DiagnosticRecord) => 'agent_failure' === record.event;
const blockDiagnosticLog = (cwd: string) =>
   mkdirSync(join(cwd, '.workflow', 'work', 'acp-diagnostic.log'), { recursive: true });

/** Initializes, opens a session and prompts once; the answer to the prompt. */
async function promptOnce(running: Service) {
   await running.request('initialize', INITIALIZE);
   const created = await running.request('session/new', { cwd: running.cwd, mcpServers: [] });
   return running.request('session/prompt', promptOf(created.result.sessionId));
}

/** The text of the error a failed prompt answers with. */
const errorText = (answer: any): string => answer.error.data.details;

describe.skipIf('win32' === process.platform)('the real service — diagnostic log', () => {
   const registryDirs: string[] = [];
   afterEach(() => {
      for (const dir of registryDirs.splice(0)) { rmSync(dir, { recursive: true, force: true }); }
   });

   it('[H] a failure before initialize leaves a complete record the chat error names', async () => {
      const running = service = startService('exit-before-initialize', undefined, {
         env: { STUB_STDERR: `starting failed token=${SECRET} ${CANARY}\n` },
      });
      const text = errorText(await promptOnce(running));
      expect(text.split('\n').pop()).toBe(`full record: ${running.diagnosticPath}`);
      const records = running.diagnosticLog().filter(isFailure);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ kind: AGENT_FAILURE_KIND.exited });
      const file = running.diagnosticText();
      expect(file.split(CANARY)).toHaveLength(2);
      expect(file).toContain('token=[redacted]');
      expect(file).not.toContain(SECRET);
      expect(statSync(running.diagnosticPath).mode & 0o777).toBe(0o600);
      const serviceLog = JSON.stringify(running.log());
      expect(serviceLog).not.toContain(CANARY);
      expect(serviceLog).not.toContain(SECRET);
   }, SLOW_START);

   it('[H] a crash in a turn joins to the service log by pid and agent session', async () => {
      const running = service = startService('crash-on-prompt');
      await promptOnce(running);
      const [record] = running.diagnosticLog().filter(isFailure);
      expect(record).toMatchObject({
         signal: 'SIGKILL', agentSessionId: 'stub-session', pid: running.stub.state().pid,
      });
      expect(record).not.toHaveProperty('exitCode');
      const ended = () => running.log().filter(entry => 'agent_process_ended' === entry.event);
      expect(await until(() => 0 < ended().length)).toBe(true);
      expect(ended()).toMatchObject([{ pid: record.pid, agentSessionId: 'stub-session' }]);
   }, SLOW_START);

   it('[H] an unusable diagnostic file does not stop the service', async () => {
      const running = service = startService('crash-on-prompt', undefined, {
         prepare: blockDiagnosticLog,
      });
      const init     = await running.request('initialize', INITIALIZE);
      const created  = await running.request('session/new', { cwd: running.cwd, mcpServers: [] });
      const prompted = await running.request('session/prompt', promptOf(created.result.sessionId));
      expect(typeof init.result.protocolVersion).toBe('number');
      expect(typeof created.result.sessionId).toBe('string');
      const warnings = running.log()
         .filter(entry => 'warn' === entry.level && undefined !== entry.code);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].path).toBeUndefined();
      expect(errorText(prompted)).not.toContain('full record:');
      expect(running.stderr()).not.toContain('acp-diagnostic');
   }, SLOW_START);

   it('a healthy turn leaves no record, and the service log names the file once', async () => {
      const running = service = startService();
      expect((await promptOnce(running)).result).toEqual({ stopReason: 'end_turn' });
      expect(running.diagnosticLog().filter(isFailure)).toEqual([]);
      const naming = running.log().filter(entry => running.diagnosticPath === entry.path);
      expect(naming).toHaveLength(1);
   }, SLOW_START);

   it('[H] free text in the service log is redacted', async () => {
      const registry = registryWithExtra({ secret: { module: THROWS_SECRET, models: ['auto'] } });
      registryDirs.push(dirname(registry));
      const running = service = startService('', registry);
      await running.request('initialize', INITIALIZE);
      const failed = running.log()
         .filter(entry => 'secret' === entry.name && undefined !== entry.reason);
      expect(failed).toHaveLength(1);
      expect(failed[0].reason).toContain('token=[redacted]');
      expect(JSON.stringify(running.log())).not.toContain(SECRET);
   }, SLOW_START);
});
