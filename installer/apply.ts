import { join, posix } from 'node:path';
import type { Io } from './io.js';
import type { Ran } from './io.js';
import { manifest } from './manifest.js';
import { serialize } from './marker.js';
import type { Action, ActionKind, Install, Plan } from './plan.js';
import { writeRegistration } from './register.js';

/** What a run prints and the code it ends with. */
export interface Result
{
   code:  number;
   lines: string[];
   /** Where the run installs and registers, printed above `lines`; absent when the command line is refused. */
   where?: string[];
}

const label = (action: Action) => `${action.kind} ${action.path}${action.forced ? ' (forced)' : ''}`;

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The order actions are printed in: what needs attention first, then what is done. Skips are not printed. */
const KINDS: ActionKind[] = ['conflict', 'update', 'create', 'remove'];
const byKind = (a: Listed, b: Listed) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || byPath(a, b);

/** A line that sets the marker apart from the grouped actions: as wide as the widest status, `conflict`. */
const SEPARATOR = '--------';

/**
 * One thing a run does, as printed: `kind` and `path` give its place in the list, `lines` is what is
 * printed.
 */
interface Listed
{
   kind:  ActionKind;
   path:  string;
   lines: string[];
}

/** What a run does that is not a skip: the files, and the registration with a line for its entry. */
function listed(plan: Plan): Listed[]
{
   const items: Listed[] = plan.actions
      .filter((action) => 'skip' !== action.kind)
      .map((action) => ({ kind: action.kind, path: action.path, lines: [label(action)] }));
   const { registration } = plan;
   if (null !== registration && 'skip' !== registration.kind)
   {
      const { path, key, command, args, added } = registration;
      const [quotedKey, quotedCommand, quotedArgs] = [key, command, args].map((part) => JSON.stringify(part));
      const entry = `   ${added ? 'add' : 'update'} key ${quotedKey} command ${quotedCommand} args ${quotedArgs}`;
      items.push({ kind: registration.kind, path, lines: [`${registration.kind} ${path}`, entry] });
   }
   return items;
}

const commandOf = (install: Install) => [install.command, ...install.args].join(' ');

/** What a real run prints for the `npm ci` it ran: one result line, and on failure the last 20 lines. */
function installLines(install: Install, ran: Ran): string[]
{
   if (0 === ran.status) { return [`done ${commandOf(install)}`]; }
   const why  = null === ran.status ? `${install.command} could not be run` : `status ${ran.status}`;
   const tail = ran.output.split('\n').filter((line) => '' !== line.trim()).slice(-20);
   return [`failed ${commandOf(install)}: ${why}`, ...tail.map((line) => `   ${line}`)];
}

/**
 * What a run prints: the stops, the warnings by path, the notes, then each action that is not a skip,
 * grouped by kind (conflicts, updates, creates, removes) and by path within a kind (the registration is
 * one of them, followed by its entry), then a separator line and the marker. A run with nothing to
 * write ends with `nothing to write`.
 */
function report(plan: Plan): string[]
{
   const lines = [
      ...plan.stops.map((stop) => `stop: ${stop.detail}`),
      ...[...plan.warnings].sort(byPath).map((warning) => `warning ${warning.path}: ${warning.detail}`),
      ...plan.notes.map((note) => `note: ${note}`),
      ...listed(plan).sort(byKind).flatMap((item) => item.lines),
      ...(null === plan.install ? [] : [`run ${commandOf(plan.install)} in ${plan.install.cwd}`]),
   ];
   if (null !== plan.marker)
   {
      lines.push(...(0 < lines.length ? [SEPARATOR] : []), `${plan.marker.kind} ${manifest.marker}`);
   }
   const idle = 0 === plan.stops.length && null === plan.marker
      && plan.actions.every((action) => 'skip' === action.kind)
      && (null === plan.registration || 'skip' === plan.registration.kind)
      && null === plan.install;
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
 * those removals emptied (never a kept root), then the marker, then the registration (not when the
 * launcher could not be written), then reports as `outcome` does. A write that fails is named, ends
 * the run with a failure code, and leaves the marker with the file's old entry, or none.
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
   const { registration } = plan;
   if (null !== registration && 'skip' !== registration.kind && !failures.has(manifest.launcher))
   { attempt(registration.path, () => writeRegistration(io, registration)); }

   const ran   = null === plan.install ? null : io.run(plan.install.command, plan.install.args, plan.install.cwd);
   // npm can stop before it clears node_modules, which leaves the old install's hidden lockfile.
   // Removing it makes the next run run npm ci again.
   const hidden = join(plan.target, manifest.install.done);
   if (null !== ran && 0 !== ran.status && null !== io.stat(hidden))
   { attempt(manifest.install.done, () => io.remove(hidden)); }
   const done  = outcome(plan);
   const lines = [
      ...done.lines,
      ...[...failures].map(([path, message]) => `failed ${path}: ${message}`),
      ...(null === plan.install || null === ran ? [] : installLines(plan.install, ran)),
   ];
   const failed = 0 < failures.size || (null !== ran && 0 !== ran.status);
   return { code: failed ? 1 : done.code, lines };
}
