import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { buildDriverCatalog, DRIVER_FAILURE } from '../driver-catalog.js';
import type { RegistryConfig } from '../registry.js';
import { createLogger } from '../../protocol/__tests__/agent.helpers.js';
import {
   FIXTURE_REGISTRY, configForFiles, copyFixture, entryFor, failureLogs, fakeDriver, importFrom,
   moduleOf, useTempDir, validSet, writeDriver,
} from './catalog-fixtures.js';

/** The kind reported for a preferred driver that the registry does not list. */
const NOT_IN_REGISTRY = 'not in registry';
const MODELS          = ['auto', 'm1'];
const dirOf           = useTempDir();

type Logger = ReturnType<typeof createLogger>;
interface Built { catalog: Awaited<ReturnType<typeof buildDriverCatalog>>; logger: Logger; }

const noCreate   = { other: () => {} };
const throwing   = { createDriver: () => { throw new Error('boom'); } };
const ungoverned = () => fakeDriver('alpha', { supportsToolCallGovernance: false });

/**
 * Fake modules that each fail a different check, by the kind they produce.
 * The failing driver is "alpha".
 */
const FAILING_MODULES: Array<[string, () => unknown]> = [
   [DRIVER_FAILURE.noCreateDriver, () => noCreate],
   [DRIVER_FAILURE.factoryFailed,  () => throwing],
   [DRIVER_FAILURE.notADriver,     () => ({ createDriver: () => null })],
   [DRIVER_FAILURE.nameMismatch,   () => moduleOf(fakeDriver('other'))],
   [DRIVER_FAILURE.noGovernance,   () => moduleOf(ungoverned())],
];

const badFile = () => join(dirOf(), 'bad.js');

/** Real files, default import: the two failures that happen before a module is usable. */
const FAILING_FILES: Array<[string, () => string]> = [
   [DRIVER_FAILURE.moduleNotFound, () => join(dirOf(), 'missing.js')],
   [DRIVER_FAILURE.importFailed,   () => copyFixture('throws-on-import.js', badFile())],
];

/** preferredDriver is "alpha", but preferredModel binds m1 to "beta". */
const BETA_BOUND: Partial<RegistryConfig> = {
   preferredDriver: 'alpha', preferredModel: { model: 'm1', driver: 'beta' },
};

/** "alpha" then "beta", both listing auto and m1. `failing` swaps in a module for a driver. */
async function build(
   extra: Partial<RegistryConfig> = {}, failing: Record<string, unknown> = {},
): Promise<Built>
{
   const logger = createLogger();
   const names  = ['alpha', 'beta'];
   const config: RegistryConfig = {
      drivers: Object.fromEntries(names.map(name => [name, entryFor(name, MODELS)])), ...extra,
   };
   const { modules } = validSet(...names.filter(name => !(name in failing)));
   const catalog = await buildDriverCatalog({
      config, registryPath: FIXTURE_REGISTRY, logger,
      importModule: importFrom({ ...modules, ...failing }),
   });
   return { catalog, logger };
}

const warnings = (logger: Logger) => logger.entries.filter(entry => 'warn' === entry.level);

const expectNotice = (notice: string | undefined, ...parts: string[]) =>
   parts.forEach(part => expect(notice).toContain(part));

function expectUnflagged({ catalog, logger }: Built, name: string, inUse: string)
{
   expect(catalog.preferred).toEqual({ name, inUse, flagged: false });
   expect(catalog.notice).toBeUndefined();
   expect(warnings(logger)).toEqual([]);
}

function expectFlagged({ catalog, logger }: Built, name: string, inUse: string, kind: string)
{
   expect(catalog.preferred).toEqual({ name, inUse, flagged: true, kind });
   const logged = warnings(logger);
   expect(logged).toHaveLength(1);
   const text = JSON.stringify(logged[0].data);
   for (const part of [name, inUse, kind]) { expect(text).toContain(part); }
}

describe('catalog — the preferred driver', () => {
   it('a working preferred driver is not flagged', async () => {
      expectUnflagged(await build({ preferredDriver: 'alpha' }), 'alpha', 'alpha');
   });

   it('preferredModel.driver takes precedence over preferredDriver', async () => {
      const { catalog } = await build(BETA_BOUND);
      expect(catalog.preferred.name).toBe('beta');
   });

   it('a failed preferredModel.driver is flagged even though preferredDriver works', async () => {
      const built = await build(BETA_BOUND, { beta: noCreate });
      expectFlagged(built, 'beta', 'alpha', DRIVER_FAILURE.noCreateDriver);
   });

   it('a failed preferredDriver that preferredModel overrides is not flagged', async () => {
      const built = await build(BETA_BOUND, { alpha: noCreate });
      expect(built.catalog.preferred).toMatchObject({ name: 'beta', flagged: false });
      expect(warnings(built.logger)).toEqual([]);
   });

   it('only preferredDriver set: that driver is preferred', async () => {
      const { catalog } = await build({ preferredDriver: 'beta' });
      expect(catalog.preferred.name).toBe('beta');
   });

   it.each([['works', {}, false], ['fails', { alpha: noCreate }, true]])(
      'neither set: the first driver listed is preferred, and it %s',
      async (_label, failing, flagged) => {
         const built = await build({}, failing);
         expect(built.catalog.preferred.name).toBe('alpha');
         expect(built.catalog.preferred.flagged).toBe(flagged);
      },
   );

   it('an unlisted preferred driver is flagged and the build still succeeds', async () => {
      const built = await build({ preferredDriver: 'alpah' });
      expect(built.catalog.names()).toEqual(['alpha', 'beta']);
      expectFlagged(built, 'alpah', 'alpha', NOT_IN_REGISTRY);
   });

   it('a typo in preferredModel.driver is flagged even if preferredDriver is valid', async () => {
      const built = await build({
         preferredDriver: 'alpha', preferredModel: { model: 'm1', driver: 'alpah' },
      });
      expectFlagged(built, 'alpah', 'alpha', NOT_IN_REGISTRY);
   });

   it('driver names match exactly', async () => {
      expectFlagged(await build({ preferredDriver: 'Alpha' }), 'Alpha', 'alpha', NOT_IN_REGISTRY);
   });

   it.each(FAILING_MODULES)(
      'a preferred driver that failed (%s) is flagged and the other driver is used',
      async (kind, makeModule) => {
         const built = await build({ preferredDriver: 'alpha' }, { alpha: makeModule() });
         expect(built.catalog.names()).toEqual(['beta']);
         expectFlagged(built, 'alpha', 'beta', kind);
      },
   );

   it.each(FAILING_FILES)(
      'a preferred driver that failed (%s) from real files is flagged',
      async (kind, badPath) => {
         const logger       = createLogger();
         const beta         = writeDriver(join(dirOf(), 'beta.js'), 'beta');
         const files        = configForFiles({ alpha: badPath(), beta });
         const config: RegistryConfig = { ...files, preferredDriver: 'alpha' };
         const registryPath = join(dirOf(), 'registry.yaml');
         const catalog      = await buildDriverCatalog({ config, registryPath, logger });
         expect(catalog.names()).toEqual(['beta']);
         expectFlagged({ catalog, logger }, 'alpha', 'beta', kind);
      },
   );

   it('the notice names the preferred driver, the driver in use and the kind', async () => {
      const typo   = await build({ preferredDriver: 'alpah' });
      const failed = await build({ preferredDriver: 'alpha' }, { alpha: noCreate });
      expectNotice(typo.catalog.notice, 'alpah', 'alpha', NOT_IN_REGISTRY);
      expectNotice(failed.catalog.notice, 'alpha', 'beta', DRIVER_FAILURE.noCreateDriver);
   });

   it('the driver in use is what the defaults pick, not the first one working', async () => {
      const config: RegistryConfig = {
         drivers: {
            a: entryFor('a', MODELS), b: entryFor('b', ['x']), c: entryFor('c', MODELS),
         },
         preferredDriver: 'a',
         preferredModel:  { model: 'm1', driver: 'a' },
      };
      const { modules } = validSet('b', 'c');
      const catalog = await buildDriverCatalog({
         config, registryPath: FIXTURE_REGISTRY, logger: createLogger(),
         importModule: importFrom({ ...modules, a: noCreate }),
      });
      expect(catalog.names()).toEqual(['b', 'c']);
      expect(catalog.preferred.inUse).toBe('c');
   });

   it('a typo and a failed driver are both reported, each once', async () => {
      const built = await build({ preferredDriver: 'alpah' }, { beta: noCreate });
      expect(built.catalog.names()).toEqual(['alpha']);
      expect(failureLogs(built.logger, 'beta')).toHaveLength(1);
      expectFlagged(built, 'alpah', 'alpha', NOT_IN_REGISTRY);
   });

   it('a missing model on a working preferred driver is not flagged', async () => {
      const built = await build({ preferredModel: { model: 'm-missing', driver: 'alpha' } });
      expectUnflagged(built, 'alpha', 'alpha');
   });

   it('the flag and notice are stable, and reading them logs nothing', async () => {
      const { catalog, logger } = await build({ preferredDriver: 'alpah' });
      const logged = logger.entries.length;
      const read   = () => ({ preferred: { ...catalog.preferred }, notice: catalog.notice });
      const first  = read();
      expect(read()).toEqual(first);
      expect(read()).toEqual(first);
      expect(logger.entries).toHaveLength(logged);
   });
});
