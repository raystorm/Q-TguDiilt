/**
 * Generated copies over time: a prompt that is deleted, renamed or turned into a helper, a self-install
 * after the canonical prompts change, the first self-install of a repository that already holds
 * hand-made prompt copies, and the files of the user that the installer never touches.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonical } from './fixtures.js';
import { again, cleanup, makeEngine, markerOf, prompt, put, recordingIo, runOn, start, textOf } from './engine.js';

afterEach(cleanup);

/** Files of the user that the installer never generates, with their text. */
const MINE: Record<string, string> = {
   '.kiro/prompts/hi.md':                'fake probe hi\n',
   '.kiro/prompts/args-probe.md':        'fake probe args\n',
   '.kiro/prompts/send-template.md':     'fake stale helper copy\n',
   '.agents/skills/test-skill/SKILL.md': 'fake user skill\n',
   '.kiro/skills/mine/SKILL.md':         'fake user kiro skill\n',
   '.github/skills/mine/SKILL.md':       'fake user copilot skill\n',
};

/** None of the user's files changed, was listed in `lines`, or is in the marker. */
function expectUntouched(target: string, lines: string[]): void
{
   const { files } = markerOf(target);
   for (const [path, text] of Object.entries(MINE))
   {
      expect(textOf(target, path)).toBe(text);
      expect(lines.some((line) => line.includes(path))).toBe(false);
      expect(path in files).toBe(false);
   }
}

describe('a prompt deleted from the engine', () =>
{
   it('loses its canonical copy and both generated copies, its folder and its names', () =>
   {
      const ctx  = start(true, prompt('fake-gone'));
      const gone = [
         '.workflow/prompts/fake-gone.md',
         '.kiro/prompts/fake-gone.md',
         '.agents/skills/fake-gone/SKILL.md',
      ];
      ctx.engine.remove('.workflow/prompts/fake-gone.md');

      const { result } = again(ctx);

      for (const path of gone)
      {
         expect(result.lines).toContain(`remove ${path}`);
         expect(existsSync(join(ctx.target, path))).toBe(false);
         expect(path in markerOf(ctx.target).files).toBe(false);
      }
      expect(existsSync(join(ctx.target, '.agents/skills/fake-gone'))).toBe(false);
      for (const path of ['.kiro/prompts/.gitignore', '.agents/skills/.gitignore'])
      { expect(textOf(ctx.target, path)).not.toContain('fake-gone'); }
      expect(result.code).toBe(0);
   });
});

describe('a prompt that changes what it earns', () =>
{
   it('that becomes a helper loses its generated copies and keeps its canonical copy', () =>
   {
      const ctx    = start(true, prompt('fake-turn'));
      const helper = canonical({ name: 'fake-turn', extra: { 'user-invocable': false } });
      ctx.engine.put('.workflow/prompts/fake-turn.md', helper);

      const { result } = again(ctx);

      expect(result.lines).toContain('remove .kiro/prompts/fake-turn.md');
      expect(result.lines).toContain('remove .agents/skills/fake-turn/SKILL.md');
      expect(existsSync(join(ctx.target, '.agents/skills/fake-turn'))).toBe(false);
      expect(textOf(ctx.target, '.workflow/prompts/fake-turn.md')).toBe(helper);
   });

   it('that is renamed loses the old copies and gets new ones', () =>
   {
      const ctx    = start(true, prompt('fake-old-name'));
      const copies = (name: string) =>
         [`.workflow/prompts/${name}.md`, `.kiro/prompts/${name}.md`, `.agents/skills/${name}/SKILL.md`];
      ctx.engine.remove('.workflow/prompts/fake-old-name.md');
      ctx.engine.put('.workflow/prompts/fake-new-name.md', canonical({ name: 'fake-new-name' }));

      const { result } = again(ctx);

      for (const path of copies('fake-old-name')) { expect(result.lines).toContain(`remove ${path}`); }
      for (const path of copies('fake-new-name')) { expect(result.lines).toContain(`create ${path}`); }
   });
});

describe('a self-install after the canonical prompts change', () =>
{
   it('touches only the generated copies of the edited and the deleted prompt', () =>
   {
      const engine   = makeEngine({ ...prompt('fake-edit'), ...prompt('fake-drop') });
      const recorded = recordingIo();
      const edited   = canonical({ name: 'fake-edit', body: 'Edited body.\n' });
      runOn(engine, [engine.dir], recorded);
      put(engine.dir, '.workflow/prompts/fake-edit.md', edited);
      engine.remove('.workflow/prompts/fake-drop.md');

      const { result } = runOn(engine, [engine.dir], recorded);

      expect([...result.lines].sort()).toEqual([
         'remove .agents/skills/fake-drop/SKILL.md',
         'remove .kiro/prompts/fake-drop.md',
         'update .agents/skills/.gitignore',
         'update .agents/skills/fake-edit/SKILL.md',
         'update .kiro/prompts/.gitignore',
         'update .kiro/prompts/fake-edit.md',
         'update .workflow/installed.json',
      ]);
      expect(textOf(engine.dir, '.workflow/prompts/fake-edit.md')).toBe(edited);
      expect(existsSync(join(engine.dir, '.workflow/prompts/fake-drop.md'))).toBe(false);
   });
});

describe('the first self-install of a repository with hand-made copies', () =>
{
   const HAND = ['fake-one', 'fake-two'];

   function repository()
   {
      const engine = makeEngine({ ...prompt('fake-one'), ...prompt('fake-two') });
      for (const name of HAND) { put(engine.dir, `.kiro/prompts/${name}.md`, `hand made ${name}\n`); }
      for (const [path, text] of Object.entries(MINE)) { put(engine.dir, path, text); }
      return engine;
   }

   it('reports each hand-made prompt copy as a conflict and changes nothing there', () =>
   {
      const engine = repository();

      const { result } = runOn(engine, [engine.dir]);

      for (const name of HAND)
      {
         expect(result.lines).toContain(`conflict .kiro/prompts/${name}.md`);
         expect(textOf(engine.dir, `.kiro/prompts/${name}.md`)).toBe(`hand made ${name}\n`);
      }
      expect(result.code).not.toBe(0);
      expectUntouched(engine.dir, result.lines);
   });

   it('replaces them with --force, leaves the files of the user, and then has nothing to write', () =>
   {
      const engine = repository();

      const { result } = runOn(engine, [engine.dir, '--force']);

      for (const name of HAND)
      { expect(textOf(engine.dir, `.kiro/prompts/${name}.md`)).not.toContain('hand made'); }
      expectUntouched(engine.dir, result.lines);
      expect(runOn(engine, [engine.dir, '--dry-run']).result.lines).toEqual(['nothing to write']);
   });
});

describe('files of the user among the generated ones', () =>
{
   it('are never changed, listed or recorded, with or without --force, and after a prompt is removed', () =>
   {
      const ctx = start(false, prompt('fake-one'));
      for (const [path, text] of Object.entries(MINE)) { put(ctx.target, path, text); }

      expectUntouched(ctx.target, again(ctx).result.lines);
      expectUntouched(ctx.target, again(ctx, '--force').result.lines);
      ctx.engine.remove('.workflow/prompts/fake-one.md');
      expectUntouched(ctx.target, again(ctx).result.lines);
   });
});
