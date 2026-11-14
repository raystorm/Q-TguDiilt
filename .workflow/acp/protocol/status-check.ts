/**
 * The check before the automated changeover process moves: the profile's status file says it is
 * ready for the changeover it suggested, or, at the end of a side trip, that it is complete.
 * Freshness is the file's modification time against the start of the turn, never its text. The
 * prose of the turn only triggers the read; a file never causes a handoff by itself. Reads
 * only. Never throws.
 */
import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { errorCode } from '../shared/logger.js';
import type { ProfileNames } from './workflow-command.js';

/** The most bytes of a status file that are read. A larger file is invalid; a real one is about 200. */
export const STATUS_MAX_BYTES = 16384;

export type StatusOutcome =
   'confirmed' | 'missing' | 'stale' | 'ambiguous' | 'invalid' | 'not_ready' | 'mismatch';

/** What the file must say: `ready` for a `handoff` or a `send`, or `complete` with no `next` for `end`. */
export type StatusCommand = 'handoff' | 'send' | 'end';

export interface StatusCheck {
   outcome:      StatusOutcome;
   /** The code (`ENOTDIR`, `EISDIR`, ...) of a read that failed for a reason other than "not there". */
   failureCode?: string;
}

const failed = (outcome: StatusOutcome, error: unknown): StatusCheck =>
   ({ outcome, failureCode: errorCode(error) });

const isObject = (value: unknown): value is Record<string, unknown> =>
   'object' === typeof value && null !== value && !Array.isArray(value);

const isFilled = (value: unknown): value is string => 'string' === typeof value && '' !== value;

/** The text of `file`, or undefined when it is larger than `STATUS_MAX_BYTES`. Reads no further. */
function readBounded(file: string): string | undefined
{
   const fd = openSync(file, 'r');
   try {
      const buffer = Buffer.alloc(STATUS_MAX_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
         const read = readSync(fd, buffer, length, buffer.length - length, null);
         if (0 === read) { break; }
         length += read;
      }
      return STATUS_MAX_BYTES < length ? undefined : buffer.toString('utf8', 0, length);
   }
   finally { closeSync(fd); }
}

/**
 * Checks the status files in `dir` (the full path of the folder) for the session's canonical
 * `profile`. Only names that start with `<profile>-` and end with `.json`, as written, count.
 * `startedAt` is epoch milliseconds; `command` is what the file must say (see `StatusCommand`);
 * `expected` is the canonical profile the `**Next**` line named, and `end` ignores it.
 * The first step that applies is the result: no folder or no file `missing`; none at or after
 * `startedAt` `stale`; several `ambiguous`; a file that is too large, unreadable, not a JSON
 * object, of another schema or profile, or (for a handoff or a send) `ready` without a
 * `next.command` and `next.to` `invalid`; for a handoff or a send, a status but `ready`
 * `not_ready`, and a `next` that is not `command` to `expected` `mismatch`; for `end`, a status
 * but `complete` `not_ready`, and any `next` `mismatch`; else `confirmed`. No field but those is
 * read, and no value is run or used as a path. `failureCode` is set only for an error that is not
 * "not there".
 */
export function checkStatus(
   { dir, profile, startedAt, names, command, expected }:
      {
         dir: string; profile: string; startedAt: number; names: ProfileNames; command: StatusCommand;
         expected: string;
      },
): StatusCheck
{
   let listed: string[];
   try { listed = readdirSync(dir); }
   catch (error) { return 'ENOENT' === errorCode(error) ? { outcome: 'missing' } : failed('missing', error); }

   const fresh: string[] = [];
   let present = 0;
   for (const name of listed) {
      if (!name.startsWith(`${profile}-`) || !name.endsWith('.json')) { continue; }
      try {
         const { mtimeMs } = statSync(join(dir, name));
         present++;
         if (startedAt <= mtimeMs) { fresh.push(name); }
      }
      catch (error) {
         if ('ENOENT' !== errorCode(error)) { return failed('invalid', error); }
      }
   }
   if (0 === present) { return { outcome: 'missing' }; }
   if (0 === fresh.length) { return { outcome: 'stale' }; }
   if (1 < fresh.length) { return { outcome: 'ambiguous' }; }

   let parsed: unknown;
   try {
      const text = readBounded(join(dir, fresh[0]));
      if (undefined === text) { return { outcome: 'invalid' }; }
      parsed = JSON.parse(text);
   }
   catch (error) {
      return error instanceof SyntaxError ? { outcome: 'invalid' } : failed('invalid', error);
   }

   if (!isObject(parsed) || 1 !== parsed.schema || profile !== parsed.profile) { return { outcome: 'invalid' }; }

   if ('end' === command) {
      // The profile is done when it says so and created no changeover: `next` is omitted.
      if ('complete' !== parsed.status) { return { outcome: 'not_ready' }; }
      return undefined === parsed.next ? { outcome: 'confirmed' } : { outcome: 'mismatch' };
   }

   // Only a `ready` file needs a usable `next`; any other status is `not_ready` whatever `next` holds.
   if ('ready' !== parsed.status) { return { outcome: 'not_ready' }; }
   const next = parsed.next;
   if (!isObject(next) || !isFilled(next.command) || !isFilled(next.to)) { return { outcome: 'invalid' }; }

   return command !== next.command || names.resolve(next.to) !== expected
      ? { outcome: 'mismatch' }
      : { outcome: 'confirmed' };
}
