import { describe, it, expect } from 'vitest';
import {
   chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, utimesSync,
   writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { checkStatus, STATUS_MAX_BYTES, type StatusOutcome } from '../status-check.js';
import { parseProfileNames, STATUS_DIR } from '../workflow-command.js';
import { useTempDir, writeFile } from '../../drivers/__tests__/catalog-fixtures.js';
import { PROFILE_FIXTURE } from './profile-fixtures.js';

const dirOf = useTempDir();
const NAMES = parseProfileNames(PROFILE_FIXTURE, 'names-under-test.md');

// A whole second, so a time one millisecond either side of it compares exactly.
const STARTED = 1_700_000_000_000;
const SECOND  = 1000;
const STALE   = -60 * SECOND;

const AS_ROOT = 0 === process.getuid?.();

const MARKER = 'SECRET-FILE-TEXT';

/** Sets the modification time of `file` to `offset` milliseconds from `STARTED`. */
function touch(file: string, offset: number): string
{
   const seconds = (STARTED + offset) / 1000;
   utimesSync(file, seconds, seconds);
   return file;
}

const statusDir = () => join(dirOf(), STATUS_DIR);

/** Raw text, or a value written as the profiles write a status file (pretty-printed, newline). */
type Content = string | Record<string, unknown>;

const textOf = (content: Content) =>
   'string' === typeof content ? content : `${JSON.stringify(content, null, 2)}\n`;

/** A valid `ready` file of Planner that hands off to Enforcer. An override of `undefined` drops the field. */
const ready = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
   schema:     1,
   profile:    'Planner',
   workflowId: 'wf-a',
   status:     'ready',
   next:       { command: 'handoff', to: 'Enforcer' },
   ...overrides,
});

/** Writes `content` as `name` in the status folder, `offset` ms from `STARTED` (fresh by default). */
const put = (name: string, content: Content = ready(), offset = SECOND) =>
   touch(writeFile(join(statusDir(), name), textOf(content)), offset);

const check = (profile = 'Planner', expected = 'Enforcer') =>
   checkStatus({ dir: statusDir(), profile, startedAt: STARTED, names: NAMES, expected });

/** The status folder as it is: names, texts and modification times; undefined when there is none. */
function snapshot()
{
   if (!existsSync(statusDir())) { return undefined; }
   return readdirSync(statusDir()).sort().map(name => {
      const file = join(statusDir(), name);
      return [name, statSync(file).isFile() ? readFileSync(file, 'utf8') : '', statSync(file).mtimeMs];
   });
}

// label, outcome, arrangement of the folder
const ORDER: Array<[string, StatusOutcome, () => void]> = [
   ['no folder', 'missing', () => {}],
   ['an empty folder', 'missing', () => { mkdirSync(statusDir(), { recursive: true }); }],
   ['only a stale ready file', 'stale', () => { put('Planner-wf-a.json', ready(), STALE); }],
   ['only a fresh file of another profile', 'missing', () => {
      put('Enforcer-wf-a.json', ready({ profile: 'Enforcer' }));
   }],
   ['a fresh file of another profile and a stale ready file', 'stale', () => {
      put('Enforcer-wf-a.json', ready({ profile: 'Enforcer' }));
      put('Planner-wf-a.json', ready(), STALE);
   }],
   ['two fresh files, one garbage and one ready', 'ambiguous', () => {
      put('Planner-wf-a.json', 'not json');
      put('Planner-wf-b.json');
   }],
   ['two fresh files and a stale one', 'ambiguous', () => {
      put('Planner-wf-a.json');
      put('Planner-wf-b.json', 'not json');
      put('Planner-wf-c.json', ready(), STALE);
   }],
   ['one fresh unparseable file and a stale ready file', 'invalid', () => {
      put('Planner-wf-a.json', 'not json');
      put('Planner-wf-b.json', ready(), STALE);
   }],
   ['a fresh file with schema 2 and status waiting', 'invalid', () => {
      put('Planner-wf-a.json', ready({ schema: 2, status: 'waiting', next: undefined }));
   }],
   ['a fresh started file whose profile differs from its name', 'invalid', () => {
      put('Planner-wf-a.json', ready({ profile: 'Enforcer', status: 'started', next: undefined }));
   }],
   ['a fresh waiting file with a matching next', 'not_ready', () => {
      put('Planner-wf-a.json', ready({ status: 'waiting' }));
   }],
   ['a fresh ready file naming Architect while Enforcer is expected', 'mismatch', () => {
      put('Planner-wf-a.json', ready({ next: { command: 'handoff', to: 'Architect' } }));
   }],
   ['a fresh ready file and a stale garbage file', 'confirmed', () => {
      put('Planner-wf-a.json');
      put('Planner-wf-b.json', 'not json', STALE);
   }],
];

// Unusable as JSON, wrong schema, wrong profile, and `ready` without a usable `next`.
const INVALID: Content[] = [
   '', '  \n \n', '{"schema":1,"prof', 'hello', '[]', 'null', '1', '"ready"',
   ready({ schema: undefined }), ready({ schema: 2 }), ready({ schema: '1' }), ready({ schema: 0 }),
   ready({ profile: undefined }), ready({ profile: 'Enforcer' }), ready({ profile: 'planner' }),
   ready({ profile: 5 }),
   ready({ next: undefined }), ready({ next: null }), ready({ next: {} }), ready({ next: [] }),
   ready({ next: 'handoff' }), ready({ next: { command: 'handoff' } }), ready({ next: { to: 'Enforcer' } }),
   ready({ next: { command: '', to: 'Enforcer' } }), ready({ next: { command: 'handoff', to: '' } }),
   ready({ next: { command: 5, to: 'Enforcer' } }), ready({ next: { command: 'handoff', to: ['Enforcer'] } }),
];

// Any status but `ready`, with `next` omitted, kept, or out of contract.
const NOT_READY: Content[] = [
   ready({ status: 'started', next: undefined }), ready({ status: 'waiting', next: undefined }),
   ready({ status: 'complete', next: undefined }), ready({ status: 'complete' }),
   ready({ status: 'started' }), ready({ status: 'waiting' }),
   ready({ status: 'READY' }), ready({ status: 'done' }), ready({ status: undefined }),
   ready({ status: null }),
];

// A `ready` file that does not agree with the prose (Enforcer).
const MISMATCH: Content[] = [
   ...['send', 'Handoff', 'HANDOFF', 'none'].map(command => ready({ next: { command, to: 'Enforcer' } })),
   ...['Architect', 'Nobody', 'x'.repeat(200), '../../etc/passwd']
      .map(to => ready({ next: { command: 'handoff', to } })),
];

describe('checking the status files', () => {
   it('a fresh, valid ready file confirms', () => {
      put('Planner-wf-a.json');
      expect(check()).toStrictEqual({ outcome: 'confirmed' });
   });

   it.each(['Enforcer', 'enforcer', 'ENFORCER', 'Verifier'])('[H] next.to "%s" resolves to the profile', to => {
      put('Planner-wf-a.json', ready({ next: { command: 'handoff', to } }));
      expect(check().outcome).toBe('confirmed');
   });

   it('[H] fields beside the contract fields are ignored', () => {
      put('Planner-wf-a.json', ready({ note: 'x', path: '/etc/passwd', command: 'rm', extra: { deep: [1] } }));
      expect(check().outcome).toBe('confirmed');
   });

   it.each(ORDER)('[H] the order of outcomes: %s gives %s', (_label, outcome, arrange) => {
      arrange();
      expect(check().outcome).toBe(outcome);
   });

   const NOT_READ = [
      '.gitkeep', 'planner-wf-a.json', 'PlannerX-wf-a.json', 'Planner2-wf-a.json', 'Planner.json',
      '.Planner-wf-a.json', 'Planner-wf-a.json.tmp', 'Planner-wf-a.JSON', 'Planner-wf-a.txt',
      'Planner-wf-a.json.bak', 'Enforcer-wf-a.json',
   ];

   it.each(NOT_READ)('[H] a fresh ready file named "%s" is not read', name => {
      put(name);
      expect(check().outcome).toBe('missing');
   });

   it('[H] a directory without the .json ending is not read', () => {
      mkdirSync(join(statusDir(), 'Planner-wf-a'), { recursive: true });
      touch(join(statusDir(), 'Planner-wf-a'), SECOND);
      expect(check()).toStrictEqual({ outcome: 'missing' });
   });

   it.each<[string, () => void]>([
      ['no status folder', () => {}],
      ['an empty status folder', () => { mkdirSync(statusDir(), { recursive: true }); }],
      ['a status folder holding only .gitkeep', () => { put('.gitkeep', ''); }],
   ])('%s is missing, with no failure code', (_label, arrange) => {
      arrange();
      expect(check()).toStrictEqual({ outcome: 'missing' });
   });

   // label, milliseconds from the start, outcome
   const AGES: Array<[string, number, StatusOutcome]> = [
      ['60 seconds before', STALE,      'stale'],
      ['1 ms before',       -1,         'stale'],
      ['exactly at',        0,          'confirmed'],
      ['1 ms after',        1,          'confirmed'],
      ['a day after',       86_400_000, 'confirmed'],
   ];

   it.each(AGES)('[H] a file modified %s the start is %s', (_label, offset, outcome) => {
      put('Planner-wf-a.json', ready(), offset);
      expect(check().outcome).toBe(outcome);
   });

   it('[H] a stale file is not read', () => {
      put('Planner-wf-a.json', 'not json', STALE);
      expect(check().outcome).toBe('stale');
   });

   it('[H] a stale ready file does not make a fresh one ambiguous', () => {
      put('Planner-wf-a.json', ready(), STALE);
      put('Planner-wf-b.json', ready({ workflowId: 'wf-b' }));
      expect(check().outcome).toBe('confirmed');
   });

   it('several fresh ready files for one profile are ambiguous', () => {
      put('Planner-wf-a.json');
      put('Planner-wf-b.json', ready({ workflowId: 'wf-b' }));
      expect(check().outcome).toBe('ambiguous');
   });

   it('the count comes before the parse', () => {
      for (let n = 0; n < 50; n++) { put(`Planner-wf-${n}.json`, 'not json'); }
      expect(check().outcome).toBe('ambiguous');
   });

   it.each(INVALID)('[H] a fresh file holding %j is invalid', content => {
      put('Planner-wf-a.json', content);
      expect(check().outcome).toBe('invalid');
   });

   it.each(NOT_READY)('[H] a fresh file holding %j is not ready', content => {
      put('Planner-wf-a.json', content);
      expect(check().outcome).toBe('not_ready');
   });

   it.each(MISMATCH)('[H] a fresh file holding %j is a mismatch', content => {
      put('Planner-wf-a.json', content);
      expect(check().outcome).toBe('mismatch');
   });

   it('[H] a file of another profile never confirms', () => {
      put('Enforcer-wf-a.json', ready({ profile: 'Enforcer' }));
      expect(check('Planner', 'Enforcer').outcome).toBe('missing');
   });

   it('[H] a file of Planner never confirms for Enforcer', () => {
      put('Planner-wf-a.json', ready({ next: { command: 'handoff', to: 'Architect' } }));
      expect(check('Enforcer', 'Architect').outcome).toBe('missing');
   });

   it('[H] a complete file never confirms, even with next kept', () => {
      put('Planner-wf-a.json', ready({ status: 'complete' }));
      expect(check().outcome).toBe('not_ready');
   });

   it.each(ORDER)('the check only reads: %s gives %s', (_label, _outcome, arrange) => {
      arrange();
      const before = snapshot();
      check();
      expect(snapshot()).toEqual(before);
   });

   it('a folder with ready, waiting, garbage and .gitkeep files is left as it was', () => {
      put('Planner-wf-a.json', ready({ status: 'waiting' }));
      put('Planner-wf-b.json', 'not json');
      put('Planner-wf-c.json', ready(), STALE);
      put('.gitkeep', '');
      const before = snapshot();
      check();
      expect(snapshot()).toEqual(before);
   });
});

describe('status file values are data', () => {
   // overrides of a ready file, outcome
   const HOSTILE: Array<[Record<string, unknown>, StatusOutcome]> = [
      [{ next: { command: 'handoff', to: '$(touch pwned)' } },  'mismatch'],
      [{ next: { command: 'handoff', to: '; touch pwned' } },   'mismatch'],
      [{ next: { command: 'handoff', to: '`touch pwned`' } },   'mismatch'],
      [{ next: { command: 'handoff', to: '../../pwned' } },     'mismatch'],
      [{ workflowId: '../../pwned' },                           'confirmed'],
      [{ workflowId: '$(touch pwned)' },                        'confirmed'],
      [{ workflowId: undefined },                               'confirmed'],
   ];

   it.each(HOSTILE)('[H] %j is never run and never used as a path (%s)', (overrides, outcome) => {
      put('Planner-wf-a.json', ready(overrides));
      expect(check().outcome).toBe(outcome);
      const made = readdirSync(dirOf(), { recursive: true }).map(String).filter(name => name.includes('pwned'));
      expect(made).toEqual([]);
      expect(existsSync(join(dirname(dirOf()), 'pwned'))).toBe(false);
   });

   // Pads a ready file with an extra field to exactly `bytes` bytes.
   const padded = (bytes: number) => {
      const base = textOf(ready({ pad: '' }));
      return textOf(ready({ pad: 'x'.repeat(bytes - Buffer.byteLength(base)) }));
   };

   const SIZES: Array<[string, number, StatusOutcome]> = [
      ['exactly the bound',   STATUS_MAX_BYTES,       'confirmed'],
      ['one byte over',       STATUS_MAX_BYTES + 1,   'invalid'],
      ['100 times the bound', STATUS_MAX_BYTES * 100, 'invalid'],
   ];

   it.each(SIZES)('[H] a file of %s is read within a bound: %s', (_label, bytes, outcome) => {
      put('Planner-wf-a.json', padded(bytes));
      expect(check().outcome).toBe(outcome);
   });

   it('a status path that is a regular file is a missing folder with its code', () => {
      writeFile(statusDir(), 'not a folder');
      expect(check()).toStrictEqual({ outcome: 'missing', failureCode: 'ENOTDIR' });
   });

   it('a directory named like a status file is invalid with its code', () => {
      const file = join(statusDir(), 'Planner-wf-a.json');
      mkdirSync(file, { recursive: true });
      touch(file, SECOND);
      expect(check()).toStrictEqual({ outcome: 'invalid', failureCode: 'EISDIR' });
   });

   it('a dangling link named like a status file is gone, not a failure', () => {
      mkdirSync(statusDir(), { recursive: true });
      symlinkSync(join(dirOf(), 'gone.json'), join(statusDir(), 'Planner-wf-a.json'));
      expect(check()).toStrictEqual({ outcome: 'missing' });
   });

   it.skipIf(AS_ROOT)('a file that cannot be read is invalid with its code', () => {
      chmodSync(put('Planner-wf-a.json'), 0o000);
      expect(() => check()).not.toThrow();
      expect(check()).toStrictEqual({ outcome: 'invalid', failureCode: 'EACCES' });
   });

   // label, outcome, text
   const HOSTILE_TEXT: Array<[string, StatusOutcome, string]> = [
      ['an array nested 7000 levels', 'invalid', `${'['.repeat(7000)}${']'.repeat(7000)}`],
      ['an own __proto__ key holding a ready status', 'not_ready',
         '{"schema":1,"profile":"Planner","__proto__":'
         + '{"status":"ready","next":{"command":"handoff","to":"Enforcer"}}}'],
      ['NUL characters', 'invalid', '\u0000'.repeat(100)],
   ];

   it.each(HOSTILE_TEXT)('[H] %s does not throw and is %s', (_label, outcome, text) => {
      put('Planner-wf-a.json', text);
      expect(() => check()).not.toThrow();
      expect(check().outcome).toBe(outcome);
   });

   it('[H] binary bytes do not throw and are invalid', () => {
      const file = put('Planner-wf-a.json', '');
      writeFileSync(file, Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x80, 0x7b, 0x00]));
      expect(() => check()).not.toThrow();
      expect(check().outcome).toBe('invalid');
   });

   it('[H] the result carries no file content and no path', () => {
      const marked = (content: Content): Content =>
         'string' === typeof content ? content : { ...content, workflowId: MARKER, note: MARKER };
      const rows: Content[] = [
         ...[...INVALID, ...NOT_READY, ...MISMATCH].map(marked),
         ready({ next: { command: 'handoff', to: MARKER } }),
         ready({ profile: MARKER }),
         ready({ workflowId: MARKER, note: MARKER }),
      ];
      for (const row of rows) {
         put('Planner-wf-a.json', row);
         const result = check();
         expect(['outcome', 'failureCode']).toEqual(expect.arrayContaining(Object.keys(result)));
         expect(JSON.stringify(result)).not.toContain(MARKER);
         expect(JSON.stringify(result)).not.toContain(dirOf());
      }
   });

   it('[H] a marker in the file name does not reach the result', () => {
      put(`Planner-${MARKER}.json`);
      expect(check()).toStrictEqual({ outcome: 'confirmed' });
   });
});
