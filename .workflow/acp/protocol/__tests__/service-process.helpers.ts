import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realSleep, startStub, stubKiroCliBin } from '../../drivers/acp-driver-core/__tests__/stub-agent.helpers.js';

const ACP_ROOT  = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VITE_NODE = join(ACP_ROOT, 'node_modules', 'vite-node', 'vite-node.mjs');
const ENTRY     = join(ACP_ROOT, 'protocol', 'index.ts');

export interface ServiceExit { code: number | null; signal: string | null }

/** Sees every message the service sends; what it returns answers a request (and is ignored otherwise). */
type OnMessage = (message: any) => unknown;

/** Polls until the condition holds; false if it still does not after `ms`. */
export async function until(condition: () => boolean, ms = 10000): Promise<boolean> {
   for (let waited = 0; waited < ms && !condition(); waited += 20) { await realSleep(20); }
   return condition();
}

/** The exit, or 'timeout' if the process is still running after `ms`. */
export const exitWithin = (exited: Promise<ServiceExit>, ms: number) =>
   Promise.race([exited, realSleep(ms).then(() => 'timeout' as const)]);

/** Runs the entry point as a process in `cwd` and talks ACP to it over its stdio. */
function launch(cwd: string, env: NodeJS.ProcessEnv, onMessage?: OnMessage) {
   const child = spawn(process.execPath, [VITE_NODE, '--root', ACP_ROOT, ENTRY], {
      cwd, env, stdio: ['pipe', 'pipe', 'pipe'],
   });
   child.stdin.on('error', () => undefined);

   let stderr = '';
   child.stderr.setEncoding('utf8');
   child.stderr.on('data', text => { stderr += text; });

   const pending = new Map<number, (message: any) => void>();
   let buffer = '';
   child.stdout.setEncoding('utf8');
   child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      for (let end = buffer.indexOf('\n'); -1 !== end; end = buffer.indexOf('\n')) {
         const line = buffer.slice(0, end);
         buffer = buffer.slice(end + 1);
         if ('' === line.trim()) { continue; }
         const message = JSON.parse(line);
         if ('method' in message) {
            // From the service: a request or a notification, never a response to ours.
            if (undefined === onMessage) { continue; }
            const answer = onMessage(message);
            if (undefined !== message.id) {
               void Promise.resolve(answer).then(
                  result => child.stdin.write(
                     `${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: result ?? {} })}\n`,
                  ),
                  () => undefined,
               );
            }
            continue;
         }
         pending.get(message.id)?.(message);
      }
   });

   const exited = new Promise<ServiceExit>(resolve => {
      child.once('close', (code, signal) => resolve({ code, signal }));
   });

   let nextId = 1;
   /** Sends a request; resolves with the service's response. */
   const request = (method: string, params: unknown) => new Promise<any>(resolve => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
   });

   const logPath = join(cwd, '.workflow', 'work', 'acp.log');

   return {
      child, cwd, exited, request,
      stderr: () => stderr,
      /** The entries of the service's operational log. */
      log: (): Array<{ event: string }> => existsSync(logPath)
         ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [],
   };
}

async function endService({ child, exited }: ReturnType<typeof launch>) {
   if (null === child.exitCode && null === child.signalCode) { child.kill('SIGKILL'); }
   await exited;
}

/**
 * Starts the real service as a process, in a temporary working directory, with a stub `kiro-cli`
 * first on PATH. The test talks ACP to it over its stdio. `stop` ends whatever is left and cleans up.
 */
export function startService(behaviour = '') {
   const stub    = startStub(behaviour);
   const bin     = stubKiroCliBin();
   const cwd     = mkdtempSync(join(tmpdir(), 'service-cwd-'));
   const service = launch(cwd, { ...process.env, PATH: bin });
   return {
      ...service, stub,
      async stop() {
         await endService(service);
         stub.stop();
         rmSync(bin, { recursive: true, force: true });
         rmSync(cwd, { recursive: true, force: true });
      },
   };
}

/** The same with the real PATH, so the real `kiro-cli` is the agent. For live runs only. */
export function startLiveService(onMessage: OnMessage) {
   const cwd     = realpathSync(mkdtempSync(join(tmpdir(), 'service-live-')));
   const service = launch(cwd, process.env, onMessage);
   return {
      ...service,
      async stop() {
         await endService(service);
         rmSync(cwd, { recursive: true, force: true });
      },
   };
}
