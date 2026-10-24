import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFileLogger, type FileLoggerOptions, type Logger } from '../logger.js';
import { filesBeside, readRecords, useTempFolder, withZeroUmask } from './log-files.helpers.js';

const folderOf = useTempFolder();
const fileOf   = () => join(folderOf(), 'test.log');
const rotated  = () => `${fileOf()}.1`;

const OWNER_ONLY = 0o600;
const CAP        = 1000;

/** The bytes one entry takes in the file with an empty padding. */
const ENTRY_OVERHEAD = Buffer.byteLength(
   `${JSON.stringify({ event: 'x', level: 'info', pad: '', ts: new Date().toISOString() })}\n`,
);

/** Writes one entry that takes exactly `bytes` bytes in the file. `mark` names it. */
function put(logger: Logger, bytes: number, mark = ''): void
{
   logger.info('x', { pad: `${mark}_`.padEnd(bytes - ENTRY_OVERHEAD, 'p') });
}

const marksIn = (file: string): string[] => readRecords(file).map(entry => entry.pad.split('_')[0]);
const sizeOf  = (file: string): number => statSync(file).size;
const modeOf  = (file: string): number => statSync(file).mode & 0o777;

/** A writer as the diagnostic log uses it: owner-only, with a small cap. */
const capped = (extra: Partial<FileLoggerOptions> = {}): Logger =>
   createFileLogger({ filePath: fileOf(), mode: OWNER_ONLY, maxBytes: CAP, ...extra });

const silenceStderr = () => vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

afterEach(() => { vi.restoreAllMocks(); });

describe('file logger — folder, cap and rotation', () => {
   it('creates a missing folder', () => {
      const file = join(folderOf(), 'a', 'b', 'test.log');
      createFileLogger({ filePath: file, maxBytes: CAP }).info('x', { n: 1 });
      expect(readRecords(file)).toHaveLength(1);
   });

   it('entries that fit stay in one file', () => {
      const logger = capped();
      for (let i = 0; i < 9; i++) { put(logger, 100, `r${i}`); }
      expect(sizeOf(fileOf())).toBe(900);
      expect(filesBeside(fileOf())).toEqual(['test.log']);
      expect(marksIn(fileOf())).toHaveLength(9);
   });

   it('[H] the record that would pass the cap rotates the file first, and the file never passes the cap', () => {
      const logger = capped();
      for (let i = 0; i < 9; i++) { put(logger, 100, `r${i}`); }
      put(logger, 200, 'new');
      expect(marksIn(rotated())).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8']);
      expect(marksIn(fileOf())).toEqual(['new']);
      for (let i = 0; i < 50; i++) {
         put(logger, 130, `s${i}`);
         expect(sizeOf(fileOf())).toBeLessThanOrEqual(CAP);
      }
   });

   it('a record that reaches the cap exactly does not rotate, the next one does', () => {
      const logger = capped();
      for (let i = 0; i < 8; i++) { put(logger, 100, `r${i}`); }
      put(logger, 200, 'exact');
      expect(sizeOf(fileOf())).toBe(CAP);
      expect(filesBeside(fileOf())).toEqual(['test.log']);
      put(logger, 100, 'next');
      expect(marksIn(fileOf())).toEqual(['next']);
      expect(marksIn(rotated())).toHaveLength(9);
   });

   it('[H] only the current file and one rotated copy exist', () => {
      const logger = capped();
      for (let i = 1; i <= 10; i++) { put(logger, 300, `r${i}`); }
      expect(filesBeside(fileOf())).toEqual(['test.log', 'test.log.1']);
      expect(marksIn(rotated())).toEqual(['r7', 'r8', 'r9']);
      expect(marksIn(fileOf())).toEqual(['r10']);
   });

   it('[H] the size of an existing file counts', () => {
      put(capped(), 990, 'old');
      put(capped(), 100, 'new');
      expect(sizeOf(rotated())).toBe(990);
      expect(marksIn(fileOf())).toEqual(['new']);
   });

   it('a file already over the cap is rotated at the first record', () => {
      writeFileSync(fileOf(), `${'z'.repeat(2999)}\n`);
      put(capped(), 100, 'new');
      expect(sizeOf(rotated())).toBe(3000);
      expect(marksIn(fileOf())).toEqual(['new']);
   });

   it('a record larger than the cap is kept, after a rotation, and does not loop', () => {
      const logger = capped();
      put(logger, 100, 'r0');
      put(logger, 100, 'r1');
      put(logger, 3000, 'big');
      expect(marksIn(rotated())).toEqual(['r0', 'r1']);
      expect(marksIn(fileOf())).toEqual(['big']);
      put(logger, 100, 'after');
      expect(marksIn(rotated())).toEqual(['big']);
      expect(filesBeside(fileOf())).toEqual(['test.log', 'test.log.1']);
   });

   it('[H] a rotation that fails is a write failure: reported once, not to stderr, nothing thrown', () => {
      mkdirSync(rotated());
      writeFileSync(join(rotated(), 'keep'), 'k');
      const onWriteFailure = vi.fn();
      const stderr         = silenceStderr();
      const logger         = capped({ onWriteFailure });
      put(logger, 900, 'full');
      expect(() => { put(logger, 200, 'a'); put(logger, 200, 'b'); }).not.toThrow();
      expect(onWriteFailure).toHaveBeenCalledTimes(1);
      expect(onWriteFailure).toHaveBeenCalledWith(expect.any(String));
      expect(stderr).not.toHaveBeenCalled();
   });
});

describe('file logger — write failures', () => {
   it('[H] with onWriteFailure a failing write is reported once, as the error code, and not to stderr', () => {
      mkdirSync(fileOf());
      const onWriteFailure = vi.fn();
      const stderr         = silenceStderr();
      const logger         = capped({ onWriteFailure });
      expect(() => { put(logger, 100); put(logger, 100); put(logger, 100); }).not.toThrow();
      expect(onWriteFailure).toHaveBeenCalledTimes(1);
      expect(onWriteFailure).toHaveBeenCalledWith('EISDIR');
      expect(stderr).not.toHaveBeenCalled();
   });

   it('the service log keeps its stderr fallback', () => {
      mkdirSync(fileOf());
      const stderr = silenceStderr();
      const logger = createFileLogger({ filePath: fileOf() });
      expect(() => logger.info('x', { n: 1 })).not.toThrow();
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('"event":"x"'));
   });
});

describe('file logger — defaults of the service log', () => {
   it('has no cap and no rotation', () => {
      const logger = createFileLogger({ filePath: fileOf() });
      for (let i = 0; i < 2000; i++) { put(logger, 1100); }
      expect(sizeOf(fileOf())).toBeGreaterThan(1024 * 1024);
      expect(filesBeside(fileOf())).toEqual(['test.log']);
   });
});

describe.skipIf('win32' === process.platform)('file logger — file mode', () => {
   it('[H] creates the file owner-only, whatever the umask', () => {
      withZeroUmask(() => { put(capped(), 100); });
      expect(modeOf(fileOf())).toBe(OWNER_ONLY);
   });

   it('the rotated copy and the new file are owner-only too', () => {
      withZeroUmask(() => {
         const logger = capped();
         put(logger, 600, 'a');
         put(logger, 600, 'b');
      });
      expect(modeOf(rotated())).toBe(OWNER_ONLY);
      expect(modeOf(fileOf())).toBe(OWNER_ONLY);
   });

   it('forces no mode when none is given', () => {
      withZeroUmask(() => { put(createFileLogger({ filePath: fileOf() }), 100); });
      expect(modeOf(fileOf())).toBe(0o666);
   });
});
