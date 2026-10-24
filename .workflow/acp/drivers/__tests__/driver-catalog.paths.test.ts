import { describe, it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { DRIVER_FAILURE } from '../driver-catalog.js';
import { createLogger } from '../../protocol/__tests__/agent.helpers.js';
import { configForFiles, failureLogs, useTempDir, writeDriver } from './catalog-fixtures.js';
import { buildCatalog } from './build-catalog.js';

const dirOf      = useTempDir();
const registryIn = (dir: string) => join(dir, 'conf', 'registry.yaml');

/** Default import; module paths as written in the registry. */
async function buildAt(registryPath: string, modules: Record<string, string>)
{
   const logger  = createLogger();
   const catalog = await buildCatalog({ config: configForFiles(modules), registryPath, logger });
   return { catalog, logger };
}

describe('catalog — module paths', () => {
   it('a relative path is resolved from the registry file folder, not the working directory', async () => {
      const file = writeDriver(join(dirOf(), 'conf', 'mods', 'alpha.js'), 'alpha');
      const { catalog, logger } = await buildAt(registryIn(dirOf()), { alpha: './mods/alpha.js' });
      expect(catalog.names()).toEqual(['alpha']);
      const paths = logger.entries.filter(entry => 'alpha' === entry.data.name).map(entry => entry.data.path);
      expect(paths).toEqual([file]);
   });

   it('the same relative path in two registries gives two different modules', async () => {
      const markers: Record<string, unknown> = {};
      for (const label of ['one', 'two']) {
         writeDriver(join(dirOf(), label, 'mods', 'alpha.js'), 'alpha', label);
         const { catalog } = await buildAt(join(dirOf(), label, 'registry.yaml'), { alpha: './mods/alpha.js' });
         markers[label] = (catalog.get('alpha') as any).marker;
      }
      expect(markers).toEqual({ one: 'one', two: 'two' });
   });

   it('an absolute path is accepted as written', async () => {
      const file = writeDriver(join(dirOf(), 'elsewhere', 'alpha.js'), 'alpha');
      const { catalog } = await buildAt(registryIn(dirOf()), { alpha: file });
      expect(catalog.names()).toEqual(['alpha']);
   });

   it('a path with parent segments works', async () => {
      writeDriver(join(dirOf(), 'shared', 'alpha.js'), 'alpha');
      const registryPath = join(dirOf(), 'a', 'b', 'registry.yaml');
      const { catalog } = await buildAt(registryPath, { alpha: '../../shared/alpha.js' });
      expect(catalog.names()).toEqual(['alpha']);
   });

   it("a user's driver outside the engine's files loads like a built-in one", async () => {
      const file = writeDriver(join(dirOf(), 'user-drivers', 'mine.js'), 'mine');
      const { catalog } = await buildAt(registryIn(dirOf()), { mine: file });
      expect(catalog.names()).toEqual(['mine']);
      expect(catalog.get('mine').name).toBe('mine');
   });

   it('the logged path is absolute: the registry folder joined with the relative path', async () => {
      const good = writeDriver(join(dirOf(), 'good.js'), 'good');
      const { logger } = await buildAt(registryIn(dirOf()), { good, alpha: './nope/alpha.js' });
      const path = failureLogs(logger, 'alpha')[0].data.path;
      expect(isAbsolute(path)).toBe(true);
      expect(path).toBe(join(dirOf(), 'conf', 'nope', 'alpha.js'));
   });

   it('a registry path relative to the working directory gives the same resolved paths', async () => {
      const good    = writeDriver(join(dirOf(), 'good.js'), 'good');
      const modules = { good, alpha: './nope/alpha.js' };
      const viaAbsolute = await buildAt(registryIn(dirOf()), modules);
      const relativeRegistry = relative(process.cwd(), registryIn(dirOf()));
      expect(isAbsolute(relativeRegistry)).toBe(false);
      const viaRelative = await buildAt(relativeRegistry, modules);
      expect(failureLogs(viaRelative.logger, 'alpha')[0].data.path)
         .toBe(failureLogs(viaAbsolute.logger, 'alpha')[0].data.path);
   });

   it('a module path that is a folder fails that driver only', async () => {
      const good   = writeDriver(join(dirOf(), 'good.js'), 'good');
      const folder = join(dirOf(), 'folder');
      mkdirSync(folder);
      const { catalog, logger } = await buildAt(registryIn(dirOf()), { good, folder });
      expect(catalog.names()).toEqual(['good']);
      expect([DRIVER_FAILURE.moduleNotFound, DRIVER_FAILURE.importFailed])
         .toContain(failureLogs(logger, 'folder')[0].data.kind);
   });
});
