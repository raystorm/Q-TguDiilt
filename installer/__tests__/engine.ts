/**
 * Test support for the installer: a fixture engine in a temporary folder, a snapshot of a folder,
 * and an `io` that records what the installer touches. Every name and text made up here is fake.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { realIo, type Io } from '../io.js';
import { run } from '../run.js';
import { canonical, type CanonicalFields } from './fixtures.js';

const made: string[] = [];

/** A new empty temporary folder. `cleanup` removes every one made so far. */
export function tempDir(prefix = 'installer-test-'): string
{
   const dir = mkdtempSync(join(tmpdir(), prefix));
   made.push(dir);
   return dir;
}

export function cleanup(): void
{
   for (const dir of made.splice(0)) { rmSync(dir, { recursive: true, force: true }); }
}

/** The structure markers of the Working Directories. */
export const MARKERS = [
   '.amazonq/work/.gitignore',
   '.amazonq/work/README.md',
   '.amazonq/work/current/.gitkeep',
   '.amazonq/work/status/.gitkeep',
   '.amazonq/suspended/.gitignore',
   '.amazonq/suspended/README.md',
   '.workflow/work/.gitignore',
   '.workflow/work/.gitkeep',
];

/** The single docs files the installer names. */
export const DOCS = [
   'docs/dev/commit-style-guide.md',
   'docs/dev/workflow/workflow-loops.md',
   'docs/dev/workflow/feature-tracking.md',
   'docs/overview.md',
   'docs/user-commands.md',
   'docs/FAQ.md',
   'docs/drift.md',
   'docs/extending.md',
   'docs/mindset.md',
   'docs/origin.md',
   'docs/profiles.md',
   'docs/dev/contract.md',
   'docs/dev/glossary.md',
   'docs/dev/governance.md',
   'docs/dev/workflow-patterns.md',
   'docs/dev/workflow/ai-workflow-system.md',
];

/** The text of a made-up file: its own path, so no two files hold the same bytes. */
const fake = (path: string) => `fake ${path}\n`;

/** The smallest engine the installer accepts: every file it names, a prompt, a helper, a rule each. */
function baseFiles(): Record<string, string>
{
   const files: Record<string, string> = {};
   const paths = [
      ...MARKERS,
      ...DOCS,
      '.workflow/rules/foundation/fake-rule.md',
      '.workflow/skills/README.md',
      '.amazonq/rules/fake-rule.md',
      'docs/user/fake-guide.md',
      'docs/user/fake-more.md',
   ];
   for (const path of paths) { files[path] = fake(path); }

   files['.workflow/prompts/fake-prompt.md'] = canonical({ name: 'fake-prompt' });
   files['.workflow/prompts/fake-helper.md'] =
      canonical({ name: 'fake-helper', extra: { 'user-invocable': false } });
   return files;
}

/** Writes a file, with its folders, under a folder of the test. */
export function put(dir: string, path: string, content: string | Buffer): void
{
   mkdirSync(dirname(join(dir, path)), { recursive: true });
   writeFileSync(join(dir, path), content);
}

export interface Engine
{
   dir: string;
   put(path: string, content: string | Buffer): void;
   remove(path: string): void;
}

/**
 * A fixture engine in a temporary folder: the smallest valid one, with `files` added or replaced
 * (`null` leaves a file out). The test states only the files it cares about.
 */
export function makeEngine(files: Record<string, string | Buffer | null> = {}): Engine
{
   const dir = tempDir('installer-engine-');
   for (const [path, content] of Object.entries({ ...baseFiles(), ...files }))
   {
      if (null !== content) { put(dir, path, content); }
   }
   return {
      dir,
      put:    (path, content) => put(dir, path, content),
      remove: (path) => rmSync(join(dir, path), { recursive: true, force: true }),
   };
}

/**
 * Every folder (its key ends in `/`, its value is empty) and every file (its value is its bytes as
 * latin1 text) under `dir`, by path relative to `dir`. Two equal snapshots mean nothing changed.
 */
export function tree(dir: string): Record<string, string>
{
   const found: Record<string, string> = {};
   const visit = (folder: string) =>
   {
      for (const entry of readdirSync(join(dir, folder), { withFileTypes: true }))
      {
         const path = '' === folder ? entry.name : `${folder}/${entry.name}`;
         if (entry.isDirectory())
         {
            found[`${path}/`] = '';
            visit(path);
         }
         else { found[path] = readFileSync(join(dir, path)).toString('latin1'); }
      }
   };
   visit('');
   return found;
}

/** A home folder with sentinel files, so a test can see that nothing was written there. */
function makeHome(): string
{
   const home = tempDir('installer-home-');
   for (const path of ['.fake-sentinel', '.aws/amazonq/prompts/fake-sentinel.md']) { put(home, path, fake(path)); }
   return home;
}

export interface Recorded
{
   io:      Io;
   /** Every path the installer read, listed or looked at. */
   reads:   string[];
   /** Every path the installer wrote. */
   writes:  string[];
   /** Every path the installer removed. */
   removes: string[];
   home:    string;
   /** The time `io.now()` gives; a test moves it. */
   clock:   { time: Date };
}

/**
 * The real file system, with every call recorded, a movable clock and a fake home folder. A write to
 * a path for which `failOn` is true throws, and is not recorded.
 */
export function recordingIo(failOn: (path: string) => boolean = () => false): Recorded
{
   const real = realIo();
   const reads: string[]   = [];
   const writes: string[]  = [];
   const removes: string[] = [];
   const clock = { time: new Date('2026-01-01T00:00:00.000Z') };
   const home  = makeHome();
   const io: Io = {
      read:     (path) => { reads.push(path); return real.read(path); },
      list:     (path) => { reads.push(path); return real.list(path); },
      stat:     (path) => { reads.push(path); return real.stat(path); },
      write:    (path, data, executable) =>
      {
         if (failOn(path)) { throw new Error('fake disk failure'); }
         writes.push(path);
         real.write(path, data, executable);
      },
      remove:   (path) => { removes.push(path); real.remove(path); },
      realPath: (path) => real.realPath(path),
      now:      () => clock.time,
      home,
   };
   return { io, reads, writes, removes, home, clock };
}

/** Runs the installer on `engine`; pass `recorded` again to run a second time with the same `io`. */
export function runOn(engine: Engine, argv: string[], recorded = recordingIo())
{
   return { ...recorded, result: run(argv, recorded.io, engine.dir) };
}

/** The files (no folders) under `dir`, relative. */
export const filesIn = (dir: string) => Object.keys(tree(dir)).filter((path) => !path.endsWith('/'));

/** Whether `git` can be run. The tests that need it are skipped without it. */
export const hasGit = 0 === spawnSync('git', ['--version']).status;

export interface MarkerFile
{
   version:     string;
   installedAt: string;
   files:       Record<string, string>;
}

/** What the marker file in `target` says. */
export const markerOf = (target: string): MarkerFile =>
   JSON.parse(readFileSync(join(target, '.workflow/installed.json'), 'utf8'));

export const textOf = (dir: string, path: string) => readFileSync(join(dir, path), 'utf8');

/** A fresh engine and an empty target, with one install done first when `installed`. */
export function start(installed: boolean, files: Record<string, string | null> = {})
{
   const engine   = makeEngine(files);
   const target   = tempDir('installer-target-');
   const recorded = recordingIo();
   if (installed) { runOn(engine, [target], recorded); }
   return { engine, target, recorded };
}
export type Start = ReturnType<typeof start>;

/** Runs again on the same engine, target and `io`. */
export const again = ({ engine, target, recorded }: Start, ...options: string[]) =>
   runOn(engine, [target, ...options], recorded);

/** A prompt of the fixture engine, as a file: `{ '.workflow/prompts/<name>.md': text }`. */
export const prompt = (name: string, fields: CanonicalFields = {}) =>
   ({ [`.workflow/prompts/${name}.md`]: canonical({ name, ...fields }) });

/** An authored skill of the fixture engine, as a file. */
export const skill = (name: string) => ({ [`.workflow/skills/${name}/SKILL.md`]: canonical({ name }) });

/**
 * Every `docs/...md` path named in the markdown files of the rule, prompt and skill folders of `dir`.
 * It reads what is installed, so it does not hard-code the list.
 */
export function docsNamedIn(dir: string): string[]
{
   const folders = ['.workflow/rules', '.workflow/prompts', '.workflow/skills', '.amazonq/rules'];
   const named   = new Set<string>();
   const files   = filesIn(dir).filter((path) =>
      path.endsWith('.md') && folders.some((folder) => path.startsWith(`${folder}/`)));
   for (const path of files)
   {
      for (const match of readFileSync(join(dir, path), 'utf8').matchAll(/docs\/[A-Za-z0-9_./-]+\.md/g))
      { named.add(match[0]); }
   }
   return [...named].sort();
}

/** The docs the installed rules and prompts name that `source` lacks, or that `target` lacks. */
export const missingDocs = (source: string, target: string) =>
   docsNamedIn(target).filter((path) => !existsSync(join(source, path)) || !existsSync(join(target, path)));

/**
 * The relative markdown links in the installed docs that resolve in `source` but not in `target`: pages
 * the installer failed to bring. A link that is already broken in `source` is not counted, and a link to
 * the root README is not either (it is the target's own).
 */
export function lostLinks(source: string, target: string): string[]
{
   const lost: string[] = [];
   const pages = filesIn(target).filter((path) => path.startsWith('docs/') && path.endsWith('.md'));
   for (const page of pages)
   {
      const links = readFileSync(join(target, page), 'utf8').matchAll(/]\(([^)\s#]+\.md)(?:#[^)]*)?\)/g);
      for (const link of links)
      {
         if (/^[a-z]+:/i.test(link[1])) { continue; }
         const resolved = posix.normalize(posix.join(posix.dirname(page), link[1]));
         if ('README.md' === resolved || resolved.startsWith('..')) { continue; }
         if (existsSync(join(source, resolved)) && !existsSync(join(target, resolved)))
         { lost.push(`${page} -> ${resolved}`); }
      }
   }
   return lost.sort();
}
