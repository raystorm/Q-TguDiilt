/**
 * The command line and the report: what `run` prints and returns, a dry run that writes nothing, a
 * second run with nothing to do, a bad command line that is refused, and a full install that writes
 * only inside the target.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonical } from './fixtures.js';
import {
   again, cleanup, filesIn, makeEngine, prompt, put, recordingIo, runOn, start, tempDir, tree, type Engine,
} from './engine.js';

afterEach(cleanup);

const creates = (lines: string[]) => lines.filter((line) => line.startsWith('create '));

describe('--dry-run', () =>
{
   it('writes nothing and lists a create for every file a real run makes', () =>
   {
      const engine     = makeEngine();
      const dryTarget  = tempDir('installer-target-');
      const realTarget = tempDir('installer-target-');

      const dry = runOn(engine, [dryTarget, '--dry-run']);
      runOn(engine, [realTarget]);

      const made = filesIn(realTarget).map((path) => `create ${path}`).sort();
      expect(tree(dryTarget)).toEqual({});
      expect(dry.writes).toEqual([]);
      expect(dry.result.code).toBe(0);
      expect(creates(dry.result.lines).sort()).toEqual(made);
   });

   it('prints the same actions as a real run, in the same order, and each create exists afterwards', () =>
   {
      const engine     = makeEngine();
      const dryTarget  = tempDir('installer-target-');
      const realTarget = tempDir('installer-target-');

      const dry  = runOn(engine, [dryTarget, '--dry-run']);
      const real = runOn(engine, [realTarget]);

      expect(real.result.lines).toEqual(dry.result.lines);
      expect(0 < creates(real.result.lines).length).toBe(true);
      for (const line of creates(real.result.lines))
      { expect(existsSync(join(realTarget, line.slice('create '.length)))).toBe(true); }
   });
});

describe('a second run', () =>
{
   it.each([
      { name: 'a real run', options: [] as string[] },
      { name: 'a dry run',  options: ['--dry-run'] },
   ])('has nothing to write on $name and changes nothing', ({ options }) =>
   {
      const engine   = makeEngine();
      const target   = tempDir('installer-target-');
      const recorded = recordingIo();
      runOn(engine, [target], recorded);
      const before = tree(target);

      recorded.clock.time    = new Date('2026-06-01T00:00:00.000Z');
      recorded.writes.length = 0;
      const { result } = runOn(engine, [target, ...options], recorded);

      expect(result.lines).toEqual(['nothing to write']);
      expect(recorded.writes).toEqual([]);
      expect(tree(target)).toEqual(before);
      expect(result.code).toBe(0);
   });
});

describe('the exit code', () =>
{
   const RULE = '.workflow/rules/foundation/fake-rule.md';

   it.each([
      { name: 'a clean install',                  options: [] as string[] },
      { name: 'a dry run that would only create', options: ['--dry-run'] },
   ])('is 0 for $name', ({ options }) =>
   {
      const { result } = runOn(makeEngine(), [tempDir('installer-target-'), ...options]);
      expect(result.code).toBe(0);
   });

   it.each([
      { name: 'a real run', options: [] as string[] },
      { name: 'a dry run',  options: ['--dry-run'] },
   ])('is not 0 on $name when a file differs, and it is reported and left alone', ({ options }) =>
   {
      const engine = makeEngine();
      const target = tempDir('installer-target-');
      runOn(engine, [target]);
      writeFileSync(join(target, RULE), 'fake hand edit\n');

      const { result } = runOn(engine, [target, ...options]);

      expect(result.code).not.toBe(0);
      expect(result.lines).toContain(`conflict ${RULE}`);
      expect(readFileSync(join(target, RULE), 'utf8')).toBe('fake hand edit\n');
   });
});

interface Refusal
{
   name:     string;
   files?:   Record<string, string | null>;
   prepare?: (engine: Engine) => void;
   argv:     (target: string) => string[];
   problem:  RegExp;
}

const REFUSALS: Refusal[] = [
   {
      name:    'no target argument',
      argv:    () => [],
      problem: /no target/,
   },
   {
      name:    'a target that does not exist',
      argv:    (target) => [join(target, 'missing')],
      problem: /does not exist/,
   },
   {
      name:    'a target that is a file',
      argv:    (target) => [join(target, 'fake-file')],
      problem: /not a folder/,
   },
   {
      name:    'an unknown option',
      argv:    (target) => [target, '--bogus'],
      problem: /--bogus/,
   },
   {
      name:    'an engine with no .workflow folder',
      prepare: (engine) => engine.remove('.workflow'),
      argv:    (target) => [target],
      problem: /no folder \.workflow/,
   },
   {
      name:    'an engine that lacks a file the manifest names',
      files:   { 'docs/overview.md': null },
      argv:    (target) => [target],
      problem: /no file docs\/overview\.md/,
   },
];

describe('a command that is refused', () =>
{
   it.each(REFUSALS)('refuses $name, names the problem, writes nothing', ({ files, prepare, argv, problem }) =>
   {
      const engine = makeEngine(files);
      prepare?.(engine);
      const target = tempDir('installer-target-');
      writeFileSync(join(target, 'fake-file'), 'fake\n');
      const before = tree(target);

      const { result, writes } = runOn(engine, argv(target));

      expect(result.code).not.toBe(0);
      expect(result.lines.join('\n')).toMatch(problem);
      expect(writes).toEqual([]);
      expect(tree(target)).toEqual(before);
   });
});

describe('a full install', () =>
{
   /** Places the installer must never write: Amazon Q prompts and Copilot prompt files. */
   const NEVER = ['.amazonq/prompts/', '.github/prompts/'];

   it('writes only inside the target and never to the home folder or an Amazon Q prompt place', () =>
   {
      const engine = makeEngine({
         '.workflow/skills/fake-skill/SKILL.md': canonical({ name: 'fake-skill' }),
         '.amazonq/prompts/fake-q-prompt.md':    'fake q prompt\n',
      });
      const target     = tempDir('installer-target-');
      const recorded   = recordingIo();
      const homeBefore = tree(recorded.home);

      runOn(engine, [target, '--force'], recorded);

      const stray = filesIn(target).filter((path) =>
         NEVER.some((folder) => path.startsWith(folder)) || path.endsWith('.prompt.md'));
      expect(0 < recorded.writes.length).toBe(true);
      expect(recorded.writes.every((path) => path.startsWith(`${target}${sep}`))).toBe(true);
      expect(tree(recorded.home)).toEqual(homeBefore);
      expect(stray).toEqual([]);
   });
});

describe('the list a run prints', () =>
{
   it('is grouped by kind, then path, with a separator before the marker', () =>
   {
      const ctx = start(true, {
         '.workflow/prompts/fake-stray.md': 'No frontmatter.\n',
         ...prompt('fake-b'),
         ...prompt('fake-a'),
      });
      put(ctx.target, '.kiro/prompts/fake-a.md', 'fake hand edit\n');
      ctx.engine.put('docs/overview.md', 'fake new overview\n');
      ctx.engine.put('.workflow/prompts/fake-c.md', canonical({ name: 'fake-c' }));
      ctx.engine.remove('.workflow/rules/foundation/fake-rule.md');

      const { result } = again(ctx);

      const order = ['warning', 'conflict', 'update', 'create', 'remove'];
      const body  = result.lines.slice(0, -2);
      const kinds = body.map((line) => line.split(' ')[0]);
      const ranks = kinds.map((kind) => order.indexOf(kind));
      expect([...new Set(kinds)]).toEqual(order);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      for (const kind of order)
      {
         const paths = body.filter((line) => line.startsWith(`${kind} `)).map((line) => line.split(' ')[1]);
         expect(paths).toEqual([...paths].sort());
      }
      expect(result.lines.slice(-2)).toEqual(['--------', 'update .workflow/installed.json']);
   });
});
