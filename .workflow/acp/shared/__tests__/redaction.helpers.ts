/** An agent session id that redact() would replace if the writer did not leave single tokens alone. */
export const LONG_SESSION_ID = 'FAKESESSIONID0000000000000000001';

/** Secret-shaped lines: [label, the line, the secret parts that must never be kept]. */
export const SECRET_LINES: Array<[string, string, string[]]> = [
   ['a bearer header',  'Authorization: Bearer abc123def456',                          ['abc123def456']],
   ['token words',      'access_token=abc123def456, token: abc, tokens=abc',           ['abc123def456', 'abc']],
   ['key words',        'api_key=abc123, API-KEYS: abc, ssh key abc123',               ['abc123', 'abc']],
   ['credential words', 'credential=abc123, Credentials: user:pass',                   ['abc123', 'user:pass']],
   ['security words',   'security_token=abc123, security: abc, securities=abc',        ['abc123', 'abc']],
   ['a GitHub token',   `ghp_${'x1Y2z3'.repeat(6)}`,                                   ['x1Y2z3x1Y2z3']],
   ['an AWS key id',    'AKIAABCDEFGH12345678',                                        ['ABCDEFGH12345678']],
   ['a JWT',            'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1rwW1gFWFOEjXk',
                        ['eyJzdWIiOiIxMjM0NTY3ODkwIn0']],
   ['an sk- key',       `sk-${'a1B2c3D4e5'.repeat(4)}`,                                ['a1B2c3D4e5a1B2c3D4e5']],
   ['a private key',    '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEF\nQUJDREVGR0hJSktMTU5PUFFS\n'
                        + '-----END PRIVATE KEY-----',
                        ['MIIEvQIBADANBgkqhkiG9w0BAQEF', 'QUJDREVGR0hJSktMTU5PUFFS']],
   ['a hex run',        'a3f5c7e9b1d2a3f5c7e9b1d2a3f5c7e9b1d2a3f5',                    ['a3f5c7e9b1d2a3f5c7e9']],
   ['a 32 character hex run', 'a3f5c7e9b1d2a3f5c7e9b1d2a3f5c7e9',                      ['a3f5c7e9b1d2a3f5c7e9']],
   ['a base64 run',     'dGhpcyBpcyBhIHNlY3JldCBrZXkgdmFsdWUgMTIzNDU2Nzg5MA==',
                        ['dGhpcyBpcyBhIHNlY3JldCBrZXkgdmFsdWUg']],
];
