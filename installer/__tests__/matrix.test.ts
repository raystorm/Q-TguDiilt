/**
 * What the installer does with a file, by what the target holds: create, skip, update or conflict.
 * A file the installer wrote and nobody edited is updated without `--force`; any other difference is a
 * conflict until `--force`. A copied rule, a docs file, a rendered prompt and a generated ignore file
 * follow the same rules.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { plan } from '../plan.js';
import { canonical } from './fixtures.js';
import {
   again, cleanup, makeEngine, markerOf, put, runOn, start, tempDir, textOf, tree, type Start,
} from './engine.js';

afterEach(cleanup);

const RULE = '.workflow/rules/foundation/fake-rule.md';
const NEW  = 'fake new engine text\n';
const EDIT = 'fake hand edit\n';

/** The printed line for `path`: its kind, the path, and `(forced)` when it is. */
const lineFor = (lines: string[], path: string) => lines.find((line) => path === line.split(' ')[1]);

const OPTIONS = [
   { name: 'plain',        options: [] as string[] },
   { name: 'with --force', options: ['--force'] },
];

/** A file under test: where it is, the text the installer writes there now, and a change to the engine. */
interface Subject
{
   path:     string;
   expected: (ctx: Start) => string;
   change:   (ctx: Start) => void;
}

/** The text a clean install of the engine gives `path`. */
function fresh(ctx: Start, path: string): string
{
   const target = tempDir('installer-fresh-');
   runOn(ctx.engine, [target]);
   return textOf(target, path);
}

const copied = (path: string): Subject =>
   ({ path, expected: (ctx) => textOf(ctx.engine.dir, path), change: (ctx) => ctx.engine.put(path, NEW) });

const SUBJECTS: Subject[] = [
   copied(RULE),
   copied('docs/overview.md'),
   {
      path:     '.kiro/prompts/fake-prompt.md',
      expected: (ctx) => fresh(ctx, '.kiro/prompts/fake-prompt.md'),
      change:   (ctx) => ctx.engine.put(
         '.workflow/prompts/fake-prompt.md', canonical({ name: 'fake-prompt', body: 'Changed body.\n' })),
   },
   {
      path:     '.kiro/prompts/.gitignore',
      expected: (ctx) => fresh(ctx, '.kiro/prompts/.gitignore'),
      change:   (ctx) => ctx.engine.put('.workflow/prompts/fake-extra.md', canonical({ name: 'fake-extra' })),
   },
];

interface Conflict
{
   name:      string;
   installed: boolean;
   prepare:   (ctx: Start, path: string, change: Subject['change']) => void;
}

/** Ways a file can differ so that it is a conflict. */
const CONFLICTS: Conflict[] = [
   {
      name:      'hand-edited',
      installed: true,
      prepare:   (ctx, path) => put(ctx.target, path, EDIT),
   },
   {
      name:      'hand-edited, and the engine changed as well',
      installed: true,
      prepare:   (ctx, path, change) => { put(ctx.target, path, EDIT); change(ctx); },
   },
   {
      name:      'a foreign file with no marker entry',
      installed: false,
      prepare:   (ctx, path) => put(ctx.target, path, EDIT),
   },
];

describe.each(SUBJECTS)('the file $path', ({ path, expected, change }) =>
{
   it.each(OPTIONS)('is created when the target has none, $name', ({ options }) =>
   {
      const ctx = start(false);

      const { result } = again(ctx, ...options);

      expect(lineFor(result.lines, path)).toBe(`create ${path}`);
      expect(textOf(ctx.target, path)).toBe(expected(ctx));
   });

   it.each(OPTIONS)('is skipped and recorded when it equals the engine, with no marker entry, $name',
      ({ options }) =>
   {
      const ctx = start(false);
      put(ctx.target, path, expected(ctx));

      const { result } = again(ctx, ...options);

      expect(lineFor(result.lines, path)).toBeUndefined();
      expect(path in markerOf(ctx.target).files).toBe(true);
      expect(result.code).toBe(0);
   });

   it.each(OPTIONS)('is skipped when it equals the engine and the marker has it, $name', ({ options }) =>
   {
      const ctx = start(true);

      const { result } = again(ctx, ...options);

      expect(result.lines).toEqual(['nothing to write']);
   });

   it.each(OPTIONS)('is updated, not forced, when it differs from the engine only, $name', ({ options }) =>
   {
      const ctx    = start(true);
      const before = markerOf(ctx.target).files[path];
      change(ctx);

      const { result } = again(ctx, ...options);

      expect(lineFor(result.lines, path)).toBe(`update ${path}`);
      expect(textOf(ctx.target, path)).toBe(expected(ctx));
      expect(markerOf(ctx.target).files[path]).not.toBe(before);
      expect(result.code).toBe(0);
   });

   it('is created again when the marker has it and the user deleted it', () =>
   {
      const ctx = start(true);
      rmSync(join(ctx.target, path));

      const { result } = again(ctx);

      expect(lineFor(result.lines, path)).toBe(`create ${path}`);
      expect(textOf(ctx.target, path)).toBe(expected(ctx));
   });

   describe.each(CONFLICTS)('when it is $name', ({ installed, prepare }) =>
   {
      it('is a conflict: reported, left alone, code not 0, old marker entry kept', () =>
      {
         const ctx    = start(installed);
         const before = installed ? markerOf(ctx.target).files[path] : undefined;
         prepare(ctx, path, change);

         const { result } = again(ctx);

         expect(lineFor(result.lines, path)).toBe(`conflict ${path}`);
         expect(textOf(ctx.target, path)).toBe(EDIT);
         expect(result.code).not.toBe(0);
         expect(markerOf(ctx.target).files[path]).toBe(before);
      });

      it('is overwritten with --force, and the next plain run has nothing to write', () =>
      {
         const ctx = start(installed);
         prepare(ctx, path, change);

         const { result } = again(ctx, '--force');

         expect(lineFor(result.lines, path)).toBe(`update ${path} (forced)`);
         expect(textOf(ctx.target, path)).toBe(expected(ctx));
         expect(result.code).toBe(0);
         expect(again(ctx).result.lines).toEqual(['nothing to write']);
      });
   });
});

describe('--force', () =>
{
   it('leaves alone a path the installer does not generate, and the denied files', () =>
   {
      const engine = makeEngine({
         '.workflow/acp/drivers/registry.yaml':  'fake source registry\n',
         '.workflow/rules/tech/fake-project.md': 'fake source project rule\n',
      });
      const target = tempDir('installer-target-');
      const mine   = {
         '.workflow/acp/drivers/registry.yaml':  'fake my registry\n',
         '.workflow/rules/tech/fake-project.md': 'fake my project rule\n',
         'fake-unrelated.txt':                   'fake unrelated\n',
      };
      for (const [path, text] of Object.entries(mine)) { put(target, path, text); }

      runOn(engine, [target, '--force']);

      for (const [path, text] of Object.entries(mine)) { expect(textOf(target, path)).toBe(text); }
   });

   it('lists a forced overwrite as an update, writes nothing on a dry run and ends with code 0', () =>
   {
      const ctx = start(true);
      put(ctx.target, RULE, EDIT);
      const before = tree(ctx.target);
      ctx.recorded.writes.length = 0;

      const planned    = plan(ctx.recorded.io, ctx.engine.dir, ctx.target, true);
      const action     = planned.actions.find((candidate) => RULE === candidate.path);
      const { result } = again(ctx, '--force', '--dry-run');

      expect(action).toMatchObject({ kind: 'update', forced: true });
      expect(result.lines).toContain(`update ${RULE} (forced)`);
      expect(ctx.recorded.writes).toEqual([]);
      expect(tree(ctx.target)).toEqual(before);
      expect(result.code).toBe(0);
   });
});

describe('a run with a conflict, a missing file and a stale file', () =>
{
   it('reports the conflict, creates the missing file, updates the stale one, and ends not 0', () =>
   {
      const ctx     = start(true);
      const EDITED  = 'docs/overview.md';
      const MISSING = '.workflow/skills/README.md';
      put(ctx.target, EDITED, EDIT);
      rmSync(join(ctx.target, MISSING));
      ctx.engine.put(RULE, NEW);

      const { result } = again(ctx);

      const expected = [`conflict ${EDITED}`, `create ${MISSING}`, `update ${RULE}`];
      expect(result.lines).toEqual(expect.arrayContaining(expected));
      expect(textOf(ctx.target, EDITED)).toBe(EDIT);
      expect(textOf(ctx.target, MISSING)).toBe(textOf(ctx.engine.dir, MISSING));
      expect(textOf(ctx.target, RULE)).toBe(NEW);
      expect(result.code).not.toBe(0);
   });
});
