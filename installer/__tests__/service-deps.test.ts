/**
 * The production dependencies of the ACP service, worked out from its manifest and lockfile as data:
 * what `npm ci --omit=dev` installs must hold everything `tsx` needs at run time.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface Entry
{
   version?:              string;
   dev?:                  boolean;
   dependencies?:         Record<string, string>;
   optionalDependencies?: Record<string, string>;
}

const readJson = (path: string) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));

const manifest = readJson('.workflow/acp/package.json');
const lock     = readJson('.workflow/acp/package-lock.json') as { packages: Record<string, Entry> };
const pin      = readJson('installer/package.json').dependencies.tsx as string;

/** The lockfile path of the package `name` as code at `from` resolves it: nearest `node_modules` first. */
function resolveFrom(from: string, name: string): string | undefined
{
   for (let base = from; ; )
   {
      const path = '' === base ? `node_modules/${name}` : `${base}/node_modules/${name}`;
      if (path in lock.packages) { return path; }
      if ('' === base) { return undefined; }
      const cut = base.lastIndexOf('/node_modules/');
      base = -1 === cut ? '' : base.slice(0, cut);
   }
}

/** Every package `root` needs at run time (dependencies and optional ones), and the names not found. */
function needs(root: string): { found: Set<string>; missing: string[] }
{
   const found   = new Set<string>([root]);
   const missing: string[] = [];
   const queue   = [root];
   for (let path = queue.pop(); undefined !== path; path = queue.pop())
   {
      const entry = lock.packages[path];
      for (const name of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies }))
      {
         const next = resolveFrom(path, name);
         if (undefined === next) { missing.push(`${name} (needed by ${path})`); }
         else if (!found.has(next))
         {
            found.add(next);
            queue.push(next);
         }
      }
   }
   return { found, missing };
}

it('lists tsx as a production dependency at the installer\'s exact version, the same as the lockfile', () =>
{
   expect(manifest.dependencies.tsx).toMatch(/^\d+\.\d+\.\d+$/);
   expect(manifest.dependencies.tsx).toBe(pin);
   expect(manifest.devDependencies?.tsx).toBeUndefined();
   expect(lock.packages[''].dependencies?.tsx).toBe(pin);
   expect(lock.packages['node_modules/tsx']?.version).toBe(pin);
});

it('keeps every package tsx needs at run time out of the dev-only set', () =>
{
   const { found, missing } = needs('node_modules/tsx');

   expect(missing).toEqual([]);
   expect(found.size).toBeGreaterThan(1);
   expect([...found].filter((path) => true === lock.packages[path].dev).sort()).toEqual([]);
});
