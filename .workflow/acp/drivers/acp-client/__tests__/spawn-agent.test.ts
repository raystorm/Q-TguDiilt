import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnAgent } from '../connect.js';
import type { AgentHandle } from '../types.js';
import { STUB_AGENT, startStub } from './stub-agent.helpers.js';

const launch = (args: string[] = [], cwd = process.cwd()) =>
   ({ command: process.execPath, args: [STUB_AGENT, ...args], cwd });
const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } };
const finish = (handle: AgentHandle) => { handle.closeStdin(); return handle.exited; };

let stub: ReturnType<typeof startStub> | undefined;
afterEach(() => { stub?.stop(); stub = undefined; vi.restoreAllMocks(); });

describe.skipIf('win32' === process.platform)('spawning a real process', () => {
   it('[H] a missing command rejects with ENOENT and starts nothing', async () => {
      await expect(spawnAgent({ command: 'no-such-agent-command', args: [], cwd: process.cwd() }))
         .rejects.toMatchObject({ code: 'ENOENT' });
   });

   it('[H] the arguments and the working directory reach the process unchanged, with no shell', async () => {
      stub = startStub();
      const cwd  = realpathSync(mkdtempSync(join(tmpdir(), 'stub-cwd-')));
      const args = ['a b', '$(touch pwned)', ';echo hi', '"q"'];
      try {
         await finish(await spawnAgent(launch(args, cwd)));
         expect(stub.state()).toMatchObject({ argv: args, cwd });
         expect(existsSync(join(cwd, 'pwned'))).toBe(false);
      }
      finally { rmSync(cwd, { recursive: true, force: true }); }
   });

   it('[H] the exit is reported after stdio closed, so the last words are complete and replayed', async () => {
      stub = startStub('exit-before-initialize', { STUB_STDERR: 'last words\n' });
      const handle = await spawnAgent(launch());
      expect(await handle.exited).toMatchObject({ code: 1 });
      const heard: string[] = [];
      handle.onStderr(text => heard.push(text));
      expect(heard.join('')).toBe('last words\n');
      expect(handle.hasExited()).toBe(true);
   });

   it('[H] a line that is not JSON ends the stream and says so on stderr', async () => {
      stub = startStub('garbage-stdout');
      const handle = await spawnAgent(launch());
      const writer = handle.stream.writable.getWriter();
      await writer.write(initialize as any);
      expect((await handle.stream.readable.getReader().read()).done).toBe(true);
      const heard: string[] = [];
      handle.onStderr(text => heard.push(text));
      expect(heard.join('')).toContain('not JSON');
      writer.releaseLock();
      await finish(handle);
   });

   it('[H] a write to an agent that has exited is dropped without crashing', async () => {
      stub = startStub();
      const handle = await spawnAgent(launch());
      await finish(handle);
      const writer = handle.stream.writable.getWriter();
      await expect(writer.write(initialize as any)).resolves.toBeUndefined();
      handle.closeStdin();
      handle.closeStdin();
   });

   it('[H] nothing is signalled once the process has exited', async () => {
      stub = startStub();
      const handle = await spawnAgent(launch());
      await finish(handle);
      const kill = vi.spyOn(process, 'kill');
      handle.killGroup('SIGTERM');
      handle.killGroup('SIGKILL');
      expect(kill).not.toHaveBeenCalled();
   });
});
