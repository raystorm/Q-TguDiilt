import { describe, it, expect } from 'vitest';
import { buildDriverCatalog, DRIVER_FAILURE } from '../driver-catalog.js';
import { DriverCatalogBuildError } from '../errors.js';
import type { RegistryConfig } from '../registry.js';
import { resolveRegistry } from '../../modelResolver/resolver.js';
import { createLogger } from '../../protocol/__tests__/agent.helpers.js';
import {
   FIXTURE_REGISTRY, configOf, entryFor, failureLogs, fixturePath, importFrom, validSet,
} from './catalog-fixtures.js';

const noCreate = { other: () => {} };
const throwing = { createDriver: () => { throw new Error('boom'); } };

function build(config: RegistryConfig, modules: Record<string, unknown>, logger = createLogger())
{ return buildDriverCatalog({ config, registryPath: FIXTURE_REGISTRY, logger, importModule: importFrom(modules) }); }

async function rejection(promise: Promise<unknown>): Promise<DriverCatalogBuildError>
{
   try { await promise; }
   catch (err) {
      expect(err).toBeInstanceOf(DriverCatalogBuildError);
      return err as DriverCatalogBuildError;
   }
   throw new Error('expected the build to reject');
}

/** The resolver's own reason when the defaults of `config` cannot resolve. */
function resolverReason(config: RegistryConfig): string
{
   try { resolveRegistry(config); }
   catch (err) { return (err as Error).message; }
   throw new Error('expected the defaults not to resolve');
}

/** One driver, "solo", with a model list that has no "auto". */
const soloOnly = (): RegistryConfig => ({ drivers: { solo: { ...entryFor('solo'), models: ['m-custom'] } } });

describe('catalog — nothing usable, so the build fails', () => {
   it('every driver fails: rejects listing each failure and how to fix it, each logged once', async () => {
      const logger = createLogger();
      const error  = await rejection(build(configOf(['bad1', 'bad2']), { bad1: noCreate, bad2: throwing }, logger));
      expect(error.failures).toEqual([
         { name: 'bad1', path: fixturePath('bad1'), kind: DRIVER_FAILURE.noCreateDriver },
         { name: 'bad2', path: fixturePath('bad2'), kind: DRIVER_FAILURE.factoryFailed },
      ]);
      for (const failure of error.failures) {
         expect(error.message).toContain(failure.name);
         expect(error.message).toContain(failure.path);
         expect(error.message).toContain(failure.kind);
         expect(failureLogs(logger, failure.name)).toHaveLength(1);
      }
      expect(error.message).toContain('module paths');
   });

   it('a single-driver registry whose driver fails rejects, listing it', async () => {
      const error = await rejection(build(configOf(['bad']), { bad: noCreate }));
      expect(error.failures.map(failure => failure.name)).toEqual(['bad']);
   });

   it('an empty drivers map rejects, saying the registry lists no drivers', async () => {
      const error = await rejection(build({ drivers: {} }, {}));
      expect(error.failures).toEqual([]);
      expect(error.message).toContain('no drivers');
   });

   it('defaults that cannot select a working driver reject with the resolver reason', async () => {
      const { modules } = validSet('solo');
      const error = await rejection(build(soloOnly(), modules));
      expect(error.message).toContain('defaults');
      expect(error.message).toContain(resolverReason(soloOnly()));
   });

   it('defaults that cannot resolve after a failure reject with both the failure and the reason', async () => {
      const config: RegistryConfig = {
         drivers: { bad: entryFor('bad'), solo: { ...entryFor('solo'), models: ['m-custom'] } },
      };
      const { modules } = validSet('solo');
      const error = await rejection(build(config, { ...modules, bad: noCreate }));
      expect(error.failures.map(failure => failure.name)).toEqual(['bad']);
      expect(error.message).toContain('bad');
      expect(error.message).toContain(DRIVER_FAILURE.noCreateDriver);
      expect(error.message).toContain(resolverReason(soloOnly()));
   });

   it('drivers created before a failed build are closed once', async () => {
      const { drivers, modules } = validSet('solo');
      await rejection(build(soloOnly(), modules));
      expect(drivers.solo.close).toHaveBeenCalledTimes(1);

      const second = validSet('solo');
      const config: RegistryConfig = {
         drivers: { bad: entryFor('bad'), solo: { ...entryFor('solo'), models: ['m-custom'] } },
      };
      await rejection(build(config, { ...second.modules, bad: noCreate }));
      expect(second.drivers.solo.close).toHaveBeenCalledTimes(1);
   });

   it('a named model that is missing but "auto" is listed is not a failure', async () => {
      const { modules } = validSet('solo');
      const config: RegistryConfig = {
         drivers:        { solo: entryFor('solo') },
         preferredModel: { model: 'm-missing', driver: 'solo' },
      };
      const catalog = await build(config, modules);
      expect(catalog.names()).toEqual(['solo']);
      expect(catalog.preferred.inUse).toBe('solo');
   });
});
