/**
 * An install into the engine itself: nothing is copied onto itself, the canonical files are never
 * recorded, updated or removed, and the files the installer writes are still written. A clone of the
 * engine is not a self-install.
 */
import { cpSync, symlinkSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, makeEngine, markerOf, put, recordingIo, runOn, tempDir, textOf, tree } from './engine.js';

afterEach(cleanup);

const RULE    = '.workflow/rules/foundation/fake-rule.md';
/** What a self-install records: the ignore files and the generated copies of the fixture's prompt. */
const RECORDED = [
   '.amazonq/.gitignore',
   '.workflow/.gitignore',
   '.workflow/acp/drivers/.gitignore',
   '.agents/skills/.gitignore',
   '.agents/skills/fake-prompt/SKILL.md',
   '.kiro/prompts/.gitignore',
   '.kiro/prompts/fake-prompt.md',
];

/** A symlink to `dir`, in a new temporary folder. */
function link(dir: string): string
{
   const path = join(tempDir('installer-link-'), 'engine');
   symlinkSync(dir, path);
   return path;
}

const SPELLINGS = [
   { name: 'the same path',    spell: (dir: string) => dir },
   { name: 'a trailing slash', spell: (dir: string) => `${dir}${sep}` },
   { name: 'a `..` segment',   spell: (dir: string) => join(dir, '.workflow', '..') },
   { name: 'a symlink',        spell: link },
   { name: 'a relative path',  spell: (dir: string) => relative(process.cwd(), dir) },
];

describe.each(SPELLINGS)('an install into the engine, spelled as $name', ({ spell }) =>
{
   it('writes only the installer\'s own files, records none of the copies and removes nothing', () =>
   {
      const engine   = makeEngine();
      const before   = tree(engine.dir);
      const recorded = recordingIo();

      const { result } = runOn(engine, [spell(engine.dir)], recorded);

      const after = tree(engine.dir);
      const added = Object.keys(after).filter((path) => !path.endsWith('/') && !(path in before)).sort();
      const kept  = Object.keys(markerOf(engine.dir).files).sort();
      const seeded = '.workflow/acp/drivers/registry.yaml';
      expect(added).toEqual([...RECORDED, seeded, '.workflow/installed.json'].sort());
      for (const path of Object.keys(before)) { expect(after[path]).toBe(before[path]); }
      expect(kept).toEqual([...RECORDED].sort());
      expect(recorded.removes).toEqual([]);
      expect(result.code).toBe(0);
   });
});

describe('a byte-for-byte clone of the engine', () =>
{
   it('is an ordinary target: its copies are recorded', () =>
   {
      const engine = makeEngine();
      const clone  = tempDir('installer-clone-');
      cpSync(engine.dir, clone, { recursive: true });

      runOn(engine, [clone]);

      expect(RULE in markerOf(clone).files).toBe(true);
   });
});

describe('a finished self-install', () =>
{
   function finished()
   {
      const engine   = makeEngine();
      const recorded = recordingIo();
      runOn(engine, [engine.dir], recorded);
      recorded.writes.length = 0;
      return { engine, recorded };
   }

   it('has nothing to write on a dry run, and writes nothing', () =>
   {
      const { engine, recorded } = finished();
      const before = tree(engine.dir);

      const { result } = runOn(engine, [engine.dir, '--dry-run'], recorded);

      expect(result.lines).toEqual(['nothing to write']);
      expect(recorded.writes).toEqual([]);
      expect(tree(engine.dir)).toEqual(before);
      expect(result.code).toBe(0);
   });

   it('neither updates nor reports a canonical file that was edited', () =>
   {
      const { engine, recorded } = finished();
      put(engine.dir, RULE, 'fake edited rule\n');

      const { result } = runOn(engine, [engine.dir], recorded);

      expect(result.lines).toEqual(['nothing to write']);
      expect(textOf(engine.dir, RULE)).toBe('fake edited rule\n');
   });

   it('neither restores nor reports a canonical file that was deleted', () =>
   {
      const { engine, recorded } = finished();
      engine.remove(RULE);

      const { result } = runOn(engine, [engine.dir], recorded);

      expect(result.lines).toEqual(['nothing to write']);
      expect(recorded.removes).toEqual([]);
   });
});
