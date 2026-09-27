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
 * and renders errors with their cause chain.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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

/** Circular-safe, key-ordered JSON replacer; renders Errors and Dates. */
function safeOrderedReplacer() {
   const seen = new WeakSet<object>();
   return function orderedReplacer(_key: string, value: unknown): unknown {
      if (undefined === value) { return undefined; }
      if (value instanceof Error) { return printErrorMessage(value); }
      if (value instanceof Date)  { return value.toISOString(); }
      if (value && 'object' === typeof value) {
         if (seen.has(value as object)) { return '[Circular]'; }
         seen.add(value as object);
         if (!Array.isArray(value)) {
            const obj = value as Record<string, unknown>;
            return Object.keys(obj).sort().reduce((acc: Record<string, unknown>, k) => {
               acc[k] = obj[k];
               return acc;
            }, {});
         }
      }
      return value;
   };
}

export interface FileLoggerOptions {
   filePath: string;
}

export function createFileLogger({ filePath }: FileLoggerOptions): Logger {
   try { mkdirSync(dirname(filePath), { recursive: true }); }
   catch { /* directory may already exist; a real failure surfaces on write */ }

   function write(level: LogLevel, event: string, data: Record<string, unknown> = {}): void {
      // JSON.stringify escapes control characters, so each event is guaranteed
      // to occupy exactly one physical JSONL line.
      const line = JSON.stringify(
         { ts: new Date().toISOString(), level, event, ...data },
         safeOrderedReplacer(),
      ) + '\n';
      try { appendFileSync(filePath, line); }
      catch { process.stderr.write(line); }
   }

   return {
      debug: (event, data) => write('debug', event, data),
      info:  (event, data) => write('info',  event, data),
      warn:  (event, data) => write('warn',  event, data),
      error: (event, data) => write('error', event, data),
   };
}
