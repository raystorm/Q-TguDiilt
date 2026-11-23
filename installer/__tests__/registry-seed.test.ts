/**
 * The registry seed: written from the example only when absent, never recorded in the marker, never
 * removed or overwritten, and a note when the example changes under a registry the user already has.
 */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
   again, childEnv, cleanup, hasGit, markerOf, put, recordingIo, runOn, start, textOf, tree,
} from './engine.js';

afterEach(cleanup);

const REGISTRY = '.workflow/acp/drivers/registry.yaml';
const EXAMPLE  = '.workflow/acp/drivers/registry.example.yaml';
const IGNORE   = '.workflow/acp/drivers/.gitignore';
const MINE     = '.workflow/acp/drivers/my-driver.ts';
const NEW      = 'fake: new example\n';

const OPTIONS = [
   { name: 'a real run',   options: [] as string[] },
   { name: 'a dry run',    options: ['--dry-run'] },
   { name: 'a forced run', options: ['--force'] },
];

/** Whether a note names the example and the registry. */
const merges = (lines: string[]) =>
   lines.some((line) => line.startsWith('note') && line.includes(EXAMPLE) && line.includes(REGISTRY));

describe('the first install', () =>
{
   it('writes the registry from the example, never from the source\'s own file, and does not record it', () =>
   {
      const ctx = start(false, { [REGISTRY]: 'fake-secret\n', [EXAMPLE]: 'fake: example\n' });

      const { result } = again(ctx);

      const { files } = markerOf(ctx.target);
      expect(textOf(ctx.target, REGISTRY)).toBe('fake: example\n');
      expect(result.lines).toContain(`create ${REGISTRY}`);
      expect(REGISTRY in files).toBe(false);
      expect(textOf(ctx.target, IGNORE)).toContain('registry.yaml');
      expect(IGNORE in files).toBe(true);
   });

   it('stops, naming the example, when the engine lacks it, and writes nothing', () =>
   {
      const ctx = start(false, { [EXAMPLE]: null });

      const { result } = again(ctx);

      expect(result.lines.some((line) => line.startsWith('stop') && line.includes(EXAMPLE))).toBe(true);
      expect(result.code).not.toBe(0);
      expect(tree(ctx.target)).toEqual({});
   });
});

describe('a registry that is already there', () =>
{
   const STATES = [
      { name: 'edited by hand',       text: 'fake: my edit\n' },
      { name: 'equal to the example', text: `fake ${EXAMPLE}\n` },
      { name: 'empty',                text: '' },
      { name: 'not valid YAML',       text: 'fake: [unclosed\n' },
   ];

   describe.each(STATES)('$name', ({ text }) =>
   {
      it.each(OPTIONS)('is left alone, with no action or conflict for it: $name', ({ options }) =>
      {
         const ctx = start(false);
         put(ctx.target, REGISTRY, text);

         const { result } = again(ctx, ...options);

         expect(textOf(ctx.target, REGISTRY)).toBe(text);
         const acted = result.lines.filter((line) => /^(create|update|conflict|remove) /.test(line));
         expect(acted.filter((line) => line.includes(REGISTRY))).toEqual([]);
         expect(result.code).toBe(0);
      });
   });
});

describe('a file that is written only when absent', () =>
{
   it('is still there, unchanged and unrecorded, after more runs, and each ends with nothing to write', () =>
   {
      const ctx    = start(true);
      const before = textOf(ctx.target, REGISTRY);

      ctx.recorded.clock.time = new Date('2026-06-01T00:00:00.000Z');
      const second = again(ctx);
      ctx.recorded.clock.time = new Date('2026-07-01T00:00:00.000Z');
      const third = again(ctx);

      expect(second.result.lines).toEqual(['nothing to write']);
      expect(third.result.lines).toEqual(['nothing to write']);
      expect(textOf(ctx.target, REGISTRY)).toBe(before);
      expect(REGISTRY in markerOf(ctx.target).files).toBe(false);
   });

   it('is created again from the current example when the user deletes it', () =>
   {
      const ctx = start(true);
      rmSync(join(ctx.target, REGISTRY));
      ctx.engine.put(EXAMPLE, NEW);

      const { result } = again(ctx);

      expect(result.lines).toContain(`create ${REGISTRY}`);
      expect(textOf(ctx.target, REGISTRY)).toBe(NEW);
   });
});

describe('an example that changes under a registry', () =>
{
   it.each(OPTIONS.slice(0, 2))('leaves the registry as it was and names both files in a note: $name',
      ({ options }) =>
   {
      const ctx    = start(true);
      const before = textOf(ctx.target, REGISTRY);
      ctx.engine.put(EXAMPLE, NEW);

      const { result } = again(ctx, ...options);

      expect(merges(result.lines)).toBe(true);
      expect(result.lines.some((line) => line.includes('merge'))).toBe(true);
      expect(textOf(ctx.target, REGISTRY)).toBe(before);
   });

   it('updates the example in the target and keeps the registry', () =>
   {
      const ctx = start(true);
      ctx.engine.put(EXAMPLE, NEW);

      const { result } = again(ctx);

      expect(textOf(ctx.target, EXAMPLE)).toBe(NEW);
      expect(result.code).toBe(0);
   });

   const ROWS = [
      { name: 'a first install',                     note: false, prepare: () => start(false) },
      { name: 'a re-run with the example unchanged', note: false, prepare: () => start(true) },
      {
         name:    'the example changed and the registry is absent',
         note:    false,
         prepare: () =>
         {
            const ctx = start(true);
            ctx.engine.put(EXAMPLE, NEW);
            rmSync(join(ctx.target, REGISTRY));
            return ctx;
         },
      },
      {
         name:    'the example changed and the registry is there',
         note:    true,
         prepare: () =>
         {
            const ctx = start(true);
            ctx.engine.put(EXAMPLE, NEW);
            return ctx;
         },
      },
   ];

   it.each(ROWS)('with $name the note is printed: $note', ({ prepare, note }) =>
   {
      const ctx = prepare();

      const { result } = again(ctx);

      expect(merges(result.lines)).toBe(note);
   });
});

describe.skipIf(!hasGit)('git, in a target after an install', () =>
{
   const status = (cwd: string, ...args: string[]) =>
      spawnSync('git', args, { cwd, env: childEnv() }).status;

   it('ignores the registry, not a driver of the user, and never touches or records that driver', () =>
   {
      const ctx = start(true);
      status(ctx.target, 'init', '-q');
      put(ctx.target, MINE, 'fake mine\n');
      put(ctx.target, EXAMPLE, 'fake hand edit\n');

      const { result } = again(ctx);

      expect(status(ctx.target, 'check-ignore', '-q', REGISTRY)).toBe(0);
      expect(status(ctx.target, 'check-ignore', '-q', MINE)).toBe(1);
      expect(result.lines).toContain(`conflict ${EXAMPLE}`);
      expect(textOf(ctx.target, MINE)).toBe('fake mine\n');
      expect(MINE in markerOf(ctx.target).files).toBe(false);
   });
});

describe('a registry that cannot be written', () =>
{
   it('is named, has no entry in the marker, and ends the run not 0', () =>
   {
      const recorded = recordingIo((path) => path.endsWith('registry.yaml'));
      const ctx      = start(false);

      const { result } = runOn(ctx.engine, [ctx.target], recorded);

      expect(result.lines.some((line) => line.startsWith('failed ') && line.includes(REGISTRY))).toBe(true);
      expect(REGISTRY in markerOf(ctx.target).files).toBe(false);
      expect(result.code).not.toBe(0);
   });
});
