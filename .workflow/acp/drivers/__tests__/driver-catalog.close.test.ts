import { describe, it, expect } from 'vitest';
import { createLogger } from '../../protocol/__tests__/agent.helpers.js';
import {
   FIXTURE_REGISTRY, configOf, fakeDriver, failureLogs, importFrom, moduleOf, validSet,
} from './catalog-fixtures.js';
import { buildCatalog } from './build-catalog.js';

async function build(names: string[])
{
   const logger = createLogger();
   const { drivers, modules } = validSet(...names);
   const catalog = await buildCatalog({
      config: configOf(names), registryPath: FIXTURE_REGISTRY, logger, importModule: importFrom(modules),
   });
   return { catalog, logger, drivers };
}

const names = ['alpha', 'beta', 'gamma'];

describe('catalog — closing', () => {
   it('closeAll closes every driver once', async () => {
      const { catalog, drivers } = await build(names);
      await expect(catalog.closeAll()).resolves.toBeUndefined();
      for (const name of names) { expect(drivers[name].close).toHaveBeenCalledTimes(1); }
   });

   it('one driver failing to close does not stop the others; its error is thrown after all attempts', async () => {
      const { catalog, drivers } = await build(names);
      drivers.beta.close.mockRejectedValue(new Error('beta-boom'));
      await expect(catalog.closeAll()).rejects.toThrow('beta-boom');
      for (const name of names) { expect(drivers[name].close).toHaveBeenCalledTimes(1); }
   });

   it('with several failures all are attempted and the first (registry order) is thrown', async () => {
      const { catalog, drivers } = await build(names);
      drivers.alpha.close.mockRejectedValue(new Error('a-boom'));
      drivers.gamma.close.mockRejectedValue(new Error('g-boom'));
      await expect(catalog.closeAll()).rejects.toThrow('a-boom');
      for (const name of names) { expect(drivers[name].close).toHaveBeenCalledTimes(1); }
   });

   it('closeAll twice in a row is safe', async () => {
      const { catalog } = await build(names);
      await expect(catalog.closeAll()).resolves.toBeUndefined();
      await expect(catalog.closeAll()).resolves.toBeUndefined();
   });

   it('concurrent closeAll calls are safe', async () => {
      const { catalog, drivers } = await build(names);
      await expect(Promise.all([catalog.closeAll(), catalog.closeAll()])).resolves.toEqual([undefined, undefined]);
      for (const name of names) { expect(drivers[name].close).toHaveBeenCalledTimes(1); }
   });

   it('a driver returned but rejected is closed once, and the build succeeds', async () => {
      const logger = createLogger();
      const reject = fakeDriver('other');
      const { modules } = validSet('good');
      const catalog = await buildCatalog({
         config: configOf(['bad', 'good']), registryPath: FIXTURE_REGISTRY, logger,
         importModule: importFrom({ ...modules, bad: moduleOf(reject) }),
      });
      expect(catalog.names()).toEqual(['good']);
      expect(reject.close).toHaveBeenCalledTimes(1);
   });

   it('an error from closing a rejected driver is logged, not thrown', async () => {
      const logger = createLogger();
      const reject = fakeDriver('other');
      reject.close.mockRejectedValue(new Error('close-boom'));
      const { modules } = validSet('good');
      const catalog = await buildCatalog({
         config: configOf(['bad', 'good']), registryPath: FIXTURE_REGISTRY, logger,
         importModule: importFrom({ ...modules, bad: moduleOf(reject) }),
      });
      expect(catalog.names()).toEqual(['good']);
      const mentions = logger.entries.filter(entry => 'bad' === entry.data.name
                                                      && JSON.stringify(entry.data).includes('close-boom'));
      expect(mentions).toHaveLength(1);
      expect(failureLogs(logger, 'bad')).toHaveLength(1);
   });

   it('closing a catalog that never ran a turn does nothing harmful', async () => {
      const { catalog, drivers } = await build(names);
      await expect(catalog.closeAll()).resolves.toBeUndefined();
      for (const name of names) { expect(drivers[name].execute).not.toHaveBeenCalled(); }
   });
});
