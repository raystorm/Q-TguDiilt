import { beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { buildDriverCatalog } from '../driver-catalog.js';
import { createLogger } from '../../protocol/__tests__/agent.helpers.js';
import { createDiagnostics } from '../acp-driver-core/__tests__/acp-driver.helpers.js';
import {
   FIXTURE_REGISTRY, configForFiles, configOf, forgetRecordedCalls, importFrom, recordedCalls,
   useTempDir, validSet, writeRecordingDriver,
} from './catalog-fixtures.js';

const dirOf = useTempDir();
beforeEach(() => { forgetRecordedCalls(); });

/** What the catalog passed to a factory on its first call. */
const argOf = (module: { createDriver: { mock: { calls: unknown[][] } } }) =>
   module.createDriver.mock.calls[0][0] as Record<string, unknown>;

describe('catalog — diagnostics', () => {
   it('[H] hands the same diagnostics to every driver, once each', async () => {
      const logger      = createLogger();
      const diagnostics = createDiagnostics();
      const { modules } = validSet('alpha', 'beta');
      await buildDriverCatalog({
         config: configOf(['alpha', 'beta']), registryPath: FIXTURE_REGISTRY, logger, diagnostics,
         importModule: importFrom(modules),
      });
      for (const name of ['alpha', 'beta']) {
         expect(modules[name].createDriver).toHaveBeenCalledTimes(1);
         expect(argOf(modules[name]).logger).toBe(logger);
         expect(argOf(modules[name]).diagnostics).toBe(diagnostics);
      }
   });

   it('a driver module that ignores the argument loads and serves a turn', async () => {
      const file    = writeRecordingDriver(join(dirOf(), 'solo.js'), 'solo');
      const catalog = await buildDriverCatalog({
         config: configForFiles({ solo: file }), registryPath: join(dirOf(), 'registry.yaml'),
         logger: createLogger(), diagnostics: createDiagnostics(),
      });
      expect(catalog.names()).toEqual(['solo']);
      expect((await catalog.get('solo').execute('go')).text).toBe('ok');
      expect(recordedCalls()).toEqual([{ driver: 'solo', call: 'execute', command: 'go' }]);
   });
});
