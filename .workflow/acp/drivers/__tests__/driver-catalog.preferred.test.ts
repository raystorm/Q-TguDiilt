import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { buildDriverCatalog, DRIVER_FAILURE } from '../driver-catalog.js';
import type { PreferredDefaults, RegistryConfig } from '../registry.js';
import { createLogger } from '../../protocol/__tests__/agent.helpers.js';
import {
   FIXTURE_REGISTRY, FakeDriver, configForFiles, copyFixture, entryFor, failureLogs,
   fakeDriver, importFrom, moduleOf, useTempDir, validSet, writeDriver,
} from './catalog-fixtures.js';
import { INHERITED_NAMES, ModelLists, registryOf } from './registry-fixtures.js';

/** The kind reported for a preferred driver that the registry does not list. */
const NOT_IN_REGISTRY = 'not in registry';
/** "alpha" lists auto and m1; "beta" also lists m3. */
const MODELS: ModelLists = { alpha: ['auto', 'm1'], beta: ['auto', 'm1', 'm3'] };
/** As above, but "alpha" has no auto. */
const ALPHA_WITHOUT_AUTO: ModelLists = { alpha: ['m1'], beta: ['auto', 'm1', 'm3'] };
const dirOf = useTempDir();

type Logger = ReturnType<typeof createLogger>;
interface Built
{
   catalog: Awaited<ReturnType<typeof buildDriverCatalog>>;
   logger:  Logger;
   drivers: Record<string, FakeDriver>;
}
type Result = Pick<Built, 'catalog' | 'logger'>;
/** What the catalog reports about the preferred driver, apart from the flag. */
interface Expected { name: string; model?: string; inUse: string; inUseModel: string; }

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

/** Every driver in `models` is valid, except those with a module in `failing`. Fake import. */
async function build(
   preferred?: PreferredDefaults, failing: Record<string, unknown> = {}, models: ModelLists = MODELS,
): Promise<Built>
{
   const logger = createLogger();
   const config = registryOf(models, preferred, {}, entryFor);
   const { drivers, modules } = validSet(...Object.keys(models).filter(name => !(name in failing)));
   const catalog = await buildDriverCatalog({
      config, registryPath: FIXTURE_REGISTRY, logger, importModule: importFrom({ ...modules, ...failing }),
   });
   return { catalog, logger, drivers };
}

const warnings = (logger: Logger) => logger.entries.filter(entry => 'warn' === entry.level);

const expectNotice = (notice: string | undefined, ...parts: string[]) =>
   parts.forEach(part => expect(notice).toContain(part));

function expectUnflagged({ catalog, logger }: Result, expected: Expected)
{
   expect(catalog.preferred).toEqual({ ...expected, flagged: false });
   expect(catalog.notice).toBeUndefined();
   expect(warnings(logger)).toEqual([]);
}

/** Flagged: the report, one warning and the notice all carry the same facts. */
function expectFlagged({ catalog, logger }: Result, expected: Expected, kind: string)
{
   expect(catalog.preferred).toEqual({ ...expected, flagged: true, kind });
   const parts = [expected.name, expected.model, expected.inUse, expected.inUseModel, kind]
      .filter((part): part is string => undefined !== part);
   expectNotice(catalog.notice, ...parts);
   const logged = warnings(logger);
   expect(logged).toHaveLength(1);
   for (const part of parts) { expect(JSON.stringify(logged[0].data)).toContain(part); }
}

describe('catalog — the preferred driver', () => {
   it('a working preferred pair is not flagged', async () => {
      const built = await build({ driver: 'alpha', model: 'm1' });
      expectUnflagged(built, { name: 'alpha', model: 'm1', inUse: 'alpha', inUseModel: 'm1' });
   });

   it('a driver only: auto on that driver, not flagged', async () => {
      const built = await build({ driver: 'beta' });
      expectUnflagged(built, { name: 'beta', inUse: 'beta', inUseModel: 'auto' });
   });

   it('no preferred model, no model check', async () => {
      const built = await build({ driver: 'alpha' }, {}, { alpha: ['auto'], beta: MODELS.beta });
      expectUnflagged(built, { name: 'alpha', inUse: 'alpha', inUseModel: 'auto' });
   });

   it.each([['works', {}, false], ['fails', { alpha: noCreate }, true]])(
      'no preferred: the first driver listed is preferred, and it %s',
      async (_label, failing, flagged) => {
         const built = await build(undefined, failing);
         expect(built.catalog.preferred.name).toBe('alpha');
         expect(built.catalog.preferred.flagged).toBe(flagged);
      },
   );

   it('an unlisted preferred driver is flagged and the build still succeeds', async () => {
      const built = await build({ driver: 'alpah' });
      expect(built.catalog.names()).toEqual(['alpha', 'beta']);
      expectFlagged(built, { name: 'alpah', inUse: 'alpha', inUseModel: 'auto' }, NOT_IN_REGISTRY);
   });

   it('driver names match exactly', async () => {
      const built = await build({ driver: 'Alpha' });
      expectFlagged(built, { name: 'Alpha', inUse: 'alpha', inUseModel: 'auto' }, NOT_IN_REGISTRY);
   });

   it.each(INHERITED_NAMES)('an inherited name ("%s") as the preferred driver is flagged', async name => {
      const built = await build({ driver: name });
      expectFlagged(built, { name, inUse: 'alpha', inUseModel: 'auto' }, NOT_IN_REGISTRY);
   });

   it.each(FAILING_MODULES)(
      'a preferred driver that failed (%s) is flagged and the other driver is used',
      async (kind, makeModule) => {
         const built = await build({ driver: 'alpha', model: 'm1' }, { alpha: makeModule() });
         expect(built.catalog.names()).toEqual(['beta']);
         expectFlagged(built, { name: 'alpha', model: 'm1', inUse: 'beta', inUseModel: 'm1' }, kind);
      },
   );

   it.each(FAILING_FILES)(
      'a preferred driver that failed (%s) from real files is flagged',
      async (kind, badPath) => {
         const logger       = createLogger();
         const beta         = writeDriver(join(dirOf(), 'beta.js'), 'beta');
         const files        = configForFiles({ alpha: badPath(), beta });
         const config: RegistryConfig = { ...files, preferred: { driver: 'alpha' } };
         const registryPath = join(dirOf(), 'registry.yaml');
         const catalog      = await buildDriverCatalog({ config, registryPath, logger });
         expect(catalog.names()).toEqual(['beta']);
         expectFlagged({ catalog, logger }, { name: 'alpha', inUse: 'beta', inUseModel: 'auto' }, kind);
      },
   );

   it('the driver in use is what the defaults pick, not the first one working', async () => {
      const models: ModelLists = { a: ['auto', 'm1'], b: ['x'], c: ['auto', 'm1'] };
      const { catalog } = await build({ driver: 'a', model: 'm1' }, { a: noCreate }, models);
      expect(catalog.names()).toEqual(['b', 'c']);
      expect(catalog.preferred).toMatchObject({ inUse: 'c', inUseModel: 'm1' });
   });

   it('a typo and a failed driver are both reported, each once', async () => {
      const built = await build({ driver: 'alpah' }, { beta: noCreate });
      expect(built.catalog.names()).toEqual(['alpha']);
      expect(failureLogs(built.logger, 'beta')).toHaveLength(1);
      expectFlagged(built, { name: 'alpah', inUse: 'alpha', inUseModel: 'auto' }, NOT_IN_REGISTRY);
   });

   it('the flag and notice are stable, and reading them logs nothing', async () => {
      const { catalog, logger } = await build({ driver: 'alpah' });
      const logged = logger.entries.length;
      const read   = () => ({ preferred: { ...catalog.preferred }, notice: catalog.notice });
      const first  = read();
      expect(read()).toEqual(first);
      expect(read()).toEqual(first);
      expect(logger.entries).toHaveLength(logged);
   });

   it('a flagged catalog still serves and closes its working drivers', async () => {
      const { catalog, drivers } = await build({ driver: 'alpha', model: 'm9' });
      expect(catalog.preferred.flagged).toBe(true);
      expect(catalog.get('alpha')).toBe(drivers.alpha);
      expect(catalog.get('beta')).toBe(drivers.beta);
      await catalog.closeAll();
      expect(drivers.alpha.close).toHaveBeenCalledTimes(1);
      expect(drivers.beta.close).toHaveBeenCalledTimes(1);
   });
});

describe('catalog — the preferred model', () => {
   const NOT_LISTED = DRIVER_FAILURE.modelNotListed;

   it('a model its driver does not list is flagged; a driver that lists it is used', async () => {
      const built = await build({ driver: 'alpha', model: 'm3' });
      expect(built.catalog.names()).toEqual(['alpha', 'beta']);
      expectFlagged(built, { name: 'alpha', model: 'm3', inUse: 'beta', inUseModel: 'm3' },
                    NOT_LISTED);
   });

   it('a model nobody lists is flagged; auto on the preferred driver is used', async () => {
      const built = await build({ driver: 'alpha', model: 'm9' });
      expectFlagged(built, { name: 'alpha', model: 'm9', inUse: 'alpha', inUseModel: 'auto' },
                    NOT_LISTED);
   });

   it('a model nobody lists and a preferred driver without auto: auto elsewhere', async () => {
      const built = await build({ driver: 'alpha', model: 'm9' }, {}, ALPHA_WITHOUT_AUTO);
      expectFlagged(built, { name: 'alpha', model: 'm9', inUse: 'beta', inUseModel: 'auto' },
                    NOT_LISTED);
   });

   it('the model rule applies to auto too', async () => {
      const built = await build({ driver: 'alpha', model: 'auto' }, {}, ALPHA_WITHOUT_AUTO);
      expectFlagged(built, { name: 'alpha', model: 'auto', inUse: 'beta', inUseModel: 'auto' },
                    NOT_LISTED);
   });

   it('a driver problem and a model problem together: the driver kind wins, one warning', async () => {
      const built = await build({ driver: 'alpha', model: 'm9' }, { alpha: noCreate });
      expectFlagged(built, { name: 'alpha', model: 'm9', inUse: 'beta', inUseModel: 'auto' },
                    DRIVER_FAILURE.noCreateDriver);
   });

   it('a typo in the driver with a model set: the driver kind, the model still resolves', async () => {
      const built = await build({ driver: 'alpah', model: 'm3' });
      expectFlagged(built, { name: 'alpah', model: 'm3', inUse: 'beta', inUseModel: 'm3' },
                    NOT_IN_REGISTRY);
   });

   it('a failed preferred driver whose model is listed elsewhere', async () => {
      const built = await build({ driver: 'alpha', model: 'm3' }, { alpha: noCreate });
      expectFlagged(built, { name: 'alpha', model: 'm3', inUse: 'beta', inUseModel: 'm3' },
                    DRIVER_FAILURE.noCreateDriver);
   });

   it('a near-miss model is reported as written, not corrected', async () => {
      const built = await build({ driver: 'alpha', model: 'M1' });
      expectFlagged(built, { name: 'alpha', model: 'M1', inUse: 'alpha', inUseModel: 'auto' },
                    NOT_LISTED);
   });

   it('a listed model is not flagged whatever the registry order', async () => {
      const reversed: ModelLists = { beta: MODELS.beta, alpha: MODELS.alpha };
      const built = await build({ driver: 'alpha', model: 'm1' }, {}, reversed);
      expectUnflagged(built, { name: 'alpha', model: 'm1', inUse: 'alpha', inUseModel: 'm1' });
   });
});
