/**
 * What the installer generates from the canonical prompts and skills: a Kiro prompt and a Copilot
 * skill per prompt, both agents' skills per authored skill, the ignore files that list them, and
 * nothing else in a skill folder. The expected text is what the transform renders.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderCopilot, renderKiro } from '../transform.js';
import { canonical, parts } from './fixtures.js';
import { again, cleanup, filesIn, makeEngine, markerOf, runOn, start, tempDir, textOf } from './engine.js';

afterEach(cleanup);

/** Prompts of four shapes: no argument, a positional one, the free-text one, and a camelCase name. */
const PROMPTS: Record<string, string> = {
   'fake-start':   canonical({ name: 'fake-start' }),
   'fake-handoff': canonical({ name: 'fake-handoff', arguments: ['to'], body: 'Hand off to {{to}}.\n' }),
   'fake-note':    canonical({ name: 'fake-note', arguments: ['input'], body: 'Note: {{input}}\n' }),
   fakeProfile:    canonical({ name: 'fakeProfile', arguments: ['profile'], body: 'Act as {{profile}}.\n' }),
};

const promptFiles = () => Object.fromEntries(
   Object.entries(PROMPTS).map(([name, text]) => [`.workflow/prompts/${name}.md`, text]),
);

/** Authored skills: one that keeps `disable-model-invocation: false`, and an internal one. */
const SKILLS: Record<string, string> = {
   'fake-skill': canonical({
      name: 'fake-skill', arguments: ['input'], body: 'Run {{input}}.\n',
      extra: { 'disable-model-invocation': false },
   }),
   '_fake-internal': canonical({ name: '_fake-internal', body: 'Internal.\n' }),
};

const skillFiles = () => Object.fromEntries(
   Object.entries(SKILLS).map(([name, text]) => [`.workflow/skills/${name}/SKILL.md`, text]),
);

/** The names an ignore file lists, without its comment line. */
const namesIn = (target: string, path: string) =>
   textOf(target, path).split('\n').filter((line) => '' !== line && !line.startsWith('#')).sort();

describe('a prompt', () =>
{
   it('is written to .kiro/prompts/<name>.md as the Kiro render, and recorded', () =>
   {
      const ctx = start(true, promptFiles());

      for (const [name, source] of Object.entries(PROMPTS))
      {
         const path = `.kiro/prompts/${name}.md`;
         expect(textOf(ctx.target, path)).toBe(renderKiro(`${name}.md`, source, 'prompt').text);
         expect(path in markerOf(ctx.target).files).toBe(true);
      }
   });

   it('is written to .agents/skills/<folder>/SKILL.md as the Copilot render, and recorded', () =>
   {
      const ctx = start(true, promptFiles());

      for (const [name, source] of Object.entries(PROMPTS))
      {
         const rendered = renderCopilot(`${name}.md`, source, 'prompt');
         const path     = `.agents/skills/${rendered.folder}/SKILL.md`;
         expect(textOf(ctx.target, path)).toBe(rendered.text);
         expect(path in markerOf(ctx.target).files).toBe(true);
      }
      const camel = parts(textOf(ctx.target, '.agents/skills/fake-profile/SKILL.md')).frontmatter;
      expect(camel.name).toBe('fakeProfile');
      expect(camel['disable-model-invocation']).toBe(true);
      expect(filesIn(ctx.target).filter((path) => path.startsWith('.github/'))).toEqual([]);
   });

   it('that is a helper is copied with its source bytes and rendered nowhere', () =>
   {
      const engine = makeEngine();
      const target = tempDir('installer-target-');

      const { result } = runOn(engine, [target]);

      const helper = '.workflow/prompts/fake-helper.md';
      expect(readFileSync(join(target, helper))).toEqual(readFileSync(join(engine.dir, helper)));
      expect(existsSync(join(target, '.kiro/prompts/fake-helper.md'))).toBe(false);
      expect(existsSync(join(target, '.agents/skills/fake-helper'))).toBe(false);
      for (const path of ['.kiro/prompts/.gitignore', '.agents/skills/.gitignore'])
      { expect(textOf(target, path)).not.toContain('fake-helper'); }
      expect(result.lines.filter((line) => line.startsWith('warning'))).toEqual([]);
   });
});

describe('an authored skill', () =>
{
   it('is written for both agents as the render of its source, and the canonical folder is copied', () =>
   {
      const engine = makeEngine(skillFiles());
      const target = tempDir('installer-target-');

      const { result } = runOn(engine, [target]);

      for (const [name, source] of Object.entries(SKILLS))
      {
         const file    = `.workflow/skills/${name}/SKILL.md`;
         const copilot = renderCopilot(file, source, 'skill').text;
         const kiro    = renderKiro(file, source, 'skill').text;
         expect(textOf(target, `.agents/skills/${name}/SKILL.md`)).toBe(copilot);
         expect(textOf(target, `.kiro/skills/${name}/SKILL.md`)).toBe(kiro);
         expect(textOf(target, file)).toBe(source);
      }
      const kept = parts(textOf(target, '.agents/skills/fake-skill/SKILL.md')).frontmatter;
      expect(kept['disable-model-invocation']).toBe(false);
      expect(existsSync(join(target, '.agents/skills/README.md'))).toBe(false);
      expect(result.lines.filter((line) => line.startsWith('warning'))).toEqual([]);
   });

   it('holds only SKILL.md in each generated folder, though the skill folder has scripts', () =>
   {
      const engine = makeEngine({
         ...skillFiles(),
         '.workflow/skills/fake-skill/scripts/run.sh':      '#!/bin/sh\necho fake\n',
         '.workflow/skills/fake-skill/references/notes.md': 'fake notes\n',
      });
      const target = tempDir('installer-target-');

      runOn(engine, [target]);

      for (const folder of ['.agents/skills/fake-skill/', '.kiro/skills/fake-skill/'])
      { expect(filesIn(target).filter((path) => path.startsWith(folder))).toEqual([`${folder}SKILL.md`]); }
      expect(textOf(target, '.workflow/skills/fake-skill/scripts/run.sh')).toBe('#!/bin/sh\necho fake\n');
   });

   it('added later creates only its own files and the ignore changes', () =>
   {
      const ctx = start(true, promptFiles());
      ctx.engine.put('.workflow/skills/fake-new/SKILL.md', canonical({ name: 'fake-new' }));

      const { result } = again(ctx);

      expect([...result.lines].sort()).toEqual([
         '--------',
         'create .agents/skills/fake-new/SKILL.md',
         'create .kiro/skills/.gitignore',
         'create .kiro/skills/fake-new/SKILL.md',
         'create .workflow/skills/fake-new/SKILL.md',
         'update .agents/skills/.gitignore',
         'update .workflow/installed.json',
      ]);
   });
});

describe('the ignore files', () =>
{
   it('list exactly the generated names, one file per generated folder', () =>
   {
      const ctx = start(true, { ...promptFiles(), ...skillFiles() });

      expect(namesIn(ctx.target, '.kiro/prompts/.gitignore')).toEqual(
         ['fake-handoff.md', 'fake-note.md', 'fake-prompt.md', 'fake-start.md', 'fakeProfile.md']);
      expect(namesIn(ctx.target, '.kiro/skills/.gitignore')).toEqual(['_fake-internal/', 'fake-skill/']);
      expect(namesIn(ctx.target, '.agents/skills/.gitignore')).toEqual([
         '_fake-internal/', 'fake-handoff/', 'fake-note/', 'fake-profile/', 'fake-prompt/', 'fake-skill/',
         'fake-start/',
      ]);
   });

   it('are not written for a folder where nothing is generated', () =>
   {
      const ctx = start(true);

      expect(existsSync(join(ctx.target, '.kiro/skills/.gitignore'))).toBe(false);
      expect(existsSync(join(ctx.target, '.kiro/prompts/.gitignore'))).toBe(true);
   });

   it('leave the target\'s own root .gitignore alone, or absent', () =>
   {
      const bare = start(true);
      expect(existsSync(join(bare.target, '.gitignore'))).toBe(false);

      const own = start(false);
      writeFileSync(join(own.target, '.gitignore'), 'fake mine\n');
      again(own);
      expect(textOf(own.target, '.gitignore')).toBe('fake mine\n');
   });
});
