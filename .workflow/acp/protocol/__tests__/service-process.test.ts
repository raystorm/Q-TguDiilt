import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { goneWithin, isAlive } from '../../drivers/acp-driver-core/__tests__/stub-agent.helpers.js';
import {
   exampleRegistry,
   exitWithin,
   startService,
   until,
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
