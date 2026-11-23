/**
 * A folder where a file of the install belongs ends the run with a message that names the path, and
 * nothing is written. A file where a parent folder belongs fails only that write, as it always has.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { again, cleanup, put, start, tree } from './engine.js';

afterEach(cleanup);

/** A line that is part of a stack trace, or a raw system error name. */
const raw = (line: string) => /^\s*at /.test(line) || line.includes('EISDIR');

describe('a folder where a file belongs', () =>
{
   const PATHS = [
      { name: 'a copied file',               path: '.workflow/rules/foundation/fake-rule.md' },
      { name: 'a generated prompt',          path: '.kiro/prompts/fake-prompt.md' },
      { name: 'a generated skill',           path: '.agents/skills/fake-prompt/SKILL.md' },
      { name: 'a nested ignore file',        path: '.kiro/prompts/.gitignore' },
      { name: 'a file the installer writes', path: '.amazonq/.gitignore' },
      { name: 'the marker',                  path: '.workflow/installed.json' },
      { name: 'the registry',                path: '.workflow/acp/drivers/registry.yaml' },
   ];

   const OPTIONS = [
      { name: 'a real run',   options: [] as string[] },
      { name: 'a dry run',    options: ['--dry-run'] },
      { name: 'a forced run', options: ['--force'] },
   ];

   describe.each(PATHS)('$name', ({ path }) =>
   {
      it.each(OPTIONS)('stops on $name, names the path, shows no stack trace and writes nothing',
         ({ options }) =>
      {
         const ctx = start(false);
         put(ctx.target, `${path}/fake-inner.txt`, 'fake inner\n');
         const targetBefore = tree(ctx.target);
         const homeBefore   = tree(ctx.recorded.home);
         ctx.recorded.writes.length = 0;

         const { result } = again(ctx, ...options);

         expect(result.code).not.toBe(0);
         expect(result.lines.some((line) => line.startsWith('stop') && line.includes(path))).toBe(true);
         expect(result.lines.some(raw)).toBe(false);
         expect(tree(ctx.target)).toEqual(targetBefore);
         expect(tree(ctx.recorded.home)).toEqual(homeBefore);
         expect(ctx.recorded.writes).toEqual([]);
      });
   });
});

describe('a file where a parent folder belongs', () =>
{
   it('names the failed write, shows no stack trace, writes the rest and ends not 0', () =>
   {
      const ctx = start(false);
      put(ctx.target, '.kiro', 'fake file\n');

      const { result } = again(ctx);

      const failed = result.lines.filter((line) => line.startsWith('failed '));
      expect(failed.some((line) => line.includes('.kiro/prompts/fake-prompt.md'))).toBe(true);
      expect(result.lines.some(raw)).toBe(false);
      expect(existsSync(join(ctx.target, '.workflow/rules/foundation/fake-rule.md'))).toBe(true);
      expect(result.code).not.toBe(0);
   });
});
