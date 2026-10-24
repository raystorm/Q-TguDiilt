import { afterEach, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

/** A temp folder per test, removed afterwards. Returns a function that gives its path. */
export function useTempFolder(): () => string
{
   let dir = '';
   beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'log-test-')); });
   afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
   return () => dir;
}

/** The entries of a log file: one parsed JSON object per line. */
export function readRecords(file: string): any[]
{
   return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

/** The names in the folder of `file` that start with the file's name, sorted. */
export function filesBeside(file: string): string[]
{
   const name = basename(file);
   return readdirSync(dirname(file)).filter(entry => entry.startsWith(name)).sort();
}

/** Runs `run` with the umask at 0, so file modes do not depend on the machine. */
export function withZeroUmask<T>(run: () => T): T
{
   const previous = process.umask(0);
   try { return run(); }
   finally { process.umask(previous); }
}
