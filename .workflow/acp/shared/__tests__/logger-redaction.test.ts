import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFileLogger, type LogLevel } from '../logger.js';
import { REDACTED, redact } from '../redact.js';
import { readRecords, useTempFolder } from './log-files.helpers.js';
import { LONG_SESSION_ID, SECRET_LINES } from './redaction.helpers.js';

const folderOf = useTempFolder();
const fileOf   = () => join(folderOf(), 'test.log');

/** Writes one entry through a fresh file logger and returns it as read back. */
function written(level: LogLevel, data: Record<string, unknown>, event = 'x'): any
{
   createFileLogger({ filePath: fileOf() })[level](event, data);
   return readRecords(fileOf())[0];
}

describe('file logger — free text redaction', () => {
   it('removes the secret and keeps the rest of the line', () => {
      const entry = written('error', { reason: 'login failed: api_key=abc123 (retrying)' });
      expect(entry.reason).toBe(`login failed: api_key=${REDACTED} (retrying)`);
   });

   it('[H] a line break alone makes a value free text', () => {
      expect(written('error', { reason: 'step\ntoken=abc123' }).reason).toBe(`step\ntoken=${REDACTED}`);
   });

   it.each(SECRET_LINES)('[H] %s is removed from free text and the rest of the line is kept',
      (_label, line, secrets) => {
         written('error', { reason: `startup failed: ${line} (while starting)` });
         const text = readFileSync(fileOf(), 'utf8');
         for (const secret of secrets) { expect(text).not.toContain(secret); }
         const { reason } = readRecords(fileOf())[0];
         expect(reason).toContain('startup failed:');
         expect(reason).toContain('(while starting)');
      });

   it.each([
      ['a long session id',              LONG_SESSION_ID],
      ['a longer hex id',                'a3f5c7e9b1d2a3f5c7e9b1d2a3f5c7e9b1d2a3f5'],
      ['a path with a long folder name', '/srv/data/abc123def456ghi789jkl012mno345pqr/acp-diagnostic.log'],
      ['a kind',                         'preferred_unavailable'],
      ['a name',                         'kiro'],
   ])('[H] %s is a single token and is written unchanged', (_label, value) => {
      expect(written('info', { value }).value).toBe(value);
   });

   it('the long id fixture is what redact() would replace', () => {
      expect(redact(LONG_SESSION_ID)).toBe(REDACTED);
   });

   it('free text with no secret is unchanged', () => {
      const data = { a: 'module not found', b: '/tmp/a b/c', c: 'line1\nline2\r\nline3' };
      const { a, b, c } = written('info', data);
      expect({ a, b, c }).toEqual(data);
   });

   it('[H] strings inside nested objects and lists are redacted', () => {
      const entry = written('info', { detail: { text: 'a token=abc123' }, list: ['ok', 'b key=abc123'] });
      expect(entry.detail.text).toBe(`a token=${REDACTED}`);
      expect(entry.list).toEqual(['ok', `b key=${REDACTED}`]);
   });

   it('values that are not strings are unchanged', () => {
      const entry = written('info', { pid: 4242, ok: true, none: null, gone: undefined });
      expect(entry).toMatchObject({ pid: 4242, ok: true, none: null });
      expect(entry).not.toHaveProperty('gone');
   });

   it.each([
      'login failed: api_key=[redacted] (retrying)',
      'Bearer [redacted] sent',
   ])('redaction is idempotent: %s', text => {
      expect(written('info', { value: text }).value).toBe(text);
   });

   it('[H] names, ts, level and event are never redacted', () => {
      const entry = written('info', { 'token=abc123 y': 'a', tokens: 12 }, 'login api_key=abc123');
      expect(entry.event).toBe('login api_key=abc123');
      expect(entry['token=abc123 y']).toBe('a');
      expect(entry.tokens).toBe(12);
      expect(entry.level).toBe('info');
      expect(typeof entry.ts).toBe('string');
   });

   it.each(['debug', 'info', 'warn', 'error'] as const)('%s redacts too', level => {
      expect(written(level, { reason: 'a token=abc123' }).reason).toBe(`a token=${REDACTED}`);
   });

   it('a redacted multi-line value is still one physical line', () => {
      written('error', { reason: 'step one\nstep two\r\ntoken=abc123' });
      const lines = readFileSync(fileOf(), 'utf8').split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).reason).toBe(`step one\nstep two\r\ntoken=${REDACTED}`);
   });

   it.each([
      ['a tab',                '\t'],
      ['a non-breaking space', '\u00a0'],
   ])('%s makes a value free text', (_label, space) => {
      expect(written('info', { reason: `key${space}abc123` }).reason).toBe(`key${space}${REDACTED}`);
   });

   it.each(['\t', ' ', '\n'])('a value of whitespace only (%j) is written unchanged', blank => {
      expect(written('info', { value: blank }).value).toBe(blank);
   });
});

describe('file logger — error values', () => {
   it('an error is rendered as text and redacted', () => {
      expect(written('error', { err: new Error('boom token=abc123') }).err).toBe(`boom token=${REDACTED}`);
   });

   it('[H] an error nested in an object or in a list is redacted too', () => {
      const entry = written('error', {
         detail: { err: new Error('a token=abc123') },
         list:   [new Error('b key=abc123')],
      });
      expect(entry.detail.err).toBe(`a token=${REDACTED}`);
      expect(entry.list).toEqual([`b key=${REDACTED}`]);
   });

   it('[H] a secret in a nested cause is redacted', () => {
      const err  = new Error('outer', { cause: new Error('inner api_key=abc123') });
      const text = written('error', { err }).err;
      expect(text).toContain('outer');
      expect(text).toContain(`inner api_key=${REDACTED}`);
      expect(text).not.toContain('abc123');
   });

   it('a circular cause chain stays safe', () => {
      const a: any = new Error('a token=abc123');
      const b: any = new Error('b');
      a.cause = b;
      b.cause = a;
      const text = written('error', { err: a }).err;
      expect(text).toContain('[Circular]');
      expect(text).not.toContain('abc123');
   });
});
