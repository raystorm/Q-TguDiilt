/**
 * The registration of the service in the IDE's `acp.json`: the entry that is written, what is kept, what
 * stops the run, the backup, a write that fails, links and modes. Every home folder is a temporary one.
 */
import {
   chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, statSync, symlinkSync,
   writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
   acpJson, acpOf, acpPath, again, cleanup, entryOf, FAKE_NODE, keyOf, makeEngine, put, recordingIo, runOn,
   start, startOf, tempDir, tree, type Recorded,
} from './engine.js';

afterEach(cleanup);

const SECRET  = 'fake-secret';

/** Whether a stop line names the `acp.json` of the home folder. */
const stopNamesPath = (lines: string[], home: string) =>
   lines.some((line) => line.startsWith('stop') && line.includes(acpPath(home)));

const OPTIONS = [
   { name: 'a real run', options: [] as string[] },
   { name: 'a dry run',  options: ['--dry-run'] },
];

describe('the first registration', () =>
{
   const TARGETS = [
      { label: 'a plain name',      folder: 'fake-repo',    spell: (dir: string) => dir },
      { label: 'a trailing slash',  folder: 'fake-repo',    spell: (dir: string) => `${dir}${sep}` },
      {
         label:  'a `..` segment',
         folder: 'fake-repo',
         spell:  (dir: string) => `${dirname(dir)}${sep}fake-parent${sep}..${sep}${basename(dir)}`,
      },
      { label: 'spaces',            folder: 'my fake repo', spell: (dir: string) => dir },
      { label: 'non-ASCII letters', folder: 'répo-fäke',    spell: (dir: string) => dir },
   ];

   it.each(TARGETS)('writes the entry for $label, with no backup and a note about Node', ({ folder, spell }) =>
   {
      const dir = join(tempDir('installer-target-'), folder);
      mkdirSync(dir);
      const recorded = recordingIo();

      const { result } = runOn(makeEngine(), [spell(dir)], recorded);

      expect(acpOf(recorded.home)).toEqual({ agent_servers: { [`Q-TguDiilt (${folder})`]: entryOf(dir) } });
      expect(result.lines).toContain(`create ${acpPath(recorded.home)}`);
      expect(existsSync(`${acpPath(recorded.home)}.bak`)).toBe(false);
      expect(result.lines.some((line) => line.includes(FAKE_NODE) && /upgrade/i.test(line))).toBe(true);
      expect(result.code).toBe(0);
   });
});

describe('a file with other content', () =>
{
   const ORIGINAL = {
      servers: {
         'fake-one':   { command: 'fake-cmd', args: ['fake-arg'] },
         'fake-two':   { command: 'fake-cmd-2', env: { FAKE_TOKEN: SECRET } },
         'fake-extra': 'fake unknown value',
      },
      extra: { default_mcp_settings: { fake: true }, fake_unknown_key: [1, 2] },
   };

   it('gets the entry and nothing else changes, and no line prints the file\'s content', () =>
   {
      const real = start(false);
      const dry  = start(false);
      acpJson(real.recorded.home, ORIGINAL);
      acpJson(dry.recorded.home, ORIGINAL);
      const original = acpOf(real.recorded.home);
      const key      = keyOf(real.target);

      const dryRun = again(dry, '--dry-run');
      expect(dryRun.result.lines).toContain(`update ${acpPath(dry.recorded.home)}`);
      const added = `   add key ${JSON.stringify(keyOf(dry.target))} `;
      expect(dryRun.result.lines.some((line) => line.startsWith(added))).toBe(true);
      const done   = again(real);

      const after    = acpOf(real.recorded.home);
      const expected = { ...original.agent_servers, [key]: entryOf(real.target) };
      expect(after).toEqual({ ...original, agent_servers: expected });
      expect(Object.keys(after)).toEqual(Object.keys(original));
      expect(Object.keys(after.agent_servers)).toEqual([...Object.keys(original.agent_servers), key]);
      expect(acpOf(dry.recorded.home)).toEqual(original);
      for (const { lines } of [dryRun.result, done.result]) { expect(lines.join('\n')).not.toContain(SECRET); }
   });
});

describe('the backup', () =>
{
   it('holds the first original exactly, through two updates', () =>
   {
      const ctx      = start(false);
      const original = '{\n\t"fake_top": 1,\n\t"agent_servers": {}\n}\n\n';
      put(ctx.recorded.home, '.jetbrains/acp.json', original);

      again(ctx);
      ctx.recorded.io.node = '/fake/bin/node-2';
      again(ctx);
      ctx.recorded.io.node = '/fake/bin/node-3';
      again(ctx);

      const servers = acpOf(ctx.recorded.home).agent_servers;
      expect(readFileSync(`${acpPath(ctx.recorded.home)}.bak`, 'utf8')).toBe(original);
      expect(servers[keyOf(ctx.target)]).toEqual(entryOf(ctx.target, '/fake/bin/node-3'));
   });

   it('is not made when there was no file', () =>
   {
      const ctx = start(false);

      again(ctx);

      expect(existsSync(`${acpPath(ctx.recorded.home)}.bak`)).toBe(false);
   });

   it('is not made, and the file is not touched, when the entry already equals the one to write', () =>
   {
      const ctx    = start(false);
      const path   = acpJson(ctx.recorded.home, { servers: { [keyOf(ctx.target)]: entryOf(ctx.target) } });
      const before = readFileSync(path, 'utf8');

      again(ctx);

      expect(readFileSync(path, 'utf8')).toBe(before);
      expect(existsSync(`${path}.bak`)).toBe(false);
   });
});

describe('a finished install', () =>
{
   it.each(OPTIONS)('has nothing to write on $name and writes, renames and removes nothing', ({ options }) =>
   {
      const ctx = start(true);
      const { recorded } = ctx;
      const homeBefore   = tree(recorded.home);
      const targetBefore = tree(ctx.target);
      recorded.clock.time = new Date('2026-06-01T00:00:00.000Z');
      for (const list of [recorded.writes, recorded.renames, recorded.removes]) { list.length = 0; }

      const { result } = again(ctx, ...options);

      expect(result.lines).toEqual(['nothing to write']);
      expect([recorded.writes, recorded.renames, recorded.removes]).toEqual([[], [], []]);
      expect(tree(recorded.home)).toEqual(homeBefore);
      expect(tree(ctx.target)).toEqual(targetBefore);
      expect(result.code).toBe(0);
   });
});

describe('our own entry', () =>
{
   it('is updated in command and args only; the user\'s other keys and other entries stay', () =>
   {
      const ctx  = start(false);
      const key  = keyOf(ctx.target);
      const path = acpJson(ctx.recorded.home, {
         servers: {
            [key]:        { command: '/old/node', args: [startOf(ctx.target)], env: { FAKE_TOKEN: SECRET } },
            'fake-other': { command: 'fake-cmd' },
         },
      });
      const original = readFileSync(path, 'utf8');

      const { result } = again(ctx);
      expect(result.lines.some((line) => line.startsWith(`   update key ${JSON.stringify(key)} `))).toBe(true);

      const servers = acpOf(ctx.recorded.home).agent_servers;
      expect(servers[key]).toEqual({ ...entryOf(ctx.target), env: { FAKE_TOKEN: SECRET } });
      expect(servers['fake-other']).toEqual({ command: 'fake-cmd' });
      expect(readFileSync(`${path}.bak`, 'utf8')).toBe(original);
      expect(result.code).toBe(0);
   });
});

describe('an entry under our key that starts another project', () =>
{
   const other = { command: 'fake-cmd', args: ['/fake/other/.workflow/acp/start.mjs'] };

   it.each([...OPTIONS, { name: 'a forced run', options: ['--force'] }])(
      'stops on $name, names the key and --name, and writes nothing',
      ({ options }) =>
   {
      const ctx = start(false);
      const key = keyOf(ctx.target);
      acpJson(ctx.recorded.home, { servers: { [key]: other } });
      const homeBefore = tree(ctx.recorded.home);
      ctx.recorded.writes.length = 0;

      const { result } = again(ctx, ...options);

      expect(result.code).not.toBe(0);
      expect(result.lines.join('\n')).toContain(key);
      expect(result.lines.join('\n')).toContain('--name <key>');
      expect(tree(ctx.recorded.home)).toEqual(homeBefore);
      expect(tree(ctx.target)).toEqual({});
      expect(ctx.recorded.writes).toEqual([]);
   });

   it('is the same for a second project whose folder has the same name', () =>
   {
      const engine     = makeEngine();
      const recorded   = recordingIo();
      const [one, two] = [0, 1].map(() =>
      {
         const dir = join(tempDir('installer-parent-'), 'fake-repo');
         mkdirSync(dir);
         return dir;
      });
      runOn(engine, [one], recorded);

      const { result } = runOn(engine, [two], recorded);

      expect(result.code).not.toBe(0);
      expect(result.lines.join('\n')).toContain('Q-TguDiilt (fake-repo)');
      expect(result.lines.join('\n')).toContain('--name <key>');
      expect(acpOf(recorded.home).agent_servers['Q-TguDiilt (fake-repo)']).toEqual(entryOf(one));
   });
});

describe('an entry under another key that starts this project', () =>
{
   it('is warned about by name and left alone, and the requested key is still written', () =>
   {
      const ctx = start(false);
      const old = { command: 'fake-cmd', args: [startOf(ctx.target)] };
      acpJson(ctx.recorded.home, { servers: { 'fake-old': old } });

      const { result } = again(ctx);

      const warned  = result.lines.filter((line) => line.startsWith('warning'));
      const servers = acpOf(ctx.recorded.home).agent_servers;
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain('fake-old');
      expect(servers[keyOf(ctx.target)]).toEqual(entryOf(ctx.target));
      expect(servers['fake-old']).toEqual(old);
      expect(result.code).toBe(0);
   });
});

describe('--name', () =>
{
   it.each([
      { name: 'before the target', argv: (target: string) => ['--name', 'fake-key', target] },
      { name: 'after the target',  argv: (target: string) => [target, '--name', 'fake-key'] },
   ])('registers under the key given, $name', ({ argv }) =>
   {
      const target   = tempDir('installer-target-');
      const recorded = recordingIo();

      const { result } = runOn(makeEngine(), argv(target), recorded);

      const servers = acpOf(recorded.home).agent_servers;
      expect(Object.keys(servers)).toEqual(['fake-key']);
      expect(servers['fake-key']).toEqual(entryOf(target));
      expect(result.code).toBe(0);
   });

   it('is read between --dry-run and --force too, and a dry run writes nothing', () =>
   {
      const target   = tempDir('installer-target-');
      const recorded = recordingIo();
      const argv     = ['--dry-run', '--name', 'fake-key', '--force', target];

      const { result } = runOn(makeEngine(), argv, recorded);

      expect(result.lines.join('\n')).toContain('"fake-key"');
      expect(result.lines.join('\n')).not.toContain('Q-TguDiilt (');
      expect(recorded.writes).toEqual([]);
      expect(existsSync(acpPath(recorded.home))).toBe(false);
      expect(result.code).toBe(0);
   });

   it('registers under a new key when the default key is another project\'s, and keeps that entry', () =>
   {
      const ctx   = start(false);
      const key   = keyOf(ctx.target);
      const other = { command: 'fake-cmd', args: ['/fake/other/.workflow/acp/start.mjs'] };
      acpJson(ctx.recorded.home, { servers: { [key]: other } });
      const before = JSON.stringify(acpOf(ctx.recorded.home).agent_servers[key]);

      const { result } = again(ctx, '--name', 'fake-other');

      const servers = acpOf(ctx.recorded.home).agent_servers;
      expect(servers['fake-other']).toEqual(entryOf(ctx.target));
      expect(JSON.stringify(servers[key])).toBe(before);
      expect(result.code).toBe(0);
   });
});

describe('a command line with a bad --name', () =>
{
   const REFUSED = [
      { name: '--name as the last argument', args: ['--name'],                     problem: /needs a key/ },
      { name: '--name before an option',     args: ['--name', '--dry-run'],        problem: /needs a key/ },
      { name: 'an empty value',              args: ['--name', ''],                 problem: /needs a key/ },
      { name: 'a blank value',               args: ['--name', '   '],              problem: /needs a key/ },
      { name: 'two --name',                  args: ['--name', 'a', '--name', 'b'], problem: /twice/ },
      { name: 'the --name=key form',         args: ['--name=fake-key'],            problem: /--name=fake-key/ },
   ];

   it.each(REFUSED)('refuses $name, names the problem, shows the usage and writes nothing',
      ({ args, problem }) =>
   {
      const target     = tempDir('installer-target-');
      const recorded   = recordingIo();
      const homeBefore = tree(recorded.home);

      const { result } = runOn(makeEngine(), [target, ...args], recorded);

      expect(result.code).not.toBe(0);
      expect(result.lines.join('\n')).toMatch(problem);
      expect(result.lines.at(-1)).toContain('--name <key>');
      expect([recorded.writes, recorded.renames, recorded.removes]).toEqual([[], [], []]);
      expect(tree(target)).toEqual({});
      expect(tree(recorded.home)).toEqual(homeBefore);
   });
});

describe('a key that is a name Object has', () =>
{
   const KEYS = [
      { label: '__proto__',            key: '__proto__' },
      { label: 'constructor',          key: 'constructor' },
      { label: 'toString',             key: 'toString' },
      { label: 'quotes',               key: 'Fake "quoted" key' },
      { label: 'spaces and non-ASCII', key: 'fäke ключ key' },
      { label: '300 characters',       key: 'k'.repeat(300) },
   ];

   it.each(KEYS)('is written as an own property for $label, beside the others, and found again', ({ key }) =>
   {
      const ctx = start(false);
      acpJson(ctx.recorded.home, { servers: { 'fake-other': { command: 'fake-cmd' } } });

      const { result } = again(ctx, '--name', key);

      const servers = acpOf(ctx.recorded.home).agent_servers;
      expect(Object.keys(servers)).toEqual(['fake-other', key]);
      expect(Object.hasOwn(servers, key)).toBe(true);
      expect(servers[key]).toEqual(entryOf(ctx.target));
      expect(servers['fake-other']).toEqual({ command: 'fake-cmd' });
      expect(Object.getPrototypeOf(servers)).toBe(Object.prototype);
      expect(again(ctx, '--name', key).result.lines).toEqual(['nothing to write']);
      expect(result.code).toBe(0);
   });
});

describe('an acp.json that cannot be used', () =>
{
   const withKey = (value: unknown) => (key: string) => JSON.stringify({ agent_servers: { [key]: value } });

   const UNUSABLE = [
      { name: 'an empty file',          text: () => '' },
      { name: 'truncated JSON',         text: () => `{ "agent_servers": { "fake": { "env": "${SECRET}"` },
      { name: 'JSON with a comment',    text: () => `// ${SECRET}\n{}\n` },
      { name: 'an array',               text: () => `["${SECRET}"]\n` },
      { name: 'null',                   text: () => 'null\n' },
      { name: 'a string',               text: () => `"${SECRET}"\n` },
      { name: 'agent_servers an array', text: () => `{ "agent_servers": ["${SECRET}"] }\n` },
      { name: 'agent_servers a string', text: () => `{ "agent_servers": "${SECRET}" }\n` },
      { name: 'agent_servers null',     text: () => '{ "agent_servers": null }\n' },
      { name: 'our entry a string',     text: withKey(SECRET) },
      { name: 'our entry null',         text: withKey(null) },
      { name: 'our entry an array',     text: withKey([SECRET]) },
   ];

   describe.each(UNUSABLE)('$name', ({ text }) =>
   {
      it.each(OPTIONS)('stops on $name, names the path, prints none of the content, writes nothing',
         ({ options }) =>
      {
         const ctx = start(false);
         put(ctx.recorded.home, '.jetbrains/acp.json', text(keyOf(ctx.target)));
         const homeBefore = tree(ctx.recorded.home);
         ctx.recorded.writes.length = 0;

         const { result } = again(ctx, ...options);

         expect(result.code).not.toBe(0);
         expect(stopNamesPath(result.lines, ctx.recorded.home)).toBe(true);
         expect(result.lines.join('\n')).not.toContain(SECRET);
         expect(tree(ctx.recorded.home)).toEqual(homeBefore);
         expect(tree(ctx.target)).toEqual({});
         expect(ctx.recorded.writes).toEqual([]);
      });
   });

   const NOT_A_FILE = [
      { name: 'a folder', make: (home: string) => mkdirSync(acpPath(home), { recursive: true }) },
      ...('win32' === process.platform ? [] : [
         {
            name: 'a link to nothing',
            make: (home: string) =>
            {
               mkdirSync(dirname(acpPath(home)), { recursive: true });
               symlinkSync(join(home, 'fake-missing'), acpPath(home));
            },
         },
         {
            name: 'a link to a folder',
            make: (home: string) =>
            {
               mkdirSync(dirname(acpPath(home)), { recursive: true });
               symlinkSync(tempDir('installer-linked-'), acpPath(home));
            },
         },
      ]),
   ];

   describe.each(NOT_A_FILE)('$name', ({ make }) =>
   {
      it.each(OPTIONS)('stops on $name, names the path and writes nothing', ({ options }) =>
      {
         const ctx = start(false);
         make(ctx.recorded.home);
         const homeBefore = tree(ctx.recorded.home);
         ctx.recorded.writes.length = 0;

         const { result } = again(ctx, ...options);

         expect(result.code).not.toBe(0);
         expect(stopNamesPath(result.lines, ctx.recorded.home)).toBe(true);
         expect(tree(ctx.recorded.home)).toEqual(homeBefore);
         expect(tree(ctx.target)).toEqual({});
         expect(ctx.recorded.writes).toEqual([]);
      });
   });
});

describe('a write that fails', () =>
{
   interface Step
   {
      name:    string;
      write?:  (path: string, home: string) => boolean;
      rename?: boolean;
   }

   const isTemporary = (path: string, home: string) =>
      dirname(path) === dirname(acpPath(home)) && acpPath(home) !== path && !path.endsWith('.bak');

   const STEPS: Step[] = [
      { name: 'the write of the temporary file', write: isTemporary },
      { name: 'the write of the backup',         write: (path) => path.endsWith('.bak') },
      { name: 'the rename onto acp.json',        rename: true },
   ];

   it.each(STEPS)('$name: the folder is as it was, the failure is named, the rest is written', (step) =>
   {
      const engine   = makeEngine();
      const target   = tempDir('installer-target-');
      const recorded: Recorded = recordingIo(
         (path) => step.write?.(path, recorded.home) ?? false,
         () => true === step.rename,
      );
      const path   = acpJson(recorded.home, { servers: { 'fake-one': { command: 'fake-cmd' } } });
      const before = readFileSync(path, 'utf8');
      const names  = readdirSync(dirname(path)).sort();

      const { result } = runOn(engine, [target], recorded);

      expect(readFileSync(path, 'utf8')).toBe(before);
      expect(readdirSync(dirname(path)).sort()).toEqual(names);
      expect(result.lines.some((line) => line.startsWith('failed ') && line.includes('acp.json'))).toBe(true);
      expect(existsSync(join(target, '.workflow/installed.json'))).toBe(true);
      expect(result.code).not.toBe(0);
   });

   it('writes no entry when the launcher could not be written', () =>
   {
      const recorded = recordingIo((path) => path.endsWith('start.mjs'));

      const { result } = runOn(makeEngine(), [tempDir('installer-target-')], recorded);

      expect(existsSync(acpPath(recorded.home))).toBe(false);
      expect(result.code).not.toBe(0);
   });
});

describe.skipIf('win32' === process.platform)('an acp.json behind links', () =>
{
   it.each([
      { name: 'an absolute link', pointer: (from: string, to: string) => to },
      { name: 'a relative link',  pointer: (from: string, to: string) => relative(dirname(from), to) },
   ])('is written through $name, and the link stays', ({ pointer }) =>
   {
      const ctx      = start(false);
      const real     = join(tempDir('installer-dotfiles-'), 'acp.json');
      const fixture  = { agent_servers: { 'fake-one': { command: 'fake-cmd' } } };
      const original = `${JSON.stringify(fixture, null, 2)}\n`;
      writeFileSync(real, original);
      const link = acpPath(ctx.recorded.home);
      mkdirSync(dirname(link), { recursive: true });
      const points = pointer(link, real);
      symlinkSync(points, link);

      again(ctx);

      const written = JSON.parse(readFileSync(real, 'utf8'));
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readlinkSync(link)).toBe(points);
      expect(written.agent_servers[keyOf(ctx.target)]).toEqual(entryOf(ctx.target));
      expect(readFileSync(`${real}.bak`, 'utf8')).toBe(original);
      expect(existsSync(`${link}.bak`)).toBe(false);
      expect(again(ctx).result.lines).toEqual(['nothing to write']);
   });

   it('is written through a .jetbrains folder that is a link', () =>
   {
      const ctx    = start(false);
      const folder = tempDir('installer-dotfolder-');
      symlinkSync(folder, join(ctx.recorded.home, '.jetbrains'));

      again(ctx);

      const written = JSON.parse(readFileSync(join(folder, 'acp.json'), 'utf8'));
      expect(lstatSync(join(ctx.recorded.home, '.jetbrains')).isSymbolicLink()).toBe(true);
      expect(written.agent_servers[keyOf(ctx.target)]).toEqual(entryOf(ctx.target));
   });
});

describe.skipIf('win32' === process.platform)('the mode of acp.json', () =>
{
   it('is kept on the file and its backup (0600 stays 0600)', () =>
   {
      const ctx  = start(false);
      const path = acpJson(ctx.recorded.home, { servers: { 'fake-one': { command: 'fake-cmd' } } });
      chmodSync(path, 0o600);

      again(ctx);

      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(`${path}.bak`).mode & 0o777).toBe(0o600);
   });

   it('is not writable by group or others on a new file', () =>
   {
      const ctx = start(false);

      again(ctx);

      expect(statSync(acpPath(ctx.recorded.home)).mode & 0o022).toBe(0);
   });
});
