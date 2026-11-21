/**
 * A file the installer wrote whose source is gone: removed when nobody edited it, a conflict when
 * someone did, dropped from the marker when it is already gone, plus the folders a removal empties.
 */
import { existsSync, rmSync } from 'node:fs';
import { join, posix } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonical } from './fixtures.js';
import { again, cleanup, markerOf, put, start, textOf, tree } from './engine.js';

afterEach(cleanup);

const MARKER  = '.workflow/installed.json';
const RULE    = '.workflow/rules/foundation/fake-rule.md';
const EDIT    = 'fake hand edit\n';
const DELETED = [RULE, 'docs/user/fake-more.md', '.workflow/prompts/fake-prompt.md'];

describe.each(DELETED)('the file %s, deleted from the engine', (path) =>
{
   it('is removed and listed, its marker entry goes, and a file the user added beside it stays', () =>
   {
      const ctx  = start(true);
      const mine = posix.join(posix.dirname(path), 'fake-mine.txt');
      put(ctx.target, mine, 'fake mine\n');
      ctx.engine.remove(path);

      const { result } = again(ctx);

      expect(result.lines).toContain(`remove ${path}`);
      expect(existsSync(join(ctx.target, path))).toBe(false);
      expect(path in markerOf(ctx.target).files).toBe(false);
      expect(textOf(ctx.target, mine)).toBe('fake mine\n');
      expect(result.code).toBe(0);
   });
});

describe('a file whose source is gone and that was hand-edited', () =>
{
   it('is kept and reported as a conflict, code not 0, with its marker entry kept', () =>
   {
      const ctx    = start(true);
      const before = markerOf(ctx.target).files[RULE];
      put(ctx.target, RULE, EDIT);
      ctx.engine.remove(RULE);

      const { result } = again(ctx);

      expect(result.lines).toContain(`conflict ${RULE}`);
      expect(textOf(ctx.target, RULE)).toBe(EDIT);
      expect(markerOf(ctx.target).files[RULE]).toBe(before);
      expect(result.code).not.toBe(0);
   });

   it('is removed with --force, and the next run has nothing to write', () =>
   {
      const ctx = start(true);
      put(ctx.target, RULE, EDIT);
      ctx.engine.remove(RULE);

      const { result } = again(ctx, '--force');

      expect(result.lines).toContain(`remove ${RULE} (forced)`);
      expect(existsSync(join(ctx.target, RULE))).toBe(false);
      expect(result.code).toBe(0);
      expect(again(ctx).result.lines).toEqual(['nothing to write']);
   });
});

describe('a removal', () =>
{
   it('is listed on a dry run, which removes nothing', () =>
   {
      const ctx = start(true);
      ctx.engine.remove(RULE);
      const before = tree(ctx.target);
      ctx.recorded.removes.length = 0;

      const { result } = again(ctx, '--dry-run');

      expect(result.lines).toContain(`remove ${RULE}`);
      expect(ctx.recorded.removes).toEqual([]);
      expect(tree(ctx.target)).toEqual(before);
      expect(result.code).toBe(0);
   });

   it('drops the marker entry of a file that is already gone, without an error', () =>
   {
      const ctx  = start(true);
      const GONE = 'docs/user/fake-guide.md';
      rmSync(join(ctx.target, GONE));
      ctx.engine.remove(GONE);

      const { result } = again(ctx);

      expect(result.lines.filter((line) => line.includes(GONE))).toEqual([]);
      expect(GONE in markerOf(ctx.target).files).toBe(false);
      expect(result.code).toBe(0);
   });

   it('keeps a folder that still holds a file of the user and removes a folder it emptied', () =>
   {
      const SKILL = '.workflow/skills/fake-skill';
      const ctx   = start(true, { [`${SKILL}/SKILL.md`]: canonical({ name: 'fake-skill' }) });
      put(ctx.target, '.workflow/rules/foundation/fake-mine.txt', 'fake mine\n');
      ctx.engine.remove(RULE);
      ctx.engine.remove(SKILL);

      again(ctx);

      expect(existsSync(join(ctx.target, '.workflow/rules/foundation'))).toBe(true);
      expect(existsSync(join(ctx.target, SKILL))).toBe(false);
      expect(existsSync(join(ctx.target, '.workflow/skills'))).toBe(true);
   });

   it('never removes .kiro/prompts, .kiro/skills or .agents/skills, though it empties them', () =>
   {
      const ctx   = start(true);
      const OLD   = [
         '.kiro/prompts/fake-old.md',
         '.kiro/skills/fake-old/SKILL.md',
         '.agents/skills/fake-old/SKILL.md',
      ];
      const ROOTS = ['.kiro/prompts', '.kiro/skills', '.agents/skills'];
      const marker = markerOf(ctx.target);
      for (const path of OLD)
      {
         put(ctx.target, path, textOf(ctx.target, 'docs/overview.md'));
         marker.files[path] = marker.files['docs/overview.md'];
      }
      put(ctx.target, MARKER, JSON.stringify(marker));

      const { result } = again(ctx);

      for (const path of OLD)
      {
         expect(result.lines).toContain(`remove ${path}`);
         expect(existsSync(join(ctx.target, path))).toBe(false);
      }
      for (const root of ROOTS) { expect(existsSync(join(ctx.target, root))).toBe(true); }
      expect(existsSync(join(ctx.target, '.kiro/skills/fake-old'))).toBe(false);
      expect(existsSync(join(ctx.target, '.agents/skills/fake-old'))).toBe(false);
   });
});
