/**
 * The whole path end to end: the real checkout is installed into a temporary target with a fake runner, its
 * dependencies are linked in, and the service is started from the command and arguments the installer
 * wrote. It answers `initialize` over stdio and exits 0 when its input closes. No agent, no network.
 */
import { spawn } from 'node:child_process';
import { existsSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { run } from '../run.js';
import { acpOf, childEnv, cleanup, recordingIo, tempDir } from './engine.js';

afterAll(cleanup);

const REPO    = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULES = join(REPO, '.workflow', 'acp', 'node_modules');
const LIMIT   = 15000;

interface Entry
{
   command: string;
   args:    string[];
}

const INITIALIZE = {
   jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} },
};

it('starts from what the installer wrote, answers initialize and exits 0 when its input closes', async () =>
{
   if (!existsSync(join(MODULES, 'tsx')))
   {
      throw new Error('tsx is not installed in .workflow/acp/node_modules: run npm ci in .workflow/acp/ first');
   }

   const target   = tempDir('installer-round-trip-');
   const recorded = recordingIo();
   recorded.io.node = process.execPath;
   const installed = run([target], recorded.io, REPO);
   expect(installed.code, installed.lines.join('\n')).toBe(0);

   const acp = join(target, '.workflow', 'acp');
   rmSync(join(acp, 'node_modules'), { recursive: true, force: true });
   symlinkSync(MODULES, join(acp, 'node_modules'));
   const [entry] = Object.values(acpOf(recorded.home).agent_servers) as Entry[];
   expect(existsSync(join(acp, 'drivers', 'registry.yaml'))).toBe(true);

   const child = spawn(entry.command, entry.args, { cwd: target, env: childEnv() });
   let errors = '';
   child.stderr.on('data', (chunk) => { errors += chunk; });
   const exited   = new Promise<number | null>((resolve) => child.on('exit', resolve));
   const answered = new Promise<Record<string, unknown>>((resolve, reject) =>
   {
      let text = '';
      const timer = setTimeout(() => reject(new Error(`no answer within ${LIMIT} ms; stderr: ${errors}`)), LIMIT);
      child.on('error', reject);
      child.stdout.on('data', (chunk) =>
      {
         text += chunk;
         const line = text.split('\n').find((candidate) => candidate.includes('"id":1'));
         if (undefined !== line)
         {
            clearTimeout(timer);
            resolve(JSON.parse(line));
         }
      });
      child.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
   });
   try
   {
      const answer = await answered;
      expect(answer.error).toBeUndefined();
      expect(answer.result).toHaveProperty('protocolVersion');
      expect(answer.result).toHaveProperty('agentCapabilities');
      child.stdin.end();
      const late = new Promise<never>((_, reject) =>
         setTimeout(() => reject(new Error(`no exit within ${LIMIT} ms; stderr: ${errors}`)), LIMIT).unref());
      expect(await Promise.race([exited, late]), errors).toBe(0);
   }
   finally { child.kill(); }
}, 60000);
