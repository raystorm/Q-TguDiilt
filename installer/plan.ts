import { join } from 'node:path';
import { firstLine, readText } from './canonical.js';
import { generate, shadowed } from './generate.js';
import type { Contents, Entry, Io } from './io.js';
import { manifest } from './manifest.js';
import { hash, readMarker } from './marker.js';
import { classify, type Kind } from './transform.js';

/**
 * What the installer does with one file: write it new, leave it, overwrite what it wrote earlier,
 * remove it, or report that it differs.
 */
export type ActionKind = 'create' | 'skip' | 'update' | 'conflict' | 'remove';

/** One file: where it goes (relative to the target, with `/`) and what is written there. */
export interface Action
{
   kind:       ActionKind;
   path:       string;
   data:       Buffer;
   executable: boolean;
   /** An update that overwrites a conflict, because of `--force`. */
   forced?:    true;
}

/** Something to tell the user while the run goes on. */
export interface Warning
{
   path:   string;
   detail: string;
}

/** A reason to refuse the whole run. */
export interface Stop
{
   detail: string;
}

/** The marker a run would write: what it records, and what it recorded before. */
export interface MarkerPlan
{
   kind:     'create' | 'update';
   files:    Record<string, string>;
   /** To fall back on for a file whose write fails. */
   previous: Record<string, string>;
}

/** What a run would do. A stop leaves `actions` empty. `marker` is null when it would not change. */
export interface Plan
{
   target:   string;
   actions:  Action[];
   warnings: Warning[];
   stops:    Stop[];
   marker:   MarkerPlan | null;
}

interface Found
{
   files:    Map<string, Contents>;
   warnings: Warning[];
   stops:    Stop[];
}

const byName = (a: Entry, b: Entry) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Whether the deny list leaves out this entry, found at `path` (relative to the engine root). */
function isDenied(path: string, entry: Entry): boolean
{
   const { deny } = manifest;
   if (deny.paths.includes(path)) { return true; }
   if ('dir' === entry.kind) { return deny.folders.includes(entry.name); }
   return deny.files.includes(entry.name) || deny.suffixes.some((suffix) => entry.name.endsWith(suffix));
}

/**
 * Reads one source file into `found`. A file in the prompts folder that is not a prompt or a helper
 * gets a warning instead. Returns false when the file is not there.
 */
function take(io: Io, source: string, path: string, found: Found): boolean
{
   const file = io.read(join(source, path));
   if (null === file) { return false; }

   if (path.startsWith(`${manifest.prompts}/`))
   {
      let kind: Kind;
      try { kind = classify(path, readText(file)).kind; }
      catch (error)
      {
         found.stops.push({ detail: `${path}: the frontmatter is not valid YAML (${firstLine(error)})` });
         return true;
      }
      if ('none' === kind)
      {
         found.warnings.push({ path, detail: 'not a prompt or a helper, so not copied' });
         return true;
      }
   }
   found.files.set(path, file);
   return true;
}

/** Takes every file under `dir` that the deny list lets through. A denied folder is never listed. */
function walk(io: Io, source: string, dir: string, found: Found): void
{
   for (const entry of io.list(join(source, dir)).sort(byName))
   {
      const path = `${dir}/${entry.name}`;
      if (isDenied(path, entry)) { continue; }
      if ('dir' === entry.kind) { walk(io, source, path, found); }
      else if ('file' === entry.kind) { take(io, source, path, found); }
   }
}

/** Everything the manifest names. A root folder or a named file the source lacks is a stop. */
function collect(io: Io, source: string): Found
{
   const found: Found = { files: new Map(), warnings: [], stops: [] };

   for (const root of manifest.roots)
   {
      if ('dir' === io.stat(join(source, root))) { walk(io, source, root, found); }
      else { found.stops.push({ detail: `the engine has no folder ${root}` }); }
   }
   for (const dir of manifest.workingDirs)
   {
      for (const entry of io.list(join(source, dir)).sort(byName))
      {
         if ('file' === entry.kind && manifest.markers.includes(entry.name))
         { take(io, source, `${dir}/${entry.name}`, found); }
      }
   }
   for (const path of manifest.files)
   {
      if (!take(io, source, path, found)) { found.stops.push({ detail: `the engine has no file ${path}` }); }
   }
   return found;
}

/**
 * What to do with one file, by what the target holds. `entry` is the hash the marker recorded for it.
 * A file that differs is updated when it still holds what the installer wrote; otherwise it is a
 * conflict, which `force` overwrites.
 */
function decide(
   io: Io, target: string, path: string, file: Contents, entry: string | undefined, force: boolean,
): Action
{
   const have = io.read(join(target, path));
   const base = { path, data: file.data, executable: file.executable };
   if (null === have) { return { kind: 'create', ...base }; }
   if (have.data.equals(file.data)) { return { kind: 'skip', ...base }; }
   if (undefined !== entry && hash(have.data) === entry) { return { kind: 'update', ...base }; }
   return force ? { kind: 'update', ...base, forced: true } : { kind: 'conflict', ...base };
}

/** Files the installer writes itself, as if they came from the engine. */
const written = (): Array<[string, Contents]> =>
   Object.entries(manifest.written).map(([path, text]) => [path, { data: Buffer.from(text), executable: false }]);

/** What the marker records after the run. A conflict keeps its old entry. */
function entriesAfter(actions: Action[], previous: Record<string, string>): Record<string, string>
{
   const files: Record<string, string> = {};
   for (const action of actions)
   {
      if ('remove' === action.kind) { continue; }
      if ('conflict' !== action.kind) { files[action.path] = hash(action.data); }
      else if (action.path in previous) { files[action.path] = previous[action.path]; }
   }
   return files;
}

const NOTHING = Buffer.alloc(0);

/**
 * What to do with a file the installer wrote earlier (it has a marker entry) whose source is gone:
 * remove it when nobody edited it, otherwise report a conflict, which `force` removes. Nothing when
 * the file is already gone.
 */
function retire(io: Io, target: string, path: string, entry: string, force: boolean): Action | null
{
   const have = io.read(join(target, path));
   if (null === have) { return null; }

   const base = { path, data: NOTHING, executable: false };
   if (hash(have.data) === entry) { return { kind: 'remove', ...base }; }
   return force ? { kind: 'remove', ...base, forced: true } : { kind: 'conflict', ...base };
}

const sameEntries = (a: Record<string, string>, b: Record<string, string>) =>
   JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/**
 * Reads the engine and the target through `io` and says what a run would do. `force` overwrites a
 * conflict. When the target is the engine itself, nothing is copied onto itself: those files are
 * neither planned nor recorded, and a removal never touches them. Writes nothing.
 */
export function plan(io: Io, source: string, target: string, force: boolean): Plan
{
   const { files, warnings, stops } = collect(io, source);
   const made   = generate(files);
   stops.push(...made.stops.map((detail) => ({ detail })));
   const marker = readMarker(io, target);
   if ('invalid' === marker) { stops.push({ detail: `${manifest.marker} cannot be read; fix or delete it` }); }
   if (0 < stops.length || 'invalid' === marker) { return { target, actions: [], warnings, stops, marker: null }; }

   warnings.push(...shadowed(io, target, made.skills));
   const previous = marker?.files ?? {};
   const copies   = io.realPath(source) === io.realPath(target) ? [] : [...files];
   const actions  = [...copies, ...made.files, ...written()]
      .map(([path, file]) => decide(io, target, path, file, previous[path], force));
   const wanted   = new Set([...files.keys(), ...actions.map((action) => action.path)]);
   for (const [path, entry] of Object.entries(previous))
   {
      const gone = wanted.has(path) ? null : retire(io, target, path, entry, force);
      if (null !== gone) { actions.push(gone); }
   }
   const entries  = entriesAfter(actions, previous);
   const changed  = null === marker || !sameEntries(entries, previous);
   return {
      target, actions, warnings, stops,
      marker: changed ? { kind: null === marker ? 'create' : 'update', files: entries, previous } : null,
   };
}
