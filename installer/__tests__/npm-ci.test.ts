/**
 * The dependencies of the service: when `npm ci` runs, what it is asked, what a failure leaves, and that
 * it never runs for the engine itself, a dry run or a stop. The runner is a fake; nothing uses the network.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acpOf, again, cleanup, makeEngine, put, recordingIo, runOn, start, tree } from './engine.js';

afterEach(cleanup);

const RULE   = '.workflow/rules/foundation/fake-rule.md';
const LOCK   = '.workflow/acp/package-lock.json';
const MARKER = '.workflow/installed.json';

const folder  = (target: string) => join(target, '.workflow', 'acp');
const npmLine = (lines: string[]) => lines.filter((line) => line.includes('npm ci --omit=dev'));

/** A finished install whose runner calls are forgotten. */
function finished()
{
   const ctx = start(true);
   ctx.recorded.calls.length = 0;
   return ctx;
}

type Finished = ReturnType<typeof finished>;

describe('the first install', () =>
{
   it('runs npm ci once, with an argument list, in the service folder, after the files are written', () =>
   {
      const ctx = start(false);

      const { result } = again(ctx);

      expect(ctx.recorded.calls).toEqual([{
         command: 'npm',
         args:    ['ci', '--omit=dev'],
         cwd:     folder(ctx.target),
         had:     { lockfile: true, packageJson: true },
      }]);
      expect(npmLine(result.lines).some((line) => line.includes(folder(ctx.target)))).toBe(true);
      expect(result.code).toBe(0);
   });

   it('does not run again when nothing changed, and has nothing to write', () =>
   {
      const ctx = finished();

      const { result } = again(ctx);

      expect(ctx.recorded.calls).toEqual([]);
      expect(result.lines).toEqual(['nothing to write']);
   });
});

describe('what makes npm ci run again', () =>
{
   const modules = (ctx: Finished) => join(folder(ctx.target), 'node_modules');

   interface Row
   {
      name:     string;
      calls:    number;
      options?: string[];
      change:   (ctx: Finished) => void;
   }

   const ROWS: Row[] = [
      {
         name:   'the source lockfile changed',
         calls:  1,
         change: (ctx) => ctx.engine.put(LOCK, 'fake new lock\n'),
      },
      { name: 'node_modules was removed', calls: 1, change: (ctx) => rmSync(modules(ctx), { recursive: true }) },
      {
         name:   'node_modules was replaced by an empty folder',
         calls:  1,
         change: (ctx) =>
         {
            rmSync(modules(ctx), { recursive: true });
            mkdirSync(modules(ctx));
         },
      },
      {
         name:   'node_modules has packages but no hidden lockfile',
         calls:  1,
         change: (ctx) => rmSync(join(modules(ctx), '.package-lock.json')),
      },
      { name: 'only a rule file changed', calls: 0, change: (ctx) => ctx.engine.put(RULE, 'fake new rule\n') },
      { name: '--force with nothing changed', calls: 0, options: ['--force'], change: () => undefined },
   ];

   it.each(ROWS)('after $name, the runner is called $calls time(s)', ({ calls, options = [], change }) =>
   {
      const ctx = finished();
      change(ctx);

      again(ctx, ...options);

      expect(ctx.recorded.calls).toHaveLength(calls);
   });

   it('is not called for a hand-edited target lockfile, which is a conflict as before', () =>
   {
      const ctx = finished();
      put(ctx.target, LOCK, 'fake hand edit\n');

      const { result } = again(ctx);

      expect(ctx.recorded.calls).toEqual([]);
      expect(result.lines).toContain(`conflict ${LOCK}`);
   });
});

describe('a failed npm ci', () =>
{
   const LONG = Array.from({ length: 60 }, (_, index) => `fake output line ${index + 1}`).join('\n');

   it('is reported with the last 20 lines, ends not 0, and leaves every file and the entry', () =>
   {
      const ctx = start(false);
      ctx.recorded.npm.answer = { status: 1, output: LONG };

      const { result } = again(ctx);

      const shown = result.lines.map((line) => line.trim());
      expect(shown).toContain('fake output line 60');
      expect(shown).toContain('fake output line 41');
      expect(shown).not.toContain('fake output line 40');
      expect(result.lines.some((line) => line.startsWith('failed ') && line.includes('npm ci'))).toBe(true);
      expect(result.code).not.toBe(0);
      expect(existsSync(join(ctx.target, RULE))).toBe(true);
      expect(existsSync(join(ctx.target, MARKER))).toBe(true);
      expect(acpOf(ctx.recorded.home).agent_servers).toBeDefined();
   });

   it('runs again on the next run, and not on the one after', () =>
   {
      const ctx = start(false);
      ctx.recorded.npm.answer = { status: 1, output: 'fake failure' };
      again(ctx);

      ctx.recorded.npm.answer = { status: 0, output: '' };
      const second = again(ctx);
      const third  = again(ctx);

      expect(ctx.recorded.calls).toHaveLength(2);
      expect(second.result.code).toBe(0);
      expect(third.result.lines).toEqual(['nothing to write']);
   });

   it('runs again after a failure that left the old node_modules in place', () =>
   {
      const ctx = finished();
      ctx.engine.put(LOCK, 'fake new lock\n');
      ctx.recorded.npm.answer = { status: 1, output: 'fake failure' };
      again(ctx);

      ctx.recorded.npm.answer = { status: 0, output: '' };
      const second = again(ctx);
      const third  = again(ctx);

      expect(ctx.recorded.calls).toHaveLength(2);
      expect(second.result.code).toBe(0);
      expect(third.result.lines).toEqual(['nothing to write']);
   });

   const ANSWERS = [
      {
         name:   'success with a warning',
         answer: { status: 0, output: 'npm warn allow-scripts fake' },
         failed: false,
         text:   'done',
      },
      { name: 'a failure status', answer: { status: 1, output: 'fake failure' }, failed: true, text: 'status 1' },
      {
         name:   'a command that cannot start',
         answer: { status: null, output: 'spawn npm ENOENT' },
         failed: true,
         text:   'could not be run',
      },
   ];

   it.each(ANSWERS)('is read right for $name', ({ answer, failed, text }) =>
   {
      const ctx = start(false);
      ctx.recorded.npm.answer = answer;

      const { result } = again(ctx);

      expect(result.lines.some((line) => line.startsWith('failed '))).toBe(failed);
      expect(result.lines.some((line) => line.includes(text))).toBe(true);
      expect(0 === result.code).toBe(!failed);
      expect(existsSync(join(ctx.target, MARKER))).toBe(true);
   });
});

describe('the engine itself', () =>
{
   const OPTIONS = [
      { name: 'a real run',   options: [] as string[] },
      { name: 'a dry run',    options: ['--dry-run'] },
      { name: 'a forced run', options: ['--force'] },
   ];

   it.each(OPTIONS)('never runs npm ci and says so when node_modules is missing: $name', ({ options }) =>
   {
      const engine   = makeEngine({ '.workflow/acp/node_modules/.package-lock.json': null });
      const recorded = recordingIo();

      const { result } = runOn(engine, [engine.dir, ...options], recorded);

      const notes = result.lines.filter((line) => line.startsWith('note') && line.includes('npm ci was not run'));
      expect(recorded.calls).toEqual([]);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toContain(folder(engine.dir));
   });

   it('says nothing about npm ci when node_modules is complete', () =>
   {
      const engine   = makeEngine();
      const recorded = recordingIo();

      const { result } = runOn(engine, [engine.dir], recorded);

      expect(recorded.calls).toEqual([]);
      expect(result.lines.some((line) => line.includes('npm ci'))).toBe(false);
   });
});

describe('a dry run and a stop', () =>
{
   it('lists npm ci with its folder, calls nothing and writes nothing', () =>
   {
      const ctx        = start(false);
      const homeBefore = tree(ctx.recorded.home);

      const { result } = again(ctx, '--dry-run');

      expect(ctx.recorded.calls).toEqual([]);
      expect(npmLine(result.lines).some((line) => line.includes(folder(ctx.target)))).toBe(true);
      expect(result.lines).not.toContain('nothing to write');
      expect(tree(ctx.target)).toEqual({});
      expect(tree(ctx.recorded.home)).toEqual(homeBefore);
      expect(result.code).toBe(0);
   });

   it('does not run npm ci in a real run that stops', () =>
   {
      const ctx = start(false);
      put(ctx.recorded.home, '.jetbrains/acp.json', '');

      const { result } = again(ctx);

      expect(ctx.recorded.calls).toEqual([]);
      expect(result.code).not.toBe(0);
   });
});
