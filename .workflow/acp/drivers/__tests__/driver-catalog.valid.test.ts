import { describe, it, expect } from 'vitest';
import { DriverNotInCatalogError } from '../errors.js';
import { createLogger } from '../../protocol/__tests__/agent.helpers.js';
import { FIXTURE_REGISTRY, configOf, importFrom, validSet } from './catalog-fixtures.js';
import { buildCatalog } from './build-catalog.js';

async function build(names: string[])
{
   const logger = createLogger();
   const { drivers, modules } = validSet(...names);
   const catalog = await buildCatalog({
      config: configOf(names), registryPath: FIXTURE_REGISTRY, logger, importModule: importFrom(modules),
   });
   return { catalog, logger, drivers, modules };
}

describe('catalog — every driver valid', () => {
   it('loads every driver in registry order and logs no failure', async () => {
      const { catalog, logger, drivers } = await build(['alpha', 'beta']);
      expect(catalog.names()).toEqual(['alpha', 'beta']);
      expect(catalog.get('alpha')).toBe(drivers.alpha);
      expect(catalog.get('beta')).toBe(drivers.beta);
      expect(logger.entries.filter(entry => undefined !== entry.data.kind)).toEqual([]);
      expect(logger.entries.filter(entry => 'warn' === entry.level)).toEqual([]);
      expect(catalog.preferred.flagged).toBe(false);
      expect(catalog.notice).toBeUndefined();
   });

   it('calls each factory once, with the logger and the diagnostics', async () => {
      const { logger, modules } = await build(['alpha', 'beta']);
      for (const name of ['alpha', 'beta']) {
         expect(modules[name].createDriver).toHaveBeenCalledTimes(1);
         expect(modules[name].createDriver)
            .toHaveBeenCalledWith({ logger, diagnostics: expect.anything() });
      }
   });

   it('get returns the same instance every time', async () => {
      const { catalog } = await build(['alpha']);
      expect(catalog.get('alpha')).toBe(catalog.get('alpha'));
   });

   it('get for an unknown name throws the named error, including the name', async () => {
      const { catalog } = await build(['alpha', 'beta']);
      expect(() => catalog.get('gamma')).toThrow(DriverNotInCatalogError);
      expect(() => catalog.get('gamma')).toThrow('gamma');
   });

   it('building the catalog runs nothing', async () => {
      const { drivers } = await build(['alpha']);
      expect(drivers.alpha.execute).not.toHaveBeenCalled();
   });

   it('names lists the working drivers in registry order', async () => {
      const { catalog } = await build(['zeta', 'alpha', 'mid']);
      expect(catalog.names()).toEqual(['zeta', 'alpha', 'mid']);
   });
});
