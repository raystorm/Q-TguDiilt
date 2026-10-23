import { beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Driver } from '../governed-driver.js';
import type { RegistryConfig, RegistryDriverEntry } from '../registry.js';
import { createFakeGovernedDriver } from './fake-governed-driver.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'driver-modules');

/** Registry file path for catalogs built with a fake import: no file is read. */
export const FIXTURE_REGISTRY = '/fixture-modules/registry.yaml';

/** Absolute module path, never on disk, that the fake import serves for `name`. */
export const fixturePath = (name: string) => `/fixture-modules/${name}.js`;

export function entryFor(name: string, models: string[] = ['auto']): RegistryDriverEntry
{ return { module: fixturePath(name), models }; }

/** Registry config listing `names` in order, each served by the fake import. */
export function configOf(names: string[], extra: Partial<RegistryConfig> = {}): RegistryConfig
{
   return { drivers: Object.fromEntries(names.map(name => [name, entryFor(name)])), ...extra };
}

/** Registry config from `{ name: module path as written }`. */
export function configForFiles(modules: Record<string, string>): RegistryConfig
{
   const entries = Object.entries(modules).map(([name, module]) => [name, { module, models: ['auto'] }]);
   return { drivers: Object.fromEntries(entries) };
}

export type FakeDriver = Driver & { execute: Mock; close: Mock };

/** A fake governed driver named `name`, with spies on execute and close. */
export function fakeDriver(name: string, overrides: Record<string, unknown> = {}): FakeDriver
{
   const { driver } = createFakeGovernedDriver(name);
   return { ...driver, execute: vi.fn(driver.execute), close: vi.fn(driver.close), ...overrides } as FakeDriver;
}

/** A driver module whose `createDriver` returns `made`. */
export const moduleOf = (made: unknown) => ({ createDriver: vi.fn(() => made) });

/** Valid fake drivers and their modules, keyed by name. */
export function validSet(...names: string[])
{
   const drivers = Object.fromEntries(names.map(name => [name, fakeDriver(name)]));
   const modules = Object.fromEntries(names.map(name => [name, moduleOf(drivers[name])]));
   return { drivers, modules };
}

/** Import function serving `modules` (keyed by driver name) at their fixture paths. */
export function importFrom(modules: Record<string, unknown>)
{
   return async (path: string): Promise<unknown> => {
      const name = Object.keys(modules).find(key => fixturePath(key) === path);
      if (undefined === name) { throw new Error(`no fixture module for ${path}`); }
      return modules[name];
   };
}

/** Log entries that report `name` as a failed driver. */
export function failureLogs(logger: { entries: Array<{ data: any }> }, name: string)
{ return logger.entries.filter(entry => name === entry.data.name && undefined !== entry.data.kind); }

/** A temp folder per test (with a package marker so `.js` files load as modules), removed afterwards. */
export function useTempDir(): () => string
{
   let dir = '';
   beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'catalog-test-'));
      copyFileSync(join(FIXTURES, 'package.json'), join(dir, 'package.json'));
   });
   afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
   return () => dir;
}

export function writeFile(file: string, text: string): string
{
   mkdirSync(dirname(file), { recursive: true });
   writeFileSync(file, text);
   return file;
}

/** Writes a driver module from the template; its driver reports `name` and `marker`. */
export function writeDriver(file: string, name: string, marker: string = name): string
{
   const template = readFileSync(join(FIXTURES, 'driver.template.js'), 'utf8');
   return writeFile(file, template.replaceAll('__NAME__', name).replaceAll('__MARKER__', marker));
}

/** Copies a fixture file as it is. */
export function copyFixture(fixture: string, file: string): string
{ return writeFile(file, readFileSync(join(FIXTURES, fixture), 'utf8')); }

/** Where the recording driver template keeps its list (the key is also in the template). */
const RECORDED_CALLS = '__recordedDriverCalls';

export interface RecordedCall
{
   driver:   string;
   call:     'execute' | 'close';
   command?: string;
   model?:   string;
}

/** Every call the recording drivers received, in order. */
export function recordedCalls(): RecordedCall[]
{
   const store = globalThis as unknown as Record<string, unknown>;
   return (store[RECORDED_CALLS] ??= []) as RecordedCall[];
}

/** Empties the list. Recording drivers keep appending to the same list. */
export function forgetRecordedCalls(): void { recordedCalls().length = 0; }

/** Writes a driver module that records its calls; its driver reports `name`. */
export function writeRecordingDriver(file: string, name: string, closeFails = false): string
{
   const template = readFileSync(join(FIXTURES, 'recording-driver.template.js'), 'utf8');
   const text     = template
      .replaceAll('__NAME__', name)
      .replaceAll('__CLOSE_FAILS__', String(closeFails));
   return writeFile(file, text);
}
