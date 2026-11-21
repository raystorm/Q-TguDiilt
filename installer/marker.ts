import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Io } from './io.js';
import { manifest } from './manifest.js';

/** What `.workflow/installed.json` holds: when the installer last wrote, and a hash per managed file. */
export interface Marker
{
   version:     string;
   installedAt: string;
   files:       Record<string, string>;
}

/** The hash of a file's bytes, as the marker records it. The mode is not part of it. */
export const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');

const isRecord = (value: unknown): value is Record<string, unknown> =>
   'object' === typeof value && null !== value && !Array.isArray(value);

/** A path the marker may hold: relative, with `/`, and no `.` or `..` segment. */
const isSafe = (path: string) =>
   '' !== path && !path.startsWith('/') && !path.includes('\\') && !/(^|\/)\.\.?(\/|$)/.test(path);

function isMarker(value: unknown): value is Marker
{
   return isRecord(value)
      && 'string' === typeof value.version && '' !== value.version
      && 'string' === typeof value.installedAt
      && isRecord(value.files)
      && Object.entries(value.files).every(([path, digest]) => isSafe(path) && 'string' === typeof digest);
}

/** The marker in the target: null when there is no file, `invalid` when it cannot be used. */
export function readMarker(io: Io, target: string): Marker | 'invalid' | null
{
   const file = io.read(join(target, manifest.marker));
   if (null === file) { return null; }
   try
   {
      const parsed: unknown = JSON.parse(file.data.toString('utf8'));
      return isMarker(parsed) ? parsed : 'invalid';
   }
   catch { return 'invalid'; }
}

/** The bytes of the marker file. */
export const serialize = (marker: Marker) => Buffer.from(`${JSON.stringify(marker, null, 2)}\n`);
