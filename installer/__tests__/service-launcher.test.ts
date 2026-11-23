/**
 * The service launcher as the IDE starts it: `node <target>/.workflow/acp/start.mjs` as a child process,
 * in a target installed from the real checkout. The checkout is only read.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../run.js';
import { childEnv, cleanup, recordingIo, tempDir } from './engine.js';

const REPO    = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULES = join(REPO, '.workflow', 'acp', 'node_modules');

let target: string;
let acp:    string;

beforeAll(() =>
{
   target = realpathSync(tempDir('installer-target-'));
   run([target], recordingIo().io, REPO);
   acp = join(target, '.workflow', 'acp');
});

afterAll(cleanup);

/** The target's `node_modules` made of links to the checkout's, less the packages in `leave`. */
function linkModules(leave: string[] = []): void
{
   const folder = join(acp, 'node_modules');
   rmSync(folder, { recursive: true, force: true });
   mkdirSync(folder);
   for (const name of readdirSync(MODULES))
   {
      if (!leave.includes(name)) { symlinkSync(join(MODULES, name), join(folder, name)); }
   }
}

/** Starts the launcher in the target with its input closed. */
const start = () => spawnSync(
   process.execPath,
   [join(acp, 'start.mjs')],
   { cwd: target, encoding: 'utf8', input: '', timeout: 30000, env: childEnv() },
);

type Child = ReturnType<typeof start>;

/** The clear error: a first line that names the command and the folder, then the original error line. */
function expectMissingDependencies(child: Child): void
{
   const [first, second] = child.stderr.split('\n');
   expect(child.status).toBeGreaterThan(0);
   expect(child.stdout).toBe('');
   expect(first).toContain('not installed');
   expect(first).toContain('npm ci --omit=dev');
   expect(first).toContain(acp);
   expect(second).toMatch(/Cannot find package '/);
}

describe('starting the service from an installed target', () =>
{
   it('says the dependencies are not installed when there is no node_modules', () =>
   {
      rmSync(join(acp, 'node_modules'), { recursive: true, force: true });

      expectMissingDependencies(start());
   }, 30000);

   it('says the same when one package the service imports is missing', () =>
   {
      linkModules(['js-yaml']);

      const child = start();

      expectMissingDependencies(child);
      expect(child.stderr).toContain('js-yaml');
   }, 30000);

   it('shows the service\'s own error, unchanged, when only the registry is missing', () =>
   {
      linkModules();
      rmSync(join(acp, 'drivers', 'registry.yaml'));

      const child = start();

      expect(child.status).toBeGreaterThan(0);
      expect(child.stdout).toBe('');
      expect(child.stderr).toContain('registry.yaml');
      expect(child.stderr).not.toContain('not installed');
   }, 30000);
});
