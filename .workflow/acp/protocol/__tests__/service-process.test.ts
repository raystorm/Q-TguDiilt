import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { goneWithin, isAlive } from '../../drivers/acp-driver-core/__tests__/stub-agent.helpers.js';
import { exitWithin, startService, until } from './service-process.helpers.js';

const INITIALIZE = { protocolVersion: 1, clientCapabilities: {} };
const SLOW_START = 30000;

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
});
