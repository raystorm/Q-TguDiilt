/**
 * Shared operational logger for the ACP package.
 *
 * Writes newline-delimited JSON (one event per line) to a single append-only
 * log file, mirroring the engine's `.amazonq/workflow.log` convention (here
 * `.workflow/work/acp.log`). Console output is deliberately avoided: an ACP
 * agent speaks JSON-RPC over stdout, so stray stdout writes corrupt the
 * protocol. If the log file cannot be written, entries fall back to stderr.
 *
 * Values are serialized with `JSON.stringify` (which escapes control
 * characters), so every event occupies exactly one physical JSONL line.
 * The serializer guards circular refs, orders object keys for stable diffs,
 * and renders errors with their cause chain. Every string value that holds
 * whitespace, and every rendered error, goes through `redact()`. Keys, `ts`,
 * `level`, `event`, numbers and single-token values are left alone.
 *
 * Optionally the file is created with a given mode and capped: a record that
 * would pass `maxBytes` first moves the file to `<filePath>.1`.
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { redact } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
   debug(event: string, data?: Record<string, unknown>): void;
   info(event: string, data?: Record<string, unknown>): void;
   warn(event: string, data?: Record<string, unknown>): void;
   error(event: string, data?: Record<string, unknown>): void;
}

interface PrintableError {
   message?: string;
   cause?:   unknown;
}

/** Renders an error, including its nested cause chain, to a single string. */
export function printErrorMessage(error: unknown, visited = new Set<unknown>()): string {
   if (error && 'object' === typeof error && 'message' in error) {
      if (visited.has(error)) { return '[Circular]'; }
      visited.add(error);
      const err = error as PrintableError;
      let message = err.message ? String(err.message) : 'Unknown Error';
      if (err.cause) { message += ` Caused By: ${printErrorMessage(err.cause, visited)}`; }
      return message;
   }
   if ('string' === typeof error) { return error; }
   return String(error);
}

/** The error's code (`EISDIR`, `ENOSPC`), or `'unknown'` when it has none. */
export function errorCode(error: unknown): string {
   const code = (error as { code?: unknown } | null | undefined)?.code;
   return 'string' === typeof code ? code : 'unknown';
}

/** Set by the writer itself, never redacted. */
const FIXED_FIELDS = new Set(['ts', 'level', 'event']);

/** Circular-safe, key-ordered JSON replacer; renders Errors and Dates, redacts free text. */
function safeOrderedReplacer() {
   const seen = new WeakSet<object>();
   let root: unknown;
   return function orderedReplacer(this: unknown, key: string, value: unknown): unknown {
      if (undefined === value) { return undefined; }
      if (value instanceof Error) { return redact(printErrorMessage(value)); }
      if (value instanceof Date)  { return value.toISOString(); }
      if ('string' === typeof value) {
         return /\s/.test(value) && !(this === root && FIXED_FIELDS.has(key)) ? redact(value) : value;
      }
      if (value && 'object' === typeof value) {
         if (seen.has(value as object)) { return '[Circular]'; }
         seen.add(value as object);
         if (!Array.isArray(value)) {
            const obj = value as Record<string, unknown>;
            const sorted = Object.keys(obj).sort().reduce((acc: Record<string, unknown>, k) => {
               acc[k] = obj[k];
               return acc;
            }, {});
            if ('' === key) { root = sorted; }
            return sorted;
         }
      }
      return value;
   };
}

export interface FileLoggerOptions {
   filePath:        string;
   /** Mode of the file when it is created. Default: the umask decides. */
   mode?:           number;
   /** With it, a record that would pass this size first moves the file to `<filePath>.1`. Default: no cap. */
   maxBytes?:       number;
   /** Called once, with the error code, when a write fails. With it nothing goes to stderr. */
   onWriteFailure?: (code: string) => void;
}

export function createFileLogger({ filePath, mode, maxBytes, onWriteFailure }: FileLoggerOptions): Logger {
   try { mkdirSync(dirname(filePath), { recursive: true }); }
   catch { /* directory may already exist; a real failure surfaces on write */ }
   let failureReported = false;

   /** Only a regular file rotates: a folder at the path stays a write failure. */
   function rotateIfFull(bytes: number): void {
      if (undefined === maxBytes) { return; }
      const stats = statSync(filePath, { throwIfNoEntry: false });
      if (stats?.isFile() && 0 < stats.size && stats.size + bytes > maxBytes) {
         renameSync(filePath, `${filePath}.1`);
      }
   }

   function write(level: LogLevel, event: string, data: Record<string, unknown> = {}): void {
      // JSON.stringify escapes control characters, so each event is guaranteed
      // to occupy exactly one physical JSONL line.
      const line = JSON.stringify(
         { ts: new Date().toISOString(), level, event, ...data },
         safeOrderedReplacer(),
      ) + '\n';
      try {
         rotateIfFull(Buffer.byteLength(line));
         appendFileSync(filePath, line, { mode });
      }
      catch (error) {
         if (undefined === onWriteFailure) { process.stderr.write(line); return; }
         if (failureReported) { return; }
         failureReported = true;
         try { onWriteFailure(errorCode(error)); }
         catch { /* a failing callback must not break logging */ }
      }
   }

   return {
      debug: (event, data) => write('debug', event, data),
      info:  (event, data) => write('info',  event, data),
      warn:  (event, data) => write('warn',  event, data),
      error: (event, data) => write('error', event, data),
   };
}
