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

   it('unknown driver names in the defaults and profiles are accepted unchanged', () => {
      const config = loadRegistryConfig(writeRegistry(`
preferredDriver: kriro
preferredModel:
  model: auto
  driver: kiroo
profiles:
  Builder:
    model: auto
    driver: nonesuch
drivers:
  kiro:
    module: ${FIXTURE_MODULE}
    models: [auto]
`));
      expect(config.preferredDriver).toBe('kriro');
      expect(config.preferredModel?.driver).toBe('kiroo');
      expect(config.profiles?.Builder.driver).toBe('nonesuch');
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
