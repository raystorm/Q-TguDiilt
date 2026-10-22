import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { buildDriverCatalog, DRIVER_FAILURE } from '../driver-catalog.js';
import { DriverNotInCatalogError } from '../errors.js';
import type { RegistryConfig } from '../registry.js';
import { createLogger } from '../../protocol/__tests__/agent.helpers.js';
import {
   FIXTURE_REGISTRY, configForFiles, configOf, copyFixture, entryFor, failureLogs, fakeDriver,
   fixturePath, importFrom, moduleOf, useTempDir, validSet, writeDriver,
} from './catalog-fixtures.js';

const dirOf = useTempDir();

interface Built
{
   catalog: Awaited<ReturnType<typeof buildDriverCatalog>>;
   logger:  ReturnType<typeof createLogger>;
   config:  RegistryConfig;
}

/** "good" is valid; "bad" is the module value given. Fake import. */
async function buildBad(bad: unknown, order: string[] = ['bad', 'good']): Promise<Built>
{
   const logger = createLogger();
   const { modules } = validSet('good');
   const config = configOf(order, { preferredDriver: 'good' });
   const catalog = await buildDriverCatalog({
      config, registryPath: FIXTURE_REGISTRY, logger, importModule: importFrom({ ...modules, bad }),
   });
   return { catalog, logger, config };
}

/** Real files, default import. */
async function buildFiles(modules: Record<string, string>): Promise<Built>
{
   const logger = createLogger();
   const config = configForFiles(modules);
   const catalog = await buildDriverCatalog({ config, registryPath: join(dirOf(), 'registry.yaml'), logger });
   return { catalog, logger, config };
}

function expectFailureOutcome({ catalog, logger, config }: Built, kind: string, badPath = fixturePath('bad'))
{
   expect(catalog.names()).toEqual(['good']);
   expect(() => catalog.get('bad')).toThrow(DriverNotInCatalogError);
   const logs = failureLogs(logger, 'bad');
   expect(logs).toHaveLength(1);
   expect(logs[0].data.path).toBe(badPath);
   expect(logs[0].data.kind).toBe(kind);
   expect(Object.keys(catalog.resolverConfig.drivers)).toEqual(['good']);
   expect(catalog.resolverConfig.drivers.good).toEqual(config.drivers.good);
}

describe('catalog — a driver fails a check', () => {
   it('a module file that does not exist fails that driver only', async () => {
      const good    = writeDriver(join(dirOf(), 'good.js'), 'good');
      const missing = join(dirOf(), 'missing.js');
      expectFailureOutcome(await buildFiles({ bad: missing, good }), DRIVER_FAILURE.moduleNotFound, missing);
   });

   it('a module that throws when imported fails that driver, logging the message', async () => {
      const good = writeDriver(join(dirOf(), 'good.js'), 'good');
      const bad  = copyFixture('throws-on-import.js', join(dirOf(), 'bad.js'));
      const built = await buildFiles({ bad, good });
      expectFailureOutcome(built, DRIVER_FAILURE.importFailed, bad);
      expect(JSON.stringify(failureLogs(built.logger, 'bad')[0].data)).toContain('import-boom');
   });

   it('a module without a createDriver export fails', async () => {
      expectFailureOutcome(await buildBad({ other: () => {} }), DRIVER_FAILURE.noCreateDriver);
   });

   it('a createDriver that is not a function fails', async () => {
      expectFailureOutcome(await buildBad({ createDriver: 'not a function' }), DRIVER_FAILURE.noCreateDriver);
   });

   it('a factory that throws fails, logging the message', async () => {
      const built = await buildBad({ createDriver: () => { throw new Error('boom'); } });
      expectFailureOutcome(built, DRIVER_FAILURE.factoryFailed);
      expect(JSON.stringify(failureLogs(built.logger, 'bad')[0].data)).toContain('boom');
   });

   it.each([['null', null], ['undefined', undefined], ['a string', 'text'], ['a number', 42]])(
      'a factory that returns %s fails as not a driver',
      async (_label, value) => {
         expectFailureOutcome(await buildBad({ createDriver: () => value }), DRIVER_FAILURE.notADriver);
      },
   );

   it('a driver whose name differs from its registry key fails, showing both names', async () => {
      const built = await buildBad(moduleOf(fakeDriver('other')));
      expectFailureOutcome(built, DRIVER_FAILURE.nameMismatch);
      const logged = JSON.stringify(failureLogs(built.logger, 'bad')[0].data);
      expect(logged).toContain('bad');
      expect(logged).toContain('other');
   });

   it.each([['false', false], ['absent', undefined], ['the string "true"', 'true'], ['the number 1', 1]])(
      'a driver whose supportsToolCallGovernance is %s fails',
      async (_label, value) => {
         const driver = fakeDriver('bad', { supportsToolCallGovernance: value });
         expectFailureOutcome(await buildBad(moduleOf(driver)), DRIVER_FAILURE.noGovernance);
      },
   );

   it('the failure kinds are distinct', () => {
      const kinds = Object.values(DRIVER_FAILURE);
      expect(new Set(kinds).size).toBe(kinds.length);
   });

   it('models and installed CLIs are not checked, and nothing runs', async () => {
      const alpha = fakeDriver('alpha', { execute: vi.fn(() => { throw new Error('must not run'); }) });
      const config: RegistryConfig = {
         drivers: { alpha: { ...entryFor('alpha'), models: ['auto', 'no-real-agent-offers-this'] } },
      };
      const catalog = await buildDriverCatalog({
         config, registryPath: FIXTURE_REGISTRY, logger: createLogger(),
         importModule: importFrom({ alpha: moduleOf(alpha) }),
      });
      expect(catalog.names()).toEqual(['alpha']);
      expect(alpha.execute).not.toHaveBeenCalled();
   });

   it('two failing drivers are each logged once, with their own path and kind', async () => {
      const logger = createLogger();
      const { modules } = validSet('good');
      const catalog = await buildDriverCatalog({
         config: configOf(['bad1', 'bad2', 'good']), registryPath: FIXTURE_REGISTRY, logger,
         importModule: importFrom({
            ...modules,
            bad1: { other: () => {} },
            bad2: { createDriver: () => { throw new Error('boom'); } },
         }),
      });
      expect(catalog.names()).toEqual(['good']);
      const first  = failureLogs(logger, 'bad1');
      const second = failureLogs(logger, 'bad2');
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(first[0].data).toMatchObject({ path: fixturePath('bad1'), kind: DRIVER_FAILURE.noCreateDriver });
      expect(second[0].data).toMatchObject({ path: fixturePath('bad2'), kind: DRIVER_FAILURE.factoryFailed });
   });

   it('a failed driver does not change the others', async () => {
      const built = await buildBad({ other: () => {} });
      expect(built.catalog.get('good').name).toBe('good');
      expect(built.catalog.resolverConfig.drivers.good).toEqual(built.config.drivers.good);
   });

   it.each([['first', ['bad', 'good']], ['last', ['good', 'bad']]])(
      'the failing entry listed %s gives the same outcome',
      async (_label, order) => {
         expectFailureOutcome(await buildBad({ other: () => {} }, order), DRIVER_FAILURE.noCreateDriver);
      },
   );
});
