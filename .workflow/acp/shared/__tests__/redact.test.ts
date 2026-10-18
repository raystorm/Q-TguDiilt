import { describe, it, expect } from 'vitest';
import { LONG_RUN_MIN_LENGTH, REDACTED, SPACED_VALUE_MIN_LENGTH, redact } from '../redact.js';

describe('redaction', () => {
   it('replaces the value and keeps the rest of the line', () => {
      expect(redact('login failed: api_key=abc123 (retrying)')).toBe(`login failed: api_key=${REDACTED} (retrying)`);
   });

   it.each([
      ['equals',          'token=abc',   `token=${REDACTED}`],
      ['equals, spaced',  'token = abc', `token = ${REDACTED}`],
      ['colon',           'token: abc',  `token: ${REDACTED}`],
      ['colon, no space', 'token:abc',   `token:${REDACTED}`],
      ['space',           'token abc123', `token ${REDACTED}`],
   ])('every secret word takes %s before its value', (_label, text, expected) => {
      for (const word of ['token', 'tokens', 'key', 'keys', 'credential', 'credentials', 'security', 'securities', 'KEY', 'Api-Key']) {
         expect(redact(text.replace('token', word))).toBe(expected.replace('token', word));
      }
   });

   it('after a plain space only a value that looks like a secret is replaced', () => {
      expect(redact('ssh key abc123')).toBe(`ssh key ${REDACTED}`);
      expect(redact('ssh key abcdef')).toBe('ssh key abcdef');
      expect(redact(`key ${'1'.repeat(SPACED_VALUE_MIN_LENGTH)}`)).toBe(`key ${REDACTED}`);
      expect(redact(`key ${'1'.repeat(SPACED_VALUE_MIN_LENGTH - 1)}`)).toBe(`key ${'1'.repeat(SPACED_VALUE_MIN_LENGTH - 1)}`);
   });

   it.each([
      'You are not logged in, please log in with kiro-cli login',
      'keyboard layout not found',
      'monkey patch applied',
      'press any key to continue',
      'the security of the build is unaffected',
      'tokenizer ready',
      'listening on 127.0.0.1:8080',
      'ThisIsAVeryLongCamelCaseIdentifierNameThatKeepsGoing',
   ])('leaves ordinary text alone: %s', text => {
      expect(redact(text)).toBe(text);
   });

   it('a tab or another blank counts as a space, a line break does not', () => {
      expect(redact('key\tabc123')).toBe(`key\t${REDACTED}`);
      expect(redact('key\u00a0abc123')).toBe(`key\u00a0${REDACTED}`);
      expect(redact('key:\nabc123')).toBe('key:\nabc123');
   });

   it('a value runs to the next space, so the text after it stays', () => {
      expect(redact('token=abc, then more')).toBe(`token=${REDACTED} then more`);
   });

   it('a value does not run on into the next line', () => {
      expect(redact('key\nabc12345')).toBe('key\nabc12345');
   });

   it('a long hex or base64 run is replaced from the minimum length, and only with a digit and a letter', () => {
      const run = (length: number) => 'a1'.repeat(length).slice(0, length);
      expect(redact(`id ${run(LONG_RUN_MIN_LENGTH)}`)).toBe(`id ${REDACTED}`);
      expect(redact(`id ${run(LONG_RUN_MIN_LENGTH - 1)}`)).toBe(`id ${run(LONG_RUN_MIN_LENGTH - 1)}`);
      expect(redact(`id ${'a'.repeat(60)}`)).toBe(`id ${'a'.repeat(60)}`);
      expect(redact(`id ${'1'.repeat(60)}`)).toBe(`id ${'1'.repeat(60)}`);
   });

   it('a long base64 run is replaced whatever slashes it holds', () => {
      const run = `ab12/cd34/ef56/gh78/ij90/kl12/mn34/op56`;
      expect(redact(`secret ${run}`)).toBe(`secret ${REDACTED}`);
   });

   it('a private key block that was cut short is redacted to its end', () => {
      expect(redact('before\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nQUJDREVGRw')).toBe(`before\n${REDACTED}`);
   });

   it('a whole private key block is replaced and the text after it stays', () => {
      expect(redact('a -----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY----- b')).toBe(`a ${REDACTED} b`);
   });

   it('redacts a quoted JSON value', () => {
      expect(redact('{"api_key":"abc123"}')).not.toContain('abc123');
   });

   it.each([
      ['a bearer header',  'Authorization: Bearer abc123def456',                   ['abc123def456']],
      ['a GitHub token',   `ghp_${'x1Y2z3'.repeat(6)}`,                            ['x1Y2z3x1Y2z3']],
      ['a fine-grained GitHub token', `github_pat_${'a1B2c3D4e5'.repeat(3)}`,      ['a1B2c3D4e5a1B2c3D4e5']],
      ['an AWS key id',    'AKIAABCDEFGH12345678',                                 ['ABCDEFGH12345678']],
      ['a JWT',            'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1rwW1gFWFOEjXk',
                           ['eyJzdWIiOiIxMjM0NTY3ODkwIn0']],
      ['an sk- key',       `sk-${'a1B2c3D4e5'.repeat(4)}`,                         ['a1B2c3D4e5a1B2c3D4e5']],
   ])('replaces %s', (_label, text, secrets) => {
      const out = redact(`before ${text} after`);
      for (const secret of secrets) { expect(out).not.toContain(secret); }
      expect(out.startsWith('before ')).toBe(true);
      expect(out.endsWith(' after')).toBe(true);
   });
});
