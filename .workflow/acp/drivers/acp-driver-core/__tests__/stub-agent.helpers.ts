import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAcpDriver } from '../acp-driver.js';
import { spawnAgent } from '../connect.js';
import type { Connect } from '../types.js';
import { createDiagnostics, createLogger } from './acp-driver.helpers.js';

/** The stub agent: a real process that speaks just enough ACP. The script lists its behaviours. */
export const STUB_AGENT = fileURLToPath(new URL('../../__integration__/fixtures/stub-agent.mjs', import.meta.url));

/** A directory holding an executable `kiro-cli` that runs the stub agent. Put it on PATH. */
export function stubKiroCliBin(): string {
   const dir    = mkdtempSync(join(tmpdir(), 'stub-bin-'));
   const script = join(dir, 'kiro-cli');
   writeFileSync(script, `#!/bin/sh\nexec "${process.execPath}" "${STUB_AGENT}" "$@"\n`);
   chmodSync(script, 0o755);
   return dir;
}

// Captured now, so that fake timers in a test never slow the polling below.
const realSetTimeout = globalThis.setTimeout;
export const realSleep = (ms: number) => new Promise<void>(resolve => realSetTimeout(resolve, ms));

export interface StubState { pid: number; argv: string[]; cwd: string; grandchild?: number }

export function isAlive(pid: number): boolean {
   try { process.kill(pid, 0); return true; }
   catch { return false; }
}

/** True once the process is gone; false if it still runs after `ms`. */
export async function goneWithin(pid: number, ms = 3000): Promise<boolean> {
   for (let waited = 0; waited < ms && isAlive(pid); waited += 20) { await realSleep(20); }
   return !isAlive(pid);
}

/** A left-over process of ours is one whose command line says so (Linux; elsewhere nothing is killed). */
const isStub = (pid: number) => {
   try { return /stub-agent|setInterval/.test(readFileSync(`/proc/${pid}/cmdline`, 'utf8')); }
   catch { return false; }
};

/**
 * Prepares the environment the stub reads: its behaviour and a state directory. `stop` restores the
 * environment, ends any stub process that is left and removes the directory.
 */
export function startStub(behaviour = '', extra: Record<string, string> = {}) {
   const dir = mkdtempSync(join(tmpdir(), 'stub-agent-'));
   const env = { STUB_BEHAVIOUR: behaviour, STUB_DIR: dir, ...extra };
   const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
   Object.assign(process.env, env);

   const state  = (): StubState => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
   const events = (): string[] => existsSync(join(dir, 'events.log'))
      ? readFileSync(join(dir, 'events.log'), 'utf8').split('\n').filter(Boolean) : [];

   return {
      dir, state, events,
      stop() {
         for (const [key, value] of Object.entries(before)) {
            if (undefined === value) { delete process.env[key]; } else { process.env[key] = value; }
         }
         try {
            const { pid, grandchild } = state();
            for (const left of [pid, grandchild]) {
               if (undefined !== left && isAlive(left) && isStub(left)) { process.kill(left, 'SIGKILL'); }
            }
         }
         catch { /* no state file, or nothing left */ }
         rmSync(dir, { recursive: true, force: true });
      },
   };
}

/** A core driver over the real connect and the stub agent; `pids` collects the agent pids it starts. */
export function stubDriver() {
   const pids: number[] = [];
   const connect: Connect = async spec => {
      const handle = await spawnAgent(spec);
      pids.push(handle.pid);
      return handle;
   };
   const logger = createLogger();
   const driver = createAcpDriver({
      name: 'stub', connect, launch: { command: process.execPath, args: [STUB_AGENT] }, logger,
      diagnostics: createDiagnostics(null),
   });
   return { driver, pids, logger };
}
