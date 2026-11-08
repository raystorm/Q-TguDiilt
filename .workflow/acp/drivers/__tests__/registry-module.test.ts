import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegistryConfig } from '../registry.js';
import { RegistryConfigInvalidError, RegistryConfigMissingError } from '../errors.js';
import { FIXTURE_MODULE } from './registry-fixtures.js';

let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'registry-module-test-')); });
afterEach(()  => { rmSync(dir, { recursive: true, force: true }); });

function writeRegistry(yaml: string, name = 'registry.yaml'): string
{
   const filePath = join(dir, name);
   writeFileSync(filePath, yaml);
   return filePath;
}

/** Loads a registry that must be rejected; returns the error message. */
function invalidMessage(filePath: string): string
{
   try { loadRegistryConfig(filePath); }
   catch (err) {
      expect(err).toBeInstanceOf(RegistryConfigInvalidError);
      return (err as Error).message;
   }
   throw new Error('expected loadRegistryConfig to throw');
}

const validKiro = `
drivers:
  kiro:
    module: ${FIXTURE_MODULE}
    models: [auto]
`;

describe('registry loader — module field', () => {
   it('keeps an entry module exactly as written', () => {
      const config = loadRegistryConfig(writeRegistry(validKiro));
      expect(config.drivers.kiro.module).toBe(FIXTURE_MODULE);
   });

   it('an entry without a module throws, naming the file, the driver and "module"', () => {
      const filePath = writeRegistry(`
drivers:
  kiro:
    models: [auto]
`);
      const message = invalidMessage(filePath);
      expect(message).toContain(filePath);
      expect(message).toContain('"kiro"');
      expect(message).toContain('module');
   });

   it.each([
      ['an empty string', '""'],
      ['a number',        '123'],
      ['null',            'null'],
      ['a list',          '[a, b]'],
      ['an object',       '{ a: 1 }'],
      ['a boolean',       'true'],
      ['whitespace only', '"   "'],
   ])('a module of %s throws, naming the driver', (_label, value) => {
      const filePath = writeRegistry(`
drivers:
  kiro:
    module: ${value}
    models: [auto]
`);
      expect(invalidMessage(filePath)).toContain('"kiro"');
   });

   it('one bad entry rejects the whole file, naming that entry', () => {
      const filePath = writeRegistry(`
drivers:
  kiro:
    module: ${FIXTURE_MODULE}
    models: [auto]
  copilot:
    models: [auto]
`);
      expect(invalidMessage(filePath)).toContain('"copilot"');
   });

   it('drivers the registry does not list load unchanged in preferred and profiles', () => {
      const config = loadRegistryConfig(writeRegistry(`
preferred:
  driver: kiroo
  model: no-such-model
profiles:
  Builder:
    model: auto
    driver: nonesuch
drivers:
  kiro:
    module: ${FIXTURE_MODULE}
    models: [auto]
`));
      expect(config.preferred).toEqual({ driver: 'kiroo', model: 'no-such-model' });
      expect(config.profiles?.Builder.driver).toBe('nonesuch');
   });

   it('a preferred model that its driver does not list loads unchanged', () => {
      const filePath = writeRegistry(`preferred:\n  driver: kiro\n  model: m9\n${validKiro}`);
      expect(loadRegistryConfig(filePath).preferred).toEqual({ driver: 'kiro', model: 'm9' });
   });

   it('a missing registry file points to the example file and does not use it', () => {
      writeRegistry(validKiro, 'registry.example.yaml');
      const missingPath = join(dir, 'registry.yaml');
      let caught: unknown;
      try { loadRegistryConfig(missingPath); }
      catch (err) { caught = err; }
      expect(caught).toBeInstanceOf(RegistryConfigMissingError);
      expect((caught as Error).message).toContain(missingPath);
      expect((caught as Error).message).toContain('registry.example.yaml');
   });
});

describe('registry loader — preferred', () => {
   const load = (top: string) => loadRegistryConfig(writeRegistry(`${top}\n${validKiro}`));

   it('a preferred driver and model load as written', () => {
      const config = load('preferred:\n  driver: kiro\n  model: m1');
      expect(config.preferred).toEqual({ driver: 'kiro', model: 'm1' });
   });

   it('a preferred driver alone has no model', () => {
      expect(load('preferred:\n  driver: kiro').preferred).toStrictEqual({ driver: 'kiro' });
   });

   it('without preferred the config has none', () => {
      expect(loadRegistryConfig(writeRegistry(validKiro)).preferred).toBeUndefined();
   });

   it.each([
      ['a string',                  'preferred: kiro'],
      ['a number',                  'preferred: 3'],
      ['a list',                    'preferred: [kiro]'],
      ['empty',                     'preferred:'],
      ['without a driver',          'preferred:\n  model: m1'],
      ['with an empty driver',      'preferred:\n  driver: ""'],
      ['with a numeric driver',     'preferred:\n  driver: 3'],
      ['with a null driver',        'preferred:\n  driver:'],
      ['with a list as the driver', 'preferred:\n  driver: [kiro]'],
      ['with an empty model',       'preferred:\n  driver: kiro\n  model: ""'],
      ['with a numeric model',      'preferred:\n  driver: kiro\n  model: 3'],
      ['with a null model',         'preferred:\n  driver: kiro\n  model:'],
      ['with a list as the model',  'preferred:\n  driver: kiro\n  model: [m1]'],
   ])('a preferred that is %s throws, naming the file and "preferred"', (_label, yaml) => {
      const filePath = writeRegistry(`${yaml}\n${validKiro}`);
      const message  = invalidMessage(filePath);
      expect(message).toContain(filePath);
      expect(message).toContain('preferred');
   });

   it('the old field names are not in the loaded shape', () => {
      const config = load('preferred:\n  driver: kiro') as unknown as Record<string, unknown>;
      expect(config.preferredDriver).toBeUndefined();
      expect(config.preferredModel).toBeUndefined();
   });
});

describe('registry loader — top-level keys', () => {
   const KNOWN        = ['drivers', 'preferred', 'profiles', 'fallbackMode'];
   const UNKNOWN_KEYS = [
      'prefered', 'Drivers', 'fallbackmode', 'preferredDriver', 'preferredModel', 'made-up',
   ];

   it.each(UNKNOWN_KEYS)(
      'an unknown key "%s" throws, naming the file, the key and the known keys',
      key => {
         const filePath = writeRegistry(`${key}: x\n${validKiro}`);
         const message  = invalidMessage(filePath);
         expect(message).toContain(filePath);
         expect(message).toContain(key);
         for (const known of KNOWN) { expect(message).toContain(known); }
      },
   );

   it('the message does not name the old fields unless the file used them', () => {
      const message = invalidMessage(writeRegistry(`prefered: x\n${validKiro}`));
      expect(message).not.toContain('preferredDriver');
      expect(message).not.toContain('preferredModel');
   });

   it('every unknown key is named', () => {
      const message = invalidMessage(writeRegistry(`first-extra: 1\nsecond-extra: 2\n${validKiro}`));
      expect(message).toContain('first-extra');
      expect(message).toContain('second-extra');
   });

   it('all four known keys load together', () => {
      const config = loadRegistryConfig(writeRegistry(`
preferred:
  driver: kiro
  model: auto
profiles:
  Builder:
    model: auto
fallbackMode: fail-fast
${validKiro}`));
      expect(config.preferred).toEqual({ driver: 'kiro', model: 'auto' });
      expect(config.profiles?.Builder).toEqual({ model: 'auto' });
      expect(config.fallbackMode).toBe('fail-fast');
      expect(Object.keys(config.drivers)).toEqual(['kiro']);
   });

   it('unknown keys inside driver and profile entries are not rejected', () => {
      const config = loadRegistryConfig(writeRegistry(`
profiles:
  Builder:
    model: auto
    extra: 1
drivers:
  kiro:
    module: ${FIXTURE_MODULE}
    models: [auto]
    notes: hello
`));
      expect(config.drivers.kiro).toEqual({ module: FIXTURE_MODULE, models: ['auto'] });
      expect(config.profiles?.Builder).toEqual({ model: 'auto' });
   });
});

describe('registry loader — profile entries', () => {
   const load = (entries: string) => writeRegistry(`profiles:\n${entries}\n${validKiro}`);

   it('[H] an entry with a driver and no model throws, naming the file, the entry and "model"', () => {
      const filePath = load('  Builder:\n    driver: kiro');
      const message  = invalidMessage(filePath);
      expect(message).toContain(filePath);
      expect(message).toContain('Builder');
      expect(message).toContain('model');
   });

   it.each([
      ['no keys',             '{}'],
      ['an empty model',      '{ model: "" }'],
      ['a null model',        '{ model: null }'],
      ['a numeric model',     '{ model: 3 }'],
      ['a list as the model', '{ model: [m1] }'],
      ['unknown keys only',   '{ extra: 1 }'],
   ])('an entry with %s throws, naming the entry and "model"', (_label, entry) => {
      const message = invalidMessage(load(`  Builder: ${entry}`));
      expect(message).toContain('Builder');
      expect(message).toContain('model');
   });

   it('one bad entry rejects the file, and the message names that entry only', () => {
      const message = invalidMessage(load('  Architect:\n    model: auto\n  Builder:\n    driver: kiro'));
      expect(message).toContain('Builder');
      expect(message).not.toContain('Architect');
   });

   it('valid entries load as written, each with a real model, even for a driver the registry lacks', () => {
      const config = loadRegistryConfig(load(
         '  Architect:\n    model: auto\n' +
         '  Builder:\n    model: m1\n    driver: kiro\n' +
         '  Doctor:\n    model: m1\n    driver: nonesuch',
      ));
      expect(config.profiles).toStrictEqual({
         Architect: { model: 'auto' },
         Builder:   { model: 'm1', driver: 'kiro' },
         Doctor:    { model: 'm1', driver: 'nonesuch' },
      });
      for (const entry of Object.values(config.profiles ?? {})) { expect(entry.model).not.toBe(''); }
   });
});
