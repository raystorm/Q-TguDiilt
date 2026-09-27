import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileLogger, printErrorMessage } from '../logger.js';

let logPath: string;

beforeEach(() => {
   logPath = join(tmpdir(), `acp-log-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
});

afterEach(() => {
   if (existsSync(logPath)) { rmSync(logPath); }
});

function readLines(): any[] {
   return readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

describe('file logger — JSONL output', () => {
   it('writes one JSON line per event with level, event, and data', () => {
      const logger = createFileLogger({ filePath: logPath });
      logger.info('session_mapped', { sessionId: 's1', workflowId: 'wf1' });
      const [entry] = readLines();
      expect(entry.level).toBe('info');
      expect(entry.event).toBe('session_mapped');
      expect(entry.sessionId).toBe('s1');
      expect(entry.workflowId).toBe('wf1');
      expect(typeof entry.ts).toBe('string');
   });

   it('records each severity with the matching level', () => {
      const logger = createFileLogger({ filePath: logPath });
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');
      const levels = readLines().map(l => l.level);
      expect(levels).toEqual(['debug', 'info', 'warn', 'error']);
   });

   it('appends across multiple calls', () => {
      const logger = createFileLogger({ filePath: logPath });
      logger.info('a');
      logger.info('b');
      expect(readLines()).toHaveLength(2);
   });
});

describe('file logger — line integrity', () => {
   it('keeps a multi-line value on a single physical JSONL line', () => {
      const logger = createFileLogger({ filePath: logPath });
      logger.info('multiline', { note: 'line1\nline2\r\nline3' });
      const lines = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
      // JSON.stringify escapes control chars, so a multi-line value stays a
      // single physical JSONL line while its content round-trips intact.
      expect(lines).toHaveLength(1);
      expect(readLines()[0].note).toBe('line1\nline2\r\nline3');
   });

   it('guards circular references', () => {
      const logger = createFileLogger({ filePath: logPath });
      const circular: any = { name: 'root' };
      circular.self = circular;
      expect(() => logger.info('circular', { circular })).not.toThrow();
      expect(readLines()).toHaveLength(1);
   });
});

describe('printErrorMessage', () => {
   it('renders an error message', () => {
      expect(printErrorMessage(new Error('boom'))).toContain('boom');
   });

   it('renders a nested cause chain', () => {
      const err = new Error('outer', { cause: new Error('inner') });
      const msg = printErrorMessage(err);
      expect(msg).toContain('outer');
      expect(msg).toContain('inner');
   });

   it('guards a circular cause chain', () => {
      const a: any = new Error('a');
      const b: any = new Error('b');
      a.cause = b;
      b.cause = a;
      expect(() => printErrorMessage(a)).not.toThrow();
   });
});
