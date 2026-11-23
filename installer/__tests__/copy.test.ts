/**
 * What the installer copies from the engine into a target: the `.workflow/` tree less its deny list,
 * the rules, the structure markers of the Working Directories and the docs. Nothing is rendered, and
 * the installer's own files (the marker, the ignore files) are not written yet.
 */
import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { apply } from '../apply.js';
import { plan } from '../plan.js';
import { canonical } from './fixtures.js';
import { cleanup, DOCS, makeEngine, MARKERS, recordingIo, tempDir, tree, type Engine } from './engine.js';

afterEach(cleanup);

/** Plans `engine` into a new empty target and writes it, as a real run does. */
function install(engine: Engine)
{
   const target   = tempDir('installer-target-');
   const recorded = recordingIo();
   const planned  = plan(recorded.io, engine.dir, target, false);
   const result   = apply(planned, recorded.io);
   return { ...recorded, planned, result, target };
}

const bytesIn = (dir: string, path: string) => readFileSync(join(dir, path));
const has     = (dir: string, path: string) => existsSync(join(dir, path));

/** The files (no folders) of `target` under any of `folders`, sorted. */
const filesUnder = (target: string, folders: string[]) =>
   Object.keys(tree(target))
      .filter((path) => !path.endsWith('/') && folders.some((folder) => path.startsWith(`${folder}/`)))
      .sort();

describe('the .workflow tree', () =>
{
   const ACP = {
      '.workflow/acp/protocol/index.ts':             'fake entry\n',
      '.workflow/acp/package.json':                  '{ "name": "fake" }\n',
      '.workflow/acp/tsconfig.json':                 '{}\n',
      '.workflow/acp/drivers/registry.example.yaml': 'fake: example\n',
   };

   it('copies rules, a prompt, the ACP sources, the example registry and the skills readme', () =>
   {
      const engine = makeEngine(ACP);
      const { target } = install(engine);
      const copied = [
         ...Object.keys(ACP),
         '.workflow/rules/foundation/fake-rule.md',
         '.workflow/prompts/fake-prompt.md',
         '.workflow/skills/README.md',
      ];
      for (const path of copied) { expect(bytesIn(target, path)).toEqual(bytesIn(engine.dir, path)); }
   });

   it.each([
      '.workflow/acp/node_modules/pkg/index.js',
      '.workflow/acp/protocol/__tests__/a.test.ts',
      '.workflow/acp/drivers/__integration__/b.ts',
      '.workflow/rules/foundation/fake-project.md',
      '.workflow/rules/tech/fake-project.md',
      '.workflow/skills/fake-skill/__tests__/a.test.sh',
   ])('leaves out %s, with no warning', (path) =>
   {
      const { planned, target } = install(makeEngine({ [path]: 'fake denied\n' }));
      expect(has(target, path)).toBe(false);
      expect(planned.warnings).toEqual([]);
   });

   it('never reads or lists inside a denied folder', () =>
   {
      const engine = makeEngine({
         '.workflow/acp/node_modules/pkg/index.js':    'fake\n',
         '.workflow/acp/protocol/__tests__/a.test.ts': 'fake\n',
         '.workflow/acp/drivers/__integration__/b.ts': 'fake\n',
      });
      const recorded = recordingIo();
      plan(recorded.io, engine.dir, tempDir('installer-target-'), false);
      const inside = recorded.reads
         .map((path) => relative(engine.dir, path))
         .filter((path) => /(^|[\\/])(node_modules|__tests__|__integration__)([\\/]|$)/.test(path));
      expect(inside).toEqual([]);
   });
});

describe('the prompts folder', () =>
{
   it('skips what is neither a prompt nor a helper, with one warning that names each file', () =>
   {
      const strays = [
         '.workflow/prompts/fake-hello.md',
         '.workflow/prompts/fake-notes.txt',
         '.workflow/prompts/fake-noname.md',
      ];
      const engine = makeEngine({
         '.workflow/prompts/fake-hello.md':  'Say Hello fake.\n',
         '.workflow/prompts/fake-notes.txt': 'fake notes\n',
         '.workflow/prompts/fake-noname.md': canonical({ name: null, description: 'fake, no name' }),
      });
      const { planned, result, target } = install(engine);

      for (const path of strays) { expect(has(target, path)).toBe(false); }
      expect(planned.warnings.map((warning) => warning.path).sort()).toEqual([...strays].sort());
      expect(bytesIn(target, '.workflow/prompts/fake-prompt.md')).toEqual(
         bytesIn(engine.dir, '.workflow/prompts/fake-prompt.md'));
      expect(result.code).toBe(0);
   });
});

describe('the Working Directories', () =>
{
   const WORKING = ['.amazonq/work', '.amazonq/suspended', '.workflow/work'];

   it('copies the structure markers with the same bytes', () =>
   {
      const engine = makeEngine();
      const { target } = install(engine);
      for (const path of MARKERS) { expect(bytesIn(target, path)).toEqual(bytesIn(engine.dir, path)); }
   });

   it.each([
      '.amazonq/work/FEATURE.md',
      '.amazonq/work/current/HANDOFF.md',
      '.amazonq/work/current/FAKE-NOTE.md',
      '.amazonq/work/status/Fake-wf-fake.json',
      '.amazonq/work/other/README.md',
      '.amazonq/suspended/INDEX.md',
      '.amazonq/suspended/auto-fake-wf-fake.md',
      '.amazonq/suspended/fake-manual.md',
      '.workflow/work/acp.log',
      '.workflow/work/acp-diagnostic.log',
      '.workflow/work/acp-diagnostic.log.1',
      '.amazonq/workflow.log',
      '.amazonq/.timestamp-temp',
   ])('does not copy %s, and the Working Directories hold only the markers', (path) =>
   {
      const { target } = install(makeEngine({ [path]: 'fake private\n' }));
      expect(has(target, path)).toBe(false);
      expect(filesUnder(target, WORKING)).toEqual([...MARKERS].sort());
   });
});

describe('the rules', () =>
{
   it('copies .amazonq/rules as it stands and nothing from .amazonq/prompts', () =>
   {
      const engine = makeEngine({
         '.amazonq/rules/fake-second.md':     'fake second rule\n',
         '.amazonq/prompts/fake-q-prompt.md': 'fake q prompt\n',
      });
      const { target } = install(engine);

      for (const path of ['.amazonq/rules/fake-rule.md', '.amazonq/rules/fake-second.md'])
      { expect(bytesIn(target, path)).toEqual(bytesIn(engine.dir, path)); }
      expect(has(target, '.amazonq/prompts')).toBe(false);
   });
});

describe('the docs', () =>
{
   it('copies the named docs, docs/user and the overview pages, and nothing else from docs/dev', () =>
   {
      const engine = makeEngine({ 'docs/dev/fake-other.md': 'fake other\n' });
      const { target } = install(engine);

      for (const path of [...DOCS, 'docs/user/fake-guide.md', 'docs/user/fake-more.md'])
      { expect(bytesIn(target, path)).toEqual(bytesIn(engine.dir, path)); }
      expect(filesUnder(target, ['docs/dev'])).toEqual(DOCS.filter((path) => path.startsWith('docs/dev/')).sort());
   });
});

describe('a skill folder', () =>
{
   const SKILL = '.workflow/skills/fake-skill';
   const KEPT  = [`${SKILL}/SKILL.md`, `${SKILL}/scripts/run.sh`, `${SKILL}/references/notes.md`];

   function installSkill()
   {
      const engine = makeEngine({
         [KEPT[0]]:                        canonical({ name: 'fake-skill' }),
         [KEPT[1]]:                        '#!/bin/sh\necho fake\n',
         [KEPT[2]]:                        'fake notes\n',
         [`${SKILL}/__tests__/a.test.sh`]: 'fake test\n',
      });
      chmodSync(join(engine.dir, KEPT[1]), 0o755);
      return { engine, ...install(engine) };
   }

   it('is copied whole with the same bytes, less its tests', () =>
   {
      const { engine, target } = installSkill();
      for (const path of KEPT) { expect(bytesIn(target, path)).toEqual(bytesIn(engine.dir, path)); }
      expect(has(target, `${SKILL}/__tests__`)).toBe(false);
   });

   it.skipIf('win32' === process.platform)('keeps a script executable and a text file not', () =>
   {
      const { target } = installSkill();
      expect(0 !== (statSync(join(target, KEPT[1])).mode & 0o111)).toBe(true);
      expect(0 === (statSync(join(target, KEPT[0])).mode & 0o111)).toBe(true);
   });
});
