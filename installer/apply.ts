import { join, posix } from 'node:path';
import type { Io } from './io.js';
import { manifest } from './manifest.js';
import { serialize } from './marker.js';
import type { Action, Plan } from './plan.js';

/** What a run prints and the code it ends with. */
export interface Result
{
   code:  number;
   lines: string[];
}

const label = (action: Action) => `${action.kind} ${action.path}${action.forced ? ' (forced)' : ''}`;

/**
 * What a run prints: the stops, the warnings, each action that is not a skip, then the marker. A run
 * with nothing to write ends with `nothing to write`.
 */
function report(plan: Plan): string[]
{
   const lines = [
      ...plan.stops.map((stop) => `stop: ${stop.detail}`),
      ...plan.warnings.map((warning) => `warning ${warning.path}: ${warning.detail}`),
      ...plan.actions.filter((action) => 'skip' !== action.kind).map(label),
      ...(null === plan.marker ? [] : [`${plan.marker.kind} ${manifest.marker}`]),
   ];
   const idle = 0 === plan.stops.length && null === plan.marker
      && plan.actions.every((action) => 'skip' === action.kind);
   return idle ? [...lines, 'nothing to write'] : lines;
}

/** What a run prints and returns when it writes nothing (`--dry-run`). A stop or a conflict fails it. */
export function outcome(plan: Plan): Result
{
   const failed = 0 < plan.stops.length || plan.actions.some((action) => 'conflict' === action.kind);
   return { code: failed ? 1 : 0, lines: report(plan) };
}

/** The folders above each of `paths` (relative, with `/`), each once, deepest first. */
function foldersAbove(paths: string[]): string[]
{
   const folders = new Set<string>();
   for (const path of paths)
   {
      for (let dir = posix.dirname(path); '.' !== dir; dir = posix.dirname(dir)) { folders.add(dir); }
   }
   return [...folders].sort((a, b) => b.length - a.length);
}

/**
 * Writes every file the plan creates or updates and removes every file it removes, then the folders
 * those removals emptied (never a kept root), then the marker, then reports as `outcome` does. A
 * write that fails is named, ends the run with a failure code, and leaves the marker with the file's
 * old entry, or none.
 */
export function apply(plan: Plan, io: Io): Result
{
   const failures = new Map<string, string>();
   const attempt = (path: string, write: () => void) =>
   {
      try { write(); return true; }
      catch (error)
      {
         failures.set(path, error instanceof Error ? error.message : String(error));
         return false;
      }
   };

   const removed: string[] = [];
   for (const action of plan.actions)
   {
      const file = join(plan.target, action.path);
      if ('create' === action.kind || 'update' === action.kind)
      { attempt(action.path, () => io.write(file, action.data, action.executable)); }
      else if ('remove' === action.kind && attempt(action.path, () => io.remove(file)))
      { removed.push(action.path); }
   }
   for (const folder of foldersAbove(removed))
   {
      const path = join(plan.target, folder);
      if (!manifest.keep.includes(folder) && 'dir' === io.stat(path) && 0 === io.list(path).length)
      { attempt(folder, () => io.remove(path)); }
   }
   if (null !== plan.marker)
   {
      const files = { ...plan.marker.files };
      for (const path of failures.keys())
      {
         if (path in plan.marker.previous) { files[path] = plan.marker.previous[path]; }
         else { delete files[path]; }
      }
      const marker = { version: manifest.version, installedAt: io.now().toISOString(), files };
      attempt(manifest.marker, () => io.write(join(plan.target, manifest.marker), serialize(marker), false));
   }

   const done  = outcome(plan);
   const lines = [...done.lines, ...[...failures].map(([path, message]) => `failed ${path}: ${message}`)];
   return { code: 0 < failures.size ? 1 : done.code, lines };
}
