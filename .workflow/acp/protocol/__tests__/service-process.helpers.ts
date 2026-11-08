import { spawn } from 'node:child_process';
import {
   existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistryConfig } from '../../drivers/registry.js';
import { realSleep, startStub, stubKiroCliBin } from '../../drivers/acp-driver-core/__tests__/stub-agent.helpers.js';
import { REGISTRY_ENV } from './registry-location.process.js';

const ACP_ROOT  = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VITE_NODE = join(ACP_ROOT, 'node_modules', 'vite-node', 'vite-node.mjs');
const ENTRY     = join(ACP_ROOT, 'protocol', 'index.ts');

const TESTS_DIR        = join(ACP_ROOT, 'protocol', '__tests__');
const VITE_CONFIG      = join(TESTS_DIR, 'service-process.vite.config.ts');
const EXAMPLE_REGISTRY = join(ACP_ROOT, 'drivers', 'registry.example.yaml');

/** The shipped example, never the local registry.yaml: what the process tests start the service on. */
export const exampleRegistry = () => loadRegistryConfig(EXAMPLE_REGISTRY);

export interface ServiceExit { code: number | null; signal: string | null }

/** One entry of the service's operational log. */
export interface ServiceLogEntry {
   event:           string;
   level:           string;
   filePath?:       string;
   name?:           string;
   profile?:        string;
   source?:         string;
   reason?:         string;
   path?:           string;
   pid?:            number;
   agentSessionId?: string;
   code?:           string;
}

/** One line of the diagnostic log. */
export interface DiagnosticRecord {
   event:           string;
   kind:            string;
   message:         string;
   driver:          string;
   pid?:            number;
   agentSessionId?: string;
   exitCode?:       number;
   signal?:         string;
   tail?:           string;
}

/** Extra settings for one run of the service. */
export interface ServiceOptions {
   /** Environment for the service and the agent it starts (the stub reads STUB_STDERR). */
   env?:     Record<string, string>;
   /** Runs in the working directory before the service starts. */
   prepare?: (cwd: string) => void;
}

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
   const args  = [VITE_NODE, '--root', ACP_ROOT, '--config', VITE_CONFIG, ENTRY];
   const child = spawn(process.execPath, args, {
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
   const diagnosticPath = join(realpathSync(cwd), '.workflow', 'work', 'acp-diagnostic.log');
   const diagnosticFile = (): string => {
      const stats = statSync(diagnosticPath, { throwIfNoEntry: false });
      return stats?.isFile() ? readFileSync(diagnosticPath, 'utf8') : '';
   };

   return {
      child, cwd, exited, request, diagnosticPath,
      stderr: () => stderr,
      /** The entries of the service's operational log. */
      log: (): ServiceLogEntry[] => existsSync(logPath)
         ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [],
      /** The diagnostic log as text; empty when there is no file. */
      diagnosticText: diagnosticFile,
      /** The records of the diagnostic log; none when there is no file. */
      diagnosticLog: (): DiagnosticRecord[] =>
         diagnosticFile().split('\n').filter(Boolean).map(line => JSON.parse(line)),
   };
}

async function endService({ child, exited }: ReturnType<typeof launch>) {
   if (null === child.exitCode && null === child.signalCode) { child.kill('SIGKILL'); }
   await exited;
}

/**
 * Starts the real service as a process, in a temporary working directory, with a stub `kiro-cli`
 * first on PATH. The test talks ACP to it over its stdio. Its registry is the shipped example
 * unless `registry` names another file. `stop` ends whatever is left and cleans up.
 */
export function startService(
   behaviour = '', registry = EXAMPLE_REGISTRY, { env = {}, prepare }: ServiceOptions = {},
) {
   // The stub offers the models of the example's kiro driver, so it follows the example.
   const models  = exampleRegistry().drivers.kiro.models.join(',');
   const stub    = startStub(behaviour, { STUB_MODELS: models, ...env });
   const bin     = stubKiroCliBin();
   const cwd     = mkdtempSync(join(tmpdir(), 'service-cwd-'));
   prepare?.(cwd);
   const service = launch(cwd, { ...process.env, PATH: bin, [REGISTRY_ENV]: registry });
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
   const env     = { ...process.env, [REGISTRY_ENV]: EXAMPLE_REGISTRY };
   const service = launch(cwd, env, onMessage);
   return {
      ...service,
      async stop() {
         await endService(service);
         rmSync(cwd, { recursive: true, force: true });
      },
   };
}

type DriverEntry = { module: string; models: string[] };

/** A registry file in a new temp folder (the caller removes it): the example's kiro + `extra`. */
export function registryWithExtra(extra: Record<string, DriverEntry>): string
{
   const example = exampleRegistry();
   const kiro    = {
      module: join(ACP_ROOT, 'drivers', 'kiro-driver-acp.js'),
      models: example.drivers.kiro.models,
   };
   const file    = join(mkdtempSync(join(tmpdir(), 'service-registry-')), 'registry.yaml');
   const text    = JSON.stringify({ preferred: example.preferred, drivers: { kiro, ...extra } });
   writeFileSync(file, text);
   return file;
}
