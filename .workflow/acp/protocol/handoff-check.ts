/**
 * The check before `@start`: the changeover file is there, was written during this handoff, and
 * names a profile the service knows. Freshness is the file's modification time against the start
 * of the handoff turn, never its text. Never throws.
 */
import { statSync } from 'node:fs';
import { readChangeoverTarget, type ProfileNames } from './workflow-command.js';

export type HandoffCheck =
   | { ok: true; target: string }
   | { ok: false; word?: string };

/**
 * Checks `file` (a full path), in this order: modified at or after `startedAt` (epoch
 * milliseconds); `## To` has a target; the target resolves through `names`, else the result
 * carries the name as written; when `expected` (a profile name or alias) is given, it names the
 * same profile. A stale, missing or unreadable file gives `{ ok: false }` with no name.
 */
export function checkHandoff(
   { file, startedAt, names, expected }:
      { file: string; startedAt: number; names: ProfileNames; expected?: string },
): HandoffCheck
{
   try { if (startedAt > statSync(file).mtimeMs) { return { ok: false }; } }
   catch { return { ok: false }; }

   const written = readChangeoverTarget(file);
   if (undefined === written) { return { ok: false }; }

   const target = names.resolve(written);
   if (undefined === target) { return { ok: false, word: written }; }
   if (undefined !== expected && names.resolve(expected) !== target) { return { ok: false }; }
   return { ok: true, target };
}
