/**
 * The marker `.workflow/installed.json`: what it records, when it is rewritten, what makes the
 * installer refuse it, and a write that fails. Also the ignore files the installer writes beside it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, filesIn, makeEngine, markerOf, put, recordingIo, runOn, tempDir, tree } from './engine.js';

afterEach(cleanup);

const MARKER  = '.workflow/installed.json';
const RULE    = '.workflow/rules/foundation/fake-rule.md';
const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');

const linesOf = (target: string, path: string) => readFileSync(join(target, path), 'utf8').split('\n');

describe('the marker after an install', () =>
{
   it('holds the time of the run and a hash for every file written, none for itself', () =>
   {
      const engine   = makeEngine({
         'docs/user/fake-twin-a.md': 'fake twin\n',
         'docs/user/fake-twin-b.md': 'fake twin\n',
      });
      const target   = tempDir('installer-target-');
      const recorded = recordingIo();
      recorded.clock.time = new Date('2026-03-04T05:06:07.000Z');

      runOn(engine, [target], recorded);

      const marker  = markerOf(target);
      const managed = filesIn(target).filter((path) => MARKER !== path).sort();
      expect(marker.installedAt).toBe('2026-03-04T05:06:07.000Z');
      expect(Object.keys(marker.files).sort()).toEqual(managed);
      expect(marker.files['docs/user/fake-twin-a.md']).toBe(marker.files['docs/user/fake-twin-b.md']);
      expect(marker.files['docs/user/fake-guide.md']).not.toBe(marker.files['docs/user/fake-twin-a.md']);
   });

   it('records the installer\'s own version, as a semantic version', () =>
   {
      const target = tempDir('installer-target-');
      const { version } = JSON.parse(readFileSync(PACKAGE, 'utf8'));

      runOn(makeEngine(), [target]);

      expect(version).toMatch(/^\d+\.\d+\.\d+/);
      expect(markerOf(target).version).toBe(version);
   });

   it('is accompanied by ignore files that list the marker, the log and the temporary file', () =>
   {
      const target = tempDir('installer-target-');
      runOn(makeEngine(), [target]);

      expect(linesOf(target, '.workflow/.gitignore')).toContain('installed.json');
      expect(linesOf(target, '.amazonq/.gitignore'))
         .toEqual(expect.arrayContaining(['workflow.log', '.timestamp-temp']));
   });

   it('keeps only relative paths with `/` and no `..` segment', () =>
   {
      const target = tempDir('installer-target-');
      runOn(makeEngine(), [target]);

      for (const path of Object.keys(markerOf(target).files))
      {
         expect(path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')).toBe(false);
      }
   });
});

describe('the marker on a later run', () =>
{
   it('takes the new time and the new hash of a changed file, and leaves every other entry alone', () =>
   {
      const engine   = makeEngine();
      const target   = tempDir('installer-target-');
      const recorded = recordingIo();
      runOn(engine, [target], recorded);
      const first = markerOf(target);

      engine.put(RULE, 'fake new rule text\n');
      put(target, 'docs/overview.md', 'fake hand edit\n');
      recorded.clock.time = new Date('2026-06-01T00:00:00.000Z');
      runOn(engine, [target], recorded);

      const second = markerOf(target);
      expect(second.installedAt).toBe('2026-06-01T00:00:00.000Z');
      expect(second.files[RULE]).not.toBe(first.files[RULE]);
      for (const path of Object.keys(first.files).filter((key) => RULE !== key))
      { expect(second.files[path]).toBe(first.files[path]); }
   });
});

describe('a marker that cannot be used', () =>
{
   it.each([
      { name: 'text that is not JSON',      text: '{ not json' },
      { name: 'JSON that is not an object', text: '[]' },
      { name: 'an object with no files',    text: JSON.stringify({ version: '1', installedAt: 'fake' }) },
      {
         name: 'a path that leaves the target',
         text: JSON.stringify({ version: '1', installedAt: 'fake', files: { '../fake-escape': 'fake' } }),
      },
      {
         name: 'an absolute path',
         text: JSON.stringify({ version: '1', installedAt: 'fake', files: { '/fake-absolute': 'fake' } }),
      },
   ])('stops, names the marker and writes nothing for $name', ({ text }) =>
   {
      const target = tempDir('installer-target-');
      put(target, MARKER, text);
      const before = tree(target);

      const { result, writes } = runOn(makeEngine(), [target]);

      expect(result.code).not.toBe(0);
      expect(result.lines.join('\n')).toContain(MARKER);
      expect(writes).toEqual([]);
      expect(tree(target)).toEqual(before);
   });
});

describe('a source that was itself installed', () =>
{
   it('is installed with the target\'s own marker and ignore file, not the source\'s', () =>
   {
      const odd    = { version: '9', installedAt: 'fake', files: { 'fake/other-repo.md': 'fake' } };
      const engine = makeEngine({
         [MARKER]:               JSON.stringify(odd),
         '.workflow/.gitignore': 'fake odd text\n',
      });
      const target = tempDir('installer-target-');

      runOn(engine, [target]);

      const marker = markerOf(target);
      expect('fake/other-repo.md' in marker.files).toBe(false);
      expect(Object.keys(marker.files).every((path) => existsSync(join(target, path)))).toBe(true);
      expect(linesOf(target, '.workflow/.gitignore')).toContain('installed.json');
      expect(linesOf(target, '.workflow/.gitignore')).not.toContain('fake odd text');
   });
});

describe('a write that fails', () =>
{
   const FAILING = (path: string) => path.endsWith(join('.workflow', 'rules', 'foundation', 'fake-rule.md'));

   it('is named, the other files are still written, and the marker has no hash for it', () =>
   {
      const target = tempDir('installer-target-');

      const { result } = runOn(makeEngine(), [target], recordingIo(FAILING));

      const { files } = markerOf(target);
      expect(result.code).not.toBe(0);
      expect(result.lines.some((line) => line.startsWith('failed ') && line.includes(RULE))).toBe(true);
      expect(existsSync(join(target, RULE))).toBe(false);
      expect(existsSync(join(target, '.workflow/skills/README.md'))).toBe(true);
      expect(RULE in files).toBe(false);
      expect('.workflow/skills/README.md' in files).toBe(true);
   });

   it('keeps the old hash when the file is one the installer wrote earlier', () =>
   {
      const engine = makeEngine();
      const target = tempDir('installer-target-');
      runOn(engine, [target]);
      const before = markerOf(target).files[RULE];

      engine.put(RULE, 'fake new rule text\n');
      const { result } = runOn(engine, [target], recordingIo(FAILING));

      expect(result.code).not.toBe(0);
      expect(markerOf(target).files[RULE]).toBe(before);
   });
});
