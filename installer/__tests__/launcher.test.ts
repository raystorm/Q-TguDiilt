/**
 * The launcher as a user starts it: `node install.mjs <target> --dry-run` as a child process, with
 * the real checkout as the engine. It proves the launcher registers `tsx` and the `.js` imports
 * resolve. Nothing is written to the target.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { cleanup, tempDir, tree } from './engine.js';

afterEach(cleanup);

const LAUNCHER = join(dirname(fileURLToPath(import.meta.url)), '..', 'install.mjs');

it('starts through tsx, prints the creates for the real engine and writes nothing', () =>
{
   const target = tempDir('installer-target-');

   const child = spawnSync(
      process.execPath,
      [LAUNCHER, target, '--dry-run'],
      { encoding: 'utf8', timeout: 60000 },
   );

   expect(child.status, child.stderr).toBe(0);
   expect(child.stdout.split('\n').some((line) => line.startsWith('create .workflow/rules/'))).toBe(true);
   expect(tree(target)).toEqual({});
}, 60000);
