/**
 * What the installer refuses or warns about before it writes: a name or pair of names that cannot be
 * installed, frontmatter that cannot be read, a name that does not match its file or folder, a
 * byte-order mark, and a Copilot skill in the target that would hide a generated one.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonical } from './fixtures.js';
import { cleanup, makeEngine, markerOf, prompt, put, runOn, skill, tempDir, textOf, tree } from './engine.js';

afterEach(cleanup);

const BOM = '\uFEFF';

const HELPER = canonical({ name: 'Fake-Helper', extra: { 'user-invocable': false } });

const BAD_NAMES = [
   {
      name:     'a name with a space',
      files:    prompt('fake name'),
      fragment: 'fake name.md',
   },
   {
      name:     'two names that give one folder',
      files:    { ...prompt('fakeFoo'), ...prompt('fake-foo') },
      fragment: 'fake-foo.md',
   },
   {
      name:     'two prompts whose names differ only by case',
      files:    { ...prompt('FakeCase'), ...prompt('fakecase') },
      fragment: 'fakecase.md',
   },
   {
      name:     'a prompt and a skill whose names differ only by case',
      files:    { ...prompt('Fake'), ...skill('fake') },
      fragment: 'skills/fake',
   },
   {
      name:     'a prompt whose folder is a skill\'s folder',
      files:    { ...prompt('fakeSkill'), ...skill('fake-skill') },
      fragment: 'fakeSkill.md',
   },
   {
      name:     'a helper and a prompt whose names differ only by case',
      files:    { '.workflow/prompts/Fake-Helper.md': HELPER, ...prompt('fake-helper') },
      fragment: 'Fake-Helper.md',
   },
   {
      name:     'a prompt that declares a slot its body never uses',
      files:    prompt('fake-unused', { arguments: ['x'], body: 'No slot here.\n' }),
      fragment: 'fake-unused.md',
   },
];

describe('a name that cannot be installed', () =>
{
   it.each(BAD_NAMES)('stops for $name, writes nothing, and --force changes nothing', ({ files, fragment }) =>
   {
      for (const options of [[], ['--force']])
      {
         const target = tempDir('installer-target-');

         const { result, writes } = runOn(makeEngine(files), [target, ...options]);

         const stops = result.lines.filter((line) => line.startsWith('stop: ')).join('\n');
         expect(result.code).not.toBe(0);
         expect(stops).toContain(fragment);
         expect(writes).toEqual([]);
         expect(tree(target)).toEqual({});
      }
   });
});

describe('a name that does not match', () =>
{
   it('stops for a prompt whose name differs from its file name, and names the file', () =>
   {
      const files = { '.workflow/prompts/fake-stem.md': canonical({ name: 'fake-other' }) };

      const { result, writes } = runOn(makeEngine(files), [tempDir('installer-target-')]);

      expect(result.code).not.toBe(0);
      expect(result.lines.join('\n')).toContain('fake-stem.md');
      expect(writes).toEqual([]);
   });

   it('stops for a skill whose name differs from its folder, and names the folder', () =>
   {
      const files = { '.workflow/skills/fake-dir/SKILL.md': canonical({ name: 'fake-other' }) };

      const { result, writes } = runOn(makeEngine(files), [tempDir('installer-target-')]);

      expect(result.code).not.toBe(0);
      expect(result.lines.join('\n')).toContain('skills/fake-dir');
      expect(writes).toEqual([]);
   });

   it('ignores a skill folder with no SKILL.md, with no warning and no stop', () =>
   {
      const files = { '.workflow/skills/fake-empty/notes.md': 'fake notes\n' };

      const { result } = runOn(makeEngine(files), [tempDir('installer-target-')]);

      expect(result.code).toBe(0);
      expect(result.lines.filter((line) => line.startsWith('warning') || line.startsWith('stop'))).toEqual([]);
   });
});

describe('frontmatter that is not valid YAML', () =>
{
   it.each([
      { name: 'a prompt', path: '.workflow/prompts/fake-yaml.md' },
      { name: 'a skill',  path: '.workflow/skills/fake-yaml/SKILL.md' },
   ])('stops for $name, names the file, shows no stack and writes nothing', ({ path }) =>
   {
      const target = tempDir('installer-target-');
      const engine = makeEngine({ [path]: '---\nname: [unclosed\n---\nBody.\n' });

      const { result, writes } = runOn(engine, [target]);

      expect(result.code).not.toBe(0);
      expect(result.lines.join('\n')).toContain(path);
      expect(result.lines.some((line) => /^\s+at /.test(line))).toBe(false);
      expect(writes).toEqual([]);
      expect(tree(target)).toEqual({});
   });
});

describe('a file that starts with a byte-order mark', () =>
{
   const marked = (target: string, path: string) => textOf(target, path).startsWith(BOM);

   it('is read as a prompt, rendered without the mark, and its canonical copy keeps the source bytes', () =>
   {
      const source = `${BOM}${canonical({ name: 'fake-bom' })}`;
      const engine = makeEngine({ '.workflow/prompts/fake-bom.md': source, 'docs/user/fake-twin.md': source });
      const target = tempDir('installer-target-');

      runOn(engine, [target]);

      const { files } = markerOf(target);
      expect(marked(target, '.kiro/prompts/fake-bom.md')).toBe(false);
      expect(marked(target, '.agents/skills/fake-bom/SKILL.md')).toBe(false);
      expect(readFileSync(join(target, '.workflow/prompts/fake-bom.md'))).toEqual(Buffer.from(source));
      expect(files['.workflow/prompts/fake-bom.md']).toBe(files['docs/user/fake-twin.md']);
   });

   it('is read as a skill, rendered for both agents without the mark, with the source bytes kept', () =>
   {
      const source = `${BOM}${canonical({ name: 'fake-bom-skill' })}`;
      const engine = makeEngine({ '.workflow/skills/fake-bom-skill/SKILL.md': source });
      const target = tempDir('installer-target-');

      runOn(engine, [target]);

      const canonicalCopy = readFileSync(join(target, '.workflow/skills/fake-bom-skill/SKILL.md'));
      expect(marked(target, '.kiro/skills/fake-bom-skill/SKILL.md')).toBe(false);
      expect(marked(target, '.agents/skills/fake-bom-skill/SKILL.md')).toBe(false);
      expect(canonicalCopy).toEqual(Buffer.from(source));
   });

   it('with no frontmatter is warned about as a non-prompt and not copied', () =>
   {
      const path   = '.workflow/prompts/fake-plain.md';
      const target = tempDir('installer-target-');

      const { result } = runOn(makeEngine({ [path]: `${BOM}Say hello.\n` }), [target]);

      expect(result.lines.some((line) => line.startsWith(`warning ${path}`))).toBe(true);
      expect(existsSync(join(target, path))).toBe(false);
   });

   it('is a helper when it says so: copied with the source bytes and not rendered', () =>
   {
      const source = `${BOM}${canonical({ name: 'fake-bom-helper', extra: { 'user-invocable': false } })}`;
      const path   = '.workflow/prompts/fake-bom-helper.md';
      const target = tempDir('installer-target-');

      runOn(makeEngine({ [path]: source }), [target]);

      expect(readFileSync(join(target, path))).toEqual(Buffer.from(source));
      expect(existsSync(join(target, '.kiro/prompts/fake-bom-helper.md'))).toBe(false);
   });
});

describe('a Copilot skill in the target\'s .github/skills', () =>
{
   const warnings = (lines: string[]) => lines.filter((line) => line.startsWith('warning .github/skills/'));

   function installOver(folder: string, name: string)
   {
      const engine = makeEngine(prompt('fakeProfile'));
      const target = tempDir('installer-target-');
      const mine   = `.github/skills/${folder}/SKILL.md`;
      put(target, mine, canonical({ name }));

      const { result } = runOn(engine, [target]);
      return { result, target, mine };
   }

   it.each([
      { title: 'is named like a generated skill',        folder: 'fake-profile', named: 'fake-other' },
      { title: 'has the same name as a generated skill', folder: 'mine',         named: 'fakeProfile' },
   ])('that $title gets a warning, is left alone, and does not stop the run', ({ folder, named }) =>
   {
      const { result, target, mine } = installOver(folder, named);

      expect(warnings(result.lines)).toHaveLength(1);
      expect(warnings(result.lines)[0]).toContain(`.github/skills/${folder}`);
      expect(textOf(target, mine)).toBe(canonical({ name: named }));
      expect(existsSync(join(target, '.agents/skills/fake-profile/SKILL.md'))).toBe(true);
      expect(result.code).toBe(0);
   });

   it('that is named and called something else gets no warning', () =>
   {
      const { result } = installOver('hello-there', 'helloThere');

      expect(warnings(result.lines)).toEqual([]);
      expect(result.code).toBe(0);
   });
});
