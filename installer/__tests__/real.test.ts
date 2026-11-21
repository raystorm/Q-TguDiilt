/**
 * The installer on the real engine checkout. The checkout is only read; every install goes into a
 * temporary folder. It installs, installs again, and checks what the installed rules, prompts and docs
 * point at. The last group proves that those checks can fail.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Result } from '../apply.js';
import { plan } from '../plan.js';
import { run } from '../run.js';
import { classify } from '../transform.js';
import {
   cleanup, docsNamedIn, filesIn, lostLinks, makeEngine, markerOf, MARKERS, missingDocs, recordingIo,
   tempDir, type Recorded,
} from './engine.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let target:   string;
let recorded: Recorded;
let first:    Result;

beforeAll(() =>
{
   target   = tempDir('installer-real-');
   recorded = recordingIo();
   first    = run([target], recorded.io, REPO);
});

afterAll(cleanup);

/** The kind of every file in the real `.workflow/prompts`, by the transform's own classification. */
function promptKinds(): Array<{ file: string; kind: string }>
{
   const folder = join(REPO, '.workflow/prompts');
   return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) =>
      {
         const text = readFileSync(join(folder, entry.name), 'utf8').replace(/^\uFEFF/, '');
         return { file: entry.name, kind: classify(entry.name, text).kind };
      });
}

describe('installing the real engine into an empty target', () =>
{
   it('has no stop and ends with code 0', () =>
   {
      expect(first.lines.filter((line) => line.startsWith('stop'))).toEqual([]);
      expect(first.code).toBe(0);
   });

   it('copies nothing the manifest denies, and only the markers of the Working Directories', () =>
   {
      const files   = filesIn(target);
      const working = ['.amazonq/work', '.amazonq/suspended', '.workflow/work'];
      expect(files.filter((path) => /(^|\/)(node_modules|__tests__|__integration__)\//.test(path))).toEqual([]);
      expect(files.filter((path) => path.endsWith('/registry.yaml') || path.endsWith('-project.md'))).toEqual([]);
      expect(files.filter((path) => working.some((folder) => path.startsWith(`${folder}/`))).sort())
         .toEqual([...MARKERS].sort());
      expect(markerOf(target).installedAt).toBe(recorded.clock.time.toISOString());
   });

   it('warns once about each file in .workflow/prompts that is not a prompt or a helper, and no other', () =>
   {
      const strays = promptKinds()
         .filter(({ kind }) => 'none' === kind)
         .map(({ file }) => `.workflow/prompts/${file}`)
         .sort();
      const warned = first.lines
         .filter((line) => line.startsWith('warning '))
         .map((line) => line.slice('warning '.length).split(':')[0])
         .sort();
      expect(warned).toEqual(strays);
   });

   it('renders each prompt once per agent, and copies each helper without rendering it', () =>
   {
      const kinds     = promptKinds();
      const prompts   = kinds.filter(({ kind }) => 'prompt' === kind);
      const helpers   = kinds.filter(({ kind }) => 'helper' === kind);
      const skillsDir = join(REPO, '.workflow/skills');
      const skills    = readdirSync(skillsDir, { withFileTypes: true })
         .filter((entry) => entry.isDirectory() && existsSync(join(skillsDir, entry.name, 'SKILL.md')));
      const files     = filesIn(target);

      expect(files.filter((path) => /^\.kiro\/prompts\/[^/]+\.md$/.test(path))).toHaveLength(prompts.length);
      expect(files.filter((path) => /^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(path)))
         .toHaveLength(prompts.length + skills.length);
      for (const { file } of helpers)
      {
         expect(existsSync(join(target, '.workflow/prompts', file))).toBe(true);
         expect(existsSync(join(target, '.kiro/prompts', file))).toBe(false);
      }
   });
});

describe('what the installed rules, prompts and docs point at', () =>
{
   it('has every docs page that a rule or a prompt names, in the checkout and in the target', () =>
   {
      expect(docsNamedIn(target).length).toBeGreaterThan(0);
      expect(missingDocs(REPO, target)).toEqual([]);
   });

   it('has every page that an installed docs page links to, when the page exists in the checkout', () =>
   {
      expect(lostLinks(REPO, target)).toEqual([]);
   });
});

describe('a second run on the real engine', () =>
{
   it('has only skips and ends with nothing to write', () =>
   {
      const planned = plan(recorded.io, REPO, target, false);
      const again   = run([target, '--dry-run'], recorded.io, REPO);

      expect(planned.actions.every((action) => 'skip' === action.kind)).toBe(true);
      expect(planned.marker).toBeNull();
      expect(again.lines.at(-1)).toBe('nothing to write');
      expect(again.code).toBe(0);
   });
});

describe('the checks themselves', () =>
{
   it('report a docs page that a rule names and the engine does not have', () =>
   {
      const engine = makeEngine({
         '.workflow/rules/foundation/fake-names-doc.md': 'See docs/dev/fake-missing.md\n',
      });
      const fakeTarget = tempDir('installer-target-');
      run([fakeTarget], recordingIo().io, engine.dir);

      expect(missingDocs(engine.dir, fakeTarget)).toEqual(['docs/dev/fake-missing.md']);
   });

   it('report a page that an installed docs page links to and the installer did not bring', () =>
   {
      const engine = makeEngine({
         'docs/overview.md':          'See [it](dev/fake-unlisted.md).\n',
         'docs/dev/fake-unlisted.md': 'fake page\n',
      });
      const fakeTarget = tempDir('installer-target-');
      run([fakeTarget], recordingIo().io, engine.dir);

      expect(lostLinks(engine.dir, fakeTarget)).toEqual(['docs/overview.md -> docs/dev/fake-unlisted.md']);
   });
});
