import {
   chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, statSync, unlinkSync,
   writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';

/** What a path is. A link or a device is `other`: the installer neither follows nor copies it. */
export type EntryKind = 'file' | 'dir' | 'other';

/** One entry of a folder. */
export interface Entry
{
   name: string;
   kind: EntryKind;
}

/** The bytes of a file and whether it is executable. */
export interface Contents
{
   data:       Buffer;
   executable: boolean;
}

/**
 * Everything the installer needs from the machine, in one place, so a test can watch it. Paths are
 * absolute, with the platform's separator. There is no network.
 */
export interface Io
{
   /** The file's contents; null when there is no such file. */
   read(path: string): Contents | null;
   /** The entries of a folder; none when there is no such folder. */
   list(path: string): Entry[];
   /** What the path is; null when nothing is there. */
   stat(path: string): EntryKind | null;
   /** Writes a file, makes its folders, and sets its executable bit. */
   write(path: string, data: Buffer, executable: boolean): void;
   /** Removes a file, or an empty folder. */
   remove(path: string): void;
   /** The path with links, `..` and a trailing slash resolved; the path itself when nothing is there. */
   realPath(path: string): string;
   /** The time of the run. */
   now(): Date;
   /** The user's home folder. The installer writes nothing there. */
   home: string;
}

const kindOf = (item: { isFile(): boolean; isDirectory(): boolean }): EntryKind =>
   (item.isFile() ? 'file' : item.isDirectory() ? 'dir' : 'other');

/** A path that is not there, or that has a file where a folder should be. */
const absent = (error: unknown) =>
   ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '');

/** What `look` returns, or null when the path is not there; any other failure is thrown. */
function orNull<T>(look: () => T): T | null
{
   try { return look(); }
   catch (error)
   {
      if (absent(error)) { return null; }
      throw error;
   }
}

/** The real machine. */
export function realIo(): Io
{
   return {
      read:     (path) => orNull(() => ({
         data:       readFileSync(path),
         executable: 0 !== (statSync(path).mode & 0o111),
      })),
      list:     (path) => orNull(() => readdirSync(path, { withFileTypes: true }))
                             ?.map((entry) => ({ name: entry.name, kind: kindOf(entry) })) ?? [],
      stat:     (path) => orNull(() => kindOf(statSync(path))),
      write:    (path, data, executable) =>
      {
         mkdirSync(dirname(path), { recursive: true });
         writeFileSync(path, data);
         chmodSync(path, executable ? 0o755 : 0o644);
      },
      remove:   (path) =>
      {
         if (lstatSync(path).isDirectory()) { rmdirSync(path); }
         else { unlinkSync(path); }
      },
      realPath: (path) => orNull(() => realpathSync(path)) ?? path,
      now:      () => new Date(),
      home:     homedir(),
   };
}
