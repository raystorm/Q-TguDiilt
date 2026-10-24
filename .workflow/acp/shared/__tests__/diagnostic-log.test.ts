import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
   DIAGNOSTIC_LOG_MAX_BYTES, DIAGNOSTIC_MESSAGE_MAX_BYTES, createDiagnosticLog,
} from '../diagnostic-log.js';
import { REDACTED } from '../redact.js';
import { createLogger } from '../../protocol/__tests__/agent.helpers.js';
import { filesBeside, readRecords, useTempFolder, withZeroUmask } from './log-files.helpers.js';
import { LONG_SESSION_ID, SECRET_LINES } from './redaction.helpers.js';

const folderOf = useTempFolder();

const FAILURE    = { kind: 'exited', message: 'agent exited (exit code 1)', driver: 'kiro' };
const OWNER_ONLY = 0o600;

afterEach(() => { vi.restoreAllMocks(); });

const silenceStderr = () => vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
const warnings      = (logger: ReturnType<typeof createLogger>) => logger.entries.filter(e => 'warn' === e.level);
const modeOf        = (file: string): number => statSync(file).mode & 0o777;

/** A sink over a file in a folder that does not exist yet, with a recording service logger. */
function open(file = join(folderOf(), 'work', 'acp-diagnostic.log'), maxBytes?: number)
{
   const logger = createLogger();
   return { file, logger, sink: createDiagnosticLog({ filePath: file, logger, maxBytes }) };
}

/** The code and the message the system gives when `file` cannot be opened for appending. */
function failureOf(file: string): { code: string; message: string }
{
   try { openSync(file, 'a'); }
   catch (error) { return { code: (error as NodeJS.ErrnoException).code ?? '', message: (error as Error).message }; }
   return { code: '', message: '' };
}

describe('diagnostic log — records', () => {
   it('a record is one JSON line with the fixed fields and the fields given', () => {
      const { file, sink } = open();
      sink.record({ ...FAILURE, pid: 4242, agentSessionId: 'sess-1' });
      const [entry] = readRecords(file);
      expect(entry).toMatchObject({
         event: 'agent_failure', level: 'error', ...FAILURE, pid: 4242, agentSessionId: 'sess-1',
      });
      expect(typeof entry.ts).toBe('string');
      expect(Object.keys(entry).sort())
         .toEqual(['agentSessionId', 'driver', 'event', 'kind', 'level', 'message', 'pid', 'ts']);
   });

   it('the seam shows the path', () => {
      const { file, sink } = open();
      expect(sink.path).toBe(file);
   });

   it('two records are two lines, in order', () => {
      const { file, sink } = open();
      sink.record({ ...FAILURE, message: 'first one' });
      sink.record({ ...FAILURE, message: 'second one' });
      expect(readRecords(file).map(entry => entry.message)).toEqual(['first one', 'second one']);
   });

   it('[H] free text is redacted and ids and numbers are left alone', () => {
      const { file, sink } = open();
      sink.record({
         ...FAILURE, message: 'failed: token=abc123', tail: 'line\napi_key=abc',
         agentSessionId: LONG_SESSION_ID, pid: 4242,
      });
      const [entry] = readRecords(file);
      expect(entry.message).toBe(`failed: token=${REDACTED}`);
      expect(entry.tail).toBe(`line\napi_key=${REDACTED}`);
      expect(entry.agentSessionId).toBe(LONG_SESSION_ID);
      expect(entry.pid).toBe(4242);
   });

   it.each(SECRET_LINES)('[H] %s is removed from the message and the tail', (_label, line, secrets) => {
      const { file, sink } = open();
      const text           = `startup failed: ${line} (while starting)`;
      sink.record({ ...FAILURE, message: text, tail: text });
      const raw = readFileSync(file, 'utf8');
      for (const secret of secrets) { expect(raw).not.toContain(secret); }
      expect(readRecords(file)[0].message).toContain('(while starting)');
   });

   it('[H] a message of 1 MiB is cut, its beginning is kept, and the record stays under 16 KiB', () => {
      const { file, sink } = open();
      const message        = `start ${'lorem ipsum '.repeat(100_000)}`;
      sink.record({ ...FAILURE, message });
      const [entry] = readRecords(file);
      expect(Buffer.byteLength(readFileSync(file, 'utf8'))).toBeLessThan(16 * 1024);
      expect(entry.message.startsWith('start lorem ipsum')).toBe(true);
      expect(Buffer.byteLength(entry.message)).toBeLessThanOrEqual(DIAGNOSTIC_MESSAGE_MAX_BYTES + 64);
      expect(entry.message).not.toBe(message.slice(0, entry.message.length));   // a visible marker was added
      expect(message.length).toBeGreaterThan(1024 * 1024);                      // the caller's text is not cut
   });

   it('[H] record never throws, even for a record it cannot read', () => {
      const { sink }   = open();
      const unreadable = { ...FAILURE };
      Object.defineProperty(unreadable, 'pid', { enumerable: true, get() { throw new Error('boom'); } });
      expect(() => sink.record(unreadable)).not.toThrow();
   });
});

describe('diagnostic log — cap', () => {
   it('the default cap is 1 MiB', () => {
      expect(DIAGNOSTIC_LOG_MAX_BYTES).toBe(1024 * 1024);
   });

   it('[H] holds at 1 MiB with one rotated copy and no other file', () => {
      const { file, sink } = open();
      const tail           = 'word '.repeat(1200);
      for (let i = 0; i < 260; i++) { sink.record({ ...FAILURE, tail }); }
      expect(statSync(file).size).toBeLessThanOrEqual(DIAGNOSTIC_LOG_MAX_BYTES);
      expect(filesBeside(file)).toEqual(['acp-diagnostic.log', 'acp-diagnostic.log.1']);
      expect(statSync(file).size + statSync(`${file}.1`).size).toBeLessThan(2 * 1024 * 1024 + 7000);
   });
});

describe.skipIf('win32' === process.platform)('diagnostic log — file mode', () => {
   it('[H] the file is created owner-only in a folder that may not exist', () => {
      const opened = withZeroUmask(() => {
         const created = open();
         created.sink.record(FAILURE);
         return created;
      });
      expect(modeOf(opened.file)).toBe(OWNER_ONLY);
   });
});

describe('diagnostic log — start-up', () => {
   it('logs its path once', () => {
      const { file, logger } = open();
      expect(logger.entries.filter(e => file === e.data.path)).toHaveLength(1);
   });

   it('[H] a file that cannot be opened does not stop the service: no path, one warning by code, no stderr', () => {
      const file = join(folderOf(), 'acp-diagnostic.log');
      mkdirSync(file);
      const failure = failureOf(file);
      const stderr  = silenceStderr();
      let opened!: ReturnType<typeof open>;
      expect(() => { opened = open(file); }).not.toThrow();
      expect(opened.sink.path).toBeUndefined();
      expect(warnings(opened.logger)).toHaveLength(1);
      expect(Object.values(warnings(opened.logger)[0].data)).toEqual([failure.code]);
      expect(JSON.stringify(opened.logger.entries)).not.toContain(failure.message);
      expect(opened.logger.entries.filter(e => file === e.data.path)).toHaveLength(0);
      expect(stderr).not.toHaveBeenCalled();
   });

   it('an unusable sink writes nothing and says nothing more', () => {
      const file = join(folderOf(), 'acp-diagnostic.log');
      mkdirSync(file);
      const stderr           = silenceStderr();
      const { logger, sink } = open(file);
      expect(() => { sink.record(FAILURE); sink.record(FAILURE); sink.record(FAILURE); }).not.toThrow();
      expect(readdirSync(file)).toEqual([]);
      expect(warnings(logger)).toHaveLength(1);
      expect(stderr).not.toHaveBeenCalled();
   });

   it('a folder that cannot be created is the same', () => {
      writeFileSync(join(folderOf(), 'blocker'), 'x');
      const stderr           = silenceStderr();
      const { logger, sink } = open(join(folderOf(), 'blocker', 'acp-diagnostic.log'));
      expect(sink.path).toBeUndefined();
      expect(warnings(logger)).toHaveLength(1);
      expect(typeof Object.values(warnings(logger)[0].data)[0]).toBe('string');
      expect(stderr).not.toHaveBeenCalled();
   });
});

describe('diagnostic log — a later write failure', () => {
   it('[H] is logged once, by code only, and breaks nothing', () => {
      const { file, logger, sink } = open();
      sink.record(FAILURE);
      rmSync(file);
      mkdirSync(file);
      const failure = failureOf(file);
      const stderr  = silenceStderr();
      expect(() => { sink.record(FAILURE); sink.record(FAILURE); sink.record(FAILURE); }).not.toThrow();
      expect(warnings(logger)).toHaveLength(1);
      expect(Object.values(warnings(logger)[0].data)).toEqual([failure.code]);
      expect(JSON.stringify(logger.entries)).not.toContain(failure.message);
      expect(sink.path).toBe(file);
      expect(stderr).not.toHaveBeenCalled();
   });
});
