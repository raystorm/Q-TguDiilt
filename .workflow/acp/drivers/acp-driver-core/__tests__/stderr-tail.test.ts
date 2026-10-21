import { describe, it, expect } from 'vitest';
import { STDERR_TAIL_MAX_BYTES, STDERR_TAIL_MAX_LINES, createStderrTail, withTail } from '../stderr-tail.js';

describe('stderr tail', () => {
   it('nothing printed is an empty tail', () => {
      expect(createStderrTail().tail()).toBe('');
   });

   it('a trailing newline does not make an extra line', () => {
      const tail = createStderrTail();
      tail.add('a\nb\n');
      expect(tail.tail()).toBe('a\nb');
   });

   it('1 MB in 50,000 lines is cut to the line limit and keeps the end, not the start', () => {
      const lines = Array.from({ length: 50000 }, (_, i) => `line ${String(i).padStart(5, '0')} xxxxxxxx`);
      const tail  = createStderrTail();
      tail.add(`${lines.join('\n')}\n`);
      const kept = tail.tail().split('\n');
      expect(kept).toHaveLength(STDERR_TAIL_MAX_LINES);
      expect(kept[kept.length - 1]).toBe(lines[49999]);
      expect(kept[0]).toBe(lines[50000 - STDERR_TAIL_MAX_LINES]);
   });

   it('long lines are cut to the byte limit, at a line start', () => {
      const lines = Array.from({ length: 100 }, (_, i) => `${String(i).padStart(3, '0')} ${'y'.repeat(96)}`);
      const tail  = createStderrTail();
      tail.add(lines.join('\n'));
      const out = tail.tail();
      expect(Buffer.byteLength(out)).toBeLessThanOrEqual(STDERR_TAIL_MAX_BYTES);
      expect(out.split('\n').every(line => lines.includes(line))).toBe(true);
      expect(out.endsWith(lines[99])).toBe(true);
   });

   it('multi-byte text is never cut inside a character', () => {
      const lines = Array.from({ length: 20 }, () => '\u20ac'.repeat(1000));
      const tail  = createStderrTail();
      tail.add(lines.join('\n'));
      const out = tail.tail();
      expect(Buffer.byteLength(out)).toBeLessThanOrEqual(STDERR_TAIL_MAX_BYTES);
      expect(out).not.toContain('\uFFFD');
   });

   it('one line longer than the byte limit keeps its end', () => {
      const tail = createStderrTail();
      tail.add(`${'a'.repeat(20000)}END`);
      const out = tail.tail();
      expect(Buffer.byteLength(out)).toBeLessThanOrEqual(STDERR_TAIL_MAX_BYTES);
      expect(out.endsWith('END')).toBe(true);
   });

   it('[H] a secret split across chunks is still redacted', () => {
      const tail = createStderrTail();
      tail.add('Authorization: Bear');
      tail.add('er abc123def456\n');
      expect(tail.tail()).not.toContain('abc123def456');
      expect(tail.tail()).toContain('Authorization:');
   });

   it('[H] a secret on a line the byte limit cuts away is gone', () => {
      const tail = createStderrTail();
      const filler = Array.from({ length: 100 }, () => 'z'.repeat(60)).join('\n');
      tail.add(`api_key=SECRETSECRET1234\n${filler}\n`);
      expect(tail.tail()).not.toContain('SECRET');
   });
});

describe('withTail', () => {
   it('is the summary alone when the agent printed nothing', () => {
      expect(withTail('it failed', '')).toBe('it failed');
   });

   it('adds the tail under the summary, with the warning that redaction is not a guarantee', () => {
      const out = withTail('it failed', 'line one\nline two');
      expect(out.startsWith('it failed\n')).toBe(true);
      expect(out).toContain('not guaranteed');
      expect(out.endsWith('line one\nline two')).toBe(true);
   });
});
