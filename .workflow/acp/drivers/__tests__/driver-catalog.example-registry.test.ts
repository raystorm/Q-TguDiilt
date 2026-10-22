import { beforeEach, describe, it, expect, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnAgent } from '../acp-driver-core/connect.js';
import { buildDriverCatalog } from '../driver-catalog.js';
import { declaresToolCallGovernance } from '../governed-driver.js';
import { loadRegistryConfig } from '../registry.js';
import { createDispatchResolver } from '../../modelResolver/resolver.js';
import { createLogger } from '../../protocol/__tests__/agent.helpers.js';
import { useTempDir, writeDriver } from './catalog-fixtures.js';

vi.mock('../acp-driver-core/connect.js', async importOriginal => ({
   ...(await importOriginal<typeof import('../acp-driver-core/connect.js')>()),
   spawnAgent: vi.fn(),
}));

/** The shipped example. Never a local copy. */
const EXAMPLE = join(dirname(fileURLToPath(import.meta.url)), '..', 'registry.example.yaml');
const dirOf   = useTempDir();

beforeEach(() => { vi.mocked(spawnAgent).mockReset(); });

/** The example registry through the real import. */
async function buildExample(config = loadRegistryConfig(EXAMPLE))
{
   const logger  = createLogger();
   const catalog = await buildDriverCatalog({ config, registryPath: EXAMPLE, logger });
   return { catalog, logger };
}

const problems = (logger: ReturnType<typeof createLogger>) =>
   logger.entries.filter(entry => ['warn', 'error'].includes(entry.level));

describe('the shipped example registry', () => {
   it('loads, with a module on every entry and a preferred model', () => {
      const config = loadRegistryConfig(EXAMPLE);
      expect(Object.keys(config.drivers)).toEqual(expect.arrayContaining(['kiro', 'copilot']));
      expect(config.drivers['my-local-model']).toBeUndefined();
      for (const { module } of Object.values(config.drivers)) {
         expect(module.trim()).not.toBe('');
      }
      expect(config.preferredModel).toBeDefined();
   });

   it('builds both built-in drivers through the real import and logs no problem', async () => {
      const { catalog, logger } = await buildExample();
      expect(catalog.names()).toEqual(['kiro', 'copilot']);
      expect(problems(logger)).toEqual([]);
      expect(catalog.preferred.flagged).toBe(false);
      expect(catalog.notice).toBeUndefined();
   });

   it('each built-in driver is named for its key, governed, and not started', async () => {
      const { catalog } = await buildExample();
      for (const name of ['kiro', 'copilot']) {
         expect(catalog.get(name).name).toBe(name);
         expect(declaresToolCallGovernance(catalog.get(name))).toBe(true);
      }
      expect(spawnAgent).not.toHaveBeenCalled();
   });

   it('the mock reaches drivers loaded by the real import: a turn calls it', async () => {
      vi.mocked(spawnAgent).mockRejectedValue(new Error('mock reached'));
      const { catalog } = await buildExample();
      await expect(catalog.get('kiro').execute('go')).rejects.toThrow();
      expect(spawnAgent).toHaveBeenCalledTimes(1);
      await catalog.closeAll();
   });

   it('its defaults select a working driver: the preferred model on its driver', async () => {
      const { catalog } = await buildExample();
      const resolver = createDispatchResolver({
         config: catalog.resolverConfig, logger: createLogger(),
      });
      const result = resolver.resolve('Anyone');
      const { preferredModel } = loadRegistryConfig(EXAMPLE);
      expect({ model: result.model, driver: result.driver }).toEqual(preferredModel);
      expect(catalog.preferred.inUse).toBe(result.driver);
   });

   it('a user entry added to the example loads next to the built-ins', async () => {
      const config = loadRegistryConfig(EXAMPLE);
      const mine   = writeDriver(join(dirOf(), 'mine.js'), 'mine');
      config.drivers.mine = { module: mine, models: ['auto'] };
      const { catalog, logger } = await buildExample(config);
      expect(catalog.names()).toEqual(['kiro', 'copilot', 'mine']);
      expect(problems(logger)).toEqual([]);
   });
});
