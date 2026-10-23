import { describe, it, expect } from 'vitest';
import { buildDriverCatalog, type DriverCatalog } from '../driver-catalog.js';
import type { RegistryConfig } from '../registry.js';
import { createDispatchResolver, resolveRegistryDefaults } from '../../modelResolver/resolver.js';
import { createLogger } from '../../protocol/__tests__/agent.helpers.js';
import { FIXTURE_REGISTRY, entryFor, fixturePath, importFrom, validSet } from './catalog-fixtures.js';
import { DEFAULT_CASES, registryOf } from './registry-fixtures.js';

function configWith(extra: Partial<RegistryConfig> = {}): RegistryConfig
{
   const entry = (name: string, models: string[]) => ({ module: fixturePath(name), models });
   return {
      drivers: {
         bad:   entry('bad',   ['auto', 'm1', 'm2', 'm-only-bad']),
         good:  entry('good',  ['auto', 'm1']),
         other: entry('other', ['auto', 'm2']),
      },
      ...extra,
   };
}

async function build(extra: Partial<RegistryConfig> = {}, badFails = true)
{
   const config = configWith(extra);
   const { modules } = validSet('good', 'other', ...(badFails ? [] : ['bad']));
   const catalog = await buildDriverCatalog({
      config, registryPath: FIXTURE_REGISTRY, logger: createLogger(),
      importModule: importFrom(badFails ? { ...modules, bad: { other: () => {} } } : modules),
   });
   return { config, catalog };
}

const resolverOn = (config: RegistryConfig) => createDispatchResolver({ config, logger: createLogger() });

const inUseOf = (catalog: DriverCatalog) =>
   ({ model: catalog.preferred.inUseModel, driver: catalog.preferred.inUse });

describe('catalog — what the dispatch resolver sees', () => {
   it('does not mutate the original config', async () => {
      const original = configWith({ preferred: { driver: 'good' } });
      const copy     = structuredClone(original);
      const catalog  = await buildDriverCatalog({
         config: original, registryPath: FIXTURE_REGISTRY, logger: createLogger(),
         importModule: importFrom({ ...validSet('good', 'other').modules, bad: { other: () => {} } }),
      });
      expect(original).toEqual(copy);
      expect(catalog.resolverConfig).not.toBe(original);
      expect(catalog.resolverConfig.drivers.bad).toBeUndefined();
   });

   it('a failed preferred driver is skipped', async () => {
      const { catalog } = await build({ preferred: { driver: 'bad', model: 'm1' } });
      const result = resolverOn(catalog.resolverConfig).resolve();
      expect(result.driver).toBe('good');
      expect(result.model).toBe('m1');
   });

   it('a model that no working driver lists falls back to auto on a working driver', async () => {
      const { catalog } = await build({ preferred: { driver: 'bad', model: 'm-only-bad' } });
      const result = resolverOn(catalog.resolverConfig).resolve();
      expect(result.model).toBe('auto');
      expect(['good', 'other']).toContain(result.driver);
   });

   it('defaults, profiles and fallbackMode pass through unchanged', async () => {
      const extra: Partial<RegistryConfig> = {
         preferred:    { driver: 'bad', model: 'm1' },
         profiles:     { Builder: { model: 'm2', driver: 'bad' } },
         fallbackMode: 'fail-fast',
      };
      const { catalog } = await build(extra);
      expect(catalog.resolverConfig.preferred).toEqual(extra.preferred);
      expect(catalog.resolverConfig.profiles).toEqual(extra.profiles);
      expect(catalog.resolverConfig.fallbackMode).toBe(extra.fallbackMode);
   });

   it('a profile naming a failed driver still resolves to a working driver that lists its model', async () => {
      const { catalog } = await build({ profiles: { Builder: { model: 'm2', driver: 'bad' } } });
      const result = resolverOn(catalog.resolverConfig).resolve('Builder');
      expect(result.driver).toBe('other');
      expect(result.model).toBe('m2');
   });

   it('a working preferred driver is returned', async () => {
      const { catalog } = await build({ preferred: { driver: 'good' } }, false);
      expect(resolverOn(catalog.resolverConfig).resolve().driver).toBe('good');
   });

   it.each(DEFAULT_CASES)(
      'the catalog and the resolver agree on the defaults: %s',
      async (_label, preferred, models, pair) => {
         const config  = registryOf(models, preferred, {}, entryFor);
         const catalog = await buildDriverCatalog({
            config, registryPath: FIXTURE_REGISTRY, logger: createLogger(),
            importModule: importFrom(validSet(...Object.keys(models)).modules),
         });
         const { model, driver } = resolverOn(catalog.resolverConfig).resolve();
         expect({ model, driver }).toEqual(pair);
         expect(inUseOf(catalog)).toEqual(pair);
         expect(resolveRegistryDefaults(config)).toEqual(pair);
      },
   );

   it('the catalog and the resolver agree when a driver failed', async () => {
      const { catalog } = await build({ preferred: { driver: 'bad', model: 'm2' } });
      const { model, driver } = resolverOn(catalog.resolverConfig).resolve();
      expect(inUseOf(catalog)).toEqual({ model, driver });
      expect({ model, driver }).toEqual({ model: 'm2', driver: 'other' });
   });
});
