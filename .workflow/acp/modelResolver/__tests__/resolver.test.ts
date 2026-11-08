import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
   resolveRegistry,
   resolveRegistryDefaults,
   createDispatchResolver,
} from '../resolver.js';
import {
   NoDriverAvailableError,
   DispatchResolutionError,
   ModelNotFoundError,
} from '../errors.js';
import { loadRegistryConfig } from '../../drivers/registry.js';
import {
   RegistryConfigMissingError,
   RegistryConfigParseError,
   RegistryConfigInvalidError,
} from '../../drivers/errors.js';
import { RegistryConfig } from '../../drivers/registry.js';
import {
   DEFAULT_CASES, INHERITED_NAMES, TWO_DRIVERS, driverEntry, FIXTURE_MODULE, registryOf,
} from '../../drivers/__tests__/registry-fixtures.js';

let dir: string;

beforeEach(() => {
   dir = mkdtempSync(join(tmpdir(), 'dispatch-test-'));
});

afterEach(() => {
   rmSync(dir, { recursive: true, force: true });
});

function writeRegistry(yaml: string): string {
   const filePath = join(dir, 'registry.yaml');
   writeFileSync(filePath, yaml);
   return filePath;
}

function createLogger() {
   const entries: Array<{ level: string; event: string; data: any }> = [];
   return {
      entries,
      debug: (event: string, data: any = {}) => { entries.push({ level: 'debug', event, data }); },
      info:  (event: string, data: any = {}) => { entries.push({ level: 'info',  event, data }); },
      warn:  (event: string, data: any = {}) => { entries.push({ level: 'warn',  event, data }); },
      error: (event: string, data: any = {}) => { entries.push({ level: 'error', event, data }); },
   };
}

// Group 1: Registry Config Parsing -------------------------------------------

describe('Group 1 — registry config parsing', () => {
   it('parses a minimal valid registry (drivers only)', () => {
      const filePath = writeRegistry(`
drivers:
  kiro:
    module: ${FIXTURE_MODULE}
    models: [auto, claude-sonnet-5]
`);
      const config = loadRegistryConfig(filePath);
      expect(config.drivers.kiro.models).toEqual(['auto', 'claude-sonnet-5']);
   });

   it('parses the preferred driver and model', () => {
      const filePath = writeRegistry(`
preferred:
  driver: kiro
  model: claude-sonnet-5
drivers:
  kiro:
    module: ${FIXTURE_MODULE}
    models: [auto, claude-sonnet-5]
`);
      const config = loadRegistryConfig(filePath);
      expect(config.preferred).toEqual({ driver: 'kiro', model: 'claude-sonnet-5' });
   });

   it('parses the profiles: section keyed by profile name', () => {
      const filePath = writeRegistry(`
drivers:
  kiro:
    module: ${FIXTURE_MODULE}
    models: [auto, claude-opus-5, claude-sonnet-5]
profiles:
  Architect:
    model: claude-opus-5
    driver: kiro
  Builder:
    model: claude-sonnet-5
`);
      const config = loadRegistryConfig(filePath);
      expect(config.profiles?.Architect).toEqual({ model: 'claude-opus-5', driver: 'kiro' });
      expect(config.profiles?.Builder).toEqual({ model: 'claude-sonnet-5' });
   });

   it('missing registry file throws RegistryConfigMissingError naming the path', () => {
      const missingPath = join(dir, 'does-not-exist.yaml');
      expect(() => loadRegistryConfig(missingPath)).toThrow(RegistryConfigMissingError);
      expect(() => loadRegistryConfig(missingPath)).toThrow(missingPath);
   });

   it('malformed YAML throws RegistryConfigParseError', () => {
      const filePath = writeRegistry('drivers:\n  kiro: [this is not: valid: yaml');
      expect(() => loadRegistryConfig(filePath)).toThrow(RegistryConfigParseError);
   });

   it('missing drivers: root key throws RegistryConfigInvalidError', () => {
      const filePath = writeRegistry('preferred:\n  driver: kiro\n');
      expect(() => loadRegistryConfig(filePath)).toThrow(RegistryConfigInvalidError);
   });

   it('a driver entry with an empty models list throws RegistryConfigInvalidError', () => {
      const filePath = writeRegistry(`
drivers:
  kiro:
    module: ${FIXTURE_MODULE}
    models: []
`);
      expect(() => loadRegistryConfig(filePath)).toThrow(RegistryConfigInvalidError);
   });

   it('parses a valid fallbackMode value from the registry', () => {
      const filePath = writeRegistry(`
fallbackMode: fail-fast
drivers:
  kiro:
    module: ${FIXTURE_MODULE}
    models: [auto]
`);
      const config = loadRegistryConfig(filePath);
      expect(config.fallbackMode).toBe('fail-fast');
   });

   it('an invalid fallbackMode value throws RegistryConfigInvalidError', () => {
      const filePath = writeRegistry(`
fallbackMode: sometimes
drivers:
  kiro:
    module: ${FIXTURE_MODULE}
    models: [auto]
`);
      expect(() => loadRegistryConfig(filePath)).toThrow(RegistryConfigInvalidError);
   });
});

// Group 2: Registry Resolution (model + optional driver, auto-fallback) ------

describe('Group 2 — registry resolution', () => {
   const twoDriverConfig: RegistryConfig = {
      drivers: {
         'driver-a': driverEntry(['auto', 'model-x', 'model-y']),
         'driver-b': driverEntry(['auto', 'model-y', 'model-z']),
      },
   };

   it('model + driver given, that driver supports the model → uses it', () => {
      const result = resolveRegistry(twoDriverConfig, 'model-y', 'driver-b');
      expect(result).toEqual({ model: 'model-y', driver: 'driver-b' });
   });

   it('model + driver given, driver does not support the model → falls through to no-driver-match', () => {
      // driver-a does not support model-z; model-z only on driver-b.
      const result = resolveRegistry(twoDriverConfig, 'model-z', 'driver-a');
      expect(result).toEqual({ model: 'model-z', driver: 'driver-b' });
   });

   it('model given, no driver → first driver in registry order that supports it', () => {
      const result = resolveRegistry(twoDriverConfig, 'model-y');
      expect(result).toEqual({ model: 'model-y', driver: 'driver-a' });
   });

   it('model given, no driver, preferred driver set → tie-break to the preferred driver', () => {
      const config: RegistryConfig = { ...twoDriverConfig, preferred: { driver: 'driver-b' } };
      const result = resolveRegistry(config, 'model-y');
      expect(result).toEqual({ model: 'model-y', driver: 'driver-b' });
   });

   it('named model not found anywhere → retries with model="auto", keeping given driver context', () => {
      const result = resolveRegistry(twoDriverConfig, 'nonexistent-model', 'driver-b');
      expect(result).toEqual({ model: 'auto', driver: 'driver-b' });
   });

   it('named model not found, no driver given → auto retry uses the preferred driver', () => {
      const config: RegistryConfig = { ...twoDriverConfig, preferred: { driver: 'driver-b' } };
      const result = resolveRegistry(config, 'nonexistent-model');
      expect(result).toEqual({ model: 'auto', driver: 'driver-b' });
   });

   it('named model not found, no driver, no preferred → auto retry uses first driver in registry order', () => {
      const result = resolveRegistry(twoDriverConfig, 'nonexistent-model');
      expect(result).toEqual({ model: 'auto', driver: 'driver-a' });
   });

   it('no model given at all → resolves directly as "auto" with the same driver-context fallback', () => {
      const result = resolveRegistry(twoDriverConfig);
      expect(result).toEqual({ model: 'auto', driver: 'driver-a' });
   });

   it('"auto" is matched like a normal model — no special-case bypass of model-support checking', () => {
      const config: RegistryConfig = {
         drivers: { 'driver-a': driverEntry(['model-x']) }, // no "auto" listed
      };
      expect(() => resolveRegistry(config, 'auto')).toThrow(NoDriverAvailableError);
   });

   it('no driver available even for "auto" → error naming the originally-requested model '
      + 'and that auto also failed', () => {
      const config: RegistryConfig = {
         drivers: { 'driver-a': driverEntry(['model-x']) }, // no "auto"
      };
      let caught: unknown;
      try { resolveRegistry(config, 'nonexistent-model'); }
      catch (err) { caught = err; }
      expect(caught).toBeInstanceOf(NoDriverAvailableError);
      expect((caught as Error).message).toContain('nonexistent-model');
      expect((caught as Error).message).toContain('auto');
   });

   it('no drivers configured at all → NoDriverAvailableError', () => {
      const config: RegistryConfig = { drivers: {} };
      expect(() => resolveRegistry(config)).toThrow(NoDriverAvailableError);
   });
});

/** The error a call throws; fails the test when it does not throw. */
function thrown(run: () => unknown): Error
{
   try { run(); }
   catch (err) { return err as Error; }
   throw new Error('expected the call to throw');
}

describe('registry defaults', () => {
   it.each(DEFAULT_CASES)('%s', (_label, preferred, models, expected) => {
      expect(resolveRegistryDefaults(registryOf(models, preferred))).toEqual(expected);
   });

   it('nothing resolves: the error names the preferred model', () => {
      const config = registryOf({ solo: ['m-custom'] }, { driver: 'solo', model: 'm9' });
      const error  = thrown(() => resolveRegistryDefaults(config));
      expect(error).toBeInstanceOf(NoDriverAvailableError);
      expect(error.message).toContain('m9');
   });

   it('nothing resolves and no model is preferred: the error names no model', () => {
      const lists = { solo: ['m-custom'] };
      const error = thrown(() => resolveRegistryDefaults(registryOf(lists, { driver: 'solo' })));
      expect(error).toBeInstanceOf(NoDriverAvailableError);
      expect(error.message).toBe(thrown(() => resolveRegistry(registryOf(lists))).message);
   });

   it.each(['M1', ' m1', 'm1 '])('matching is exact: the preferred model "%s" is not "m1"', model => {
      const config = registryOf({ kiro: ['auto', 'm1'] }, { driver: 'kiro', model });
      expect(resolveRegistryDefaults(config)).toEqual({ model: 'auto', driver: 'kiro' });
   });

   it('matching is exact: the preferred driver "Copilot" is not "copilot"', () => {
      const lists  = { kiro: ['auto', 'm1'], copilot: ['auto', 'm1'] };
      const config = registryOf(lists, { driver: 'Copilot', model: 'm1' });
      expect(resolveRegistryDefaults(config)).toEqual({ model: 'm1', driver: 'kiro' });
   });

   it('the calculation is pure', () => {
      const config = registryOf(TWO_DRIVERS, { driver: 'copilot', model: 'm3' });
      const before = structuredClone(config);
      expect(resolveRegistryDefaults(config)).toEqual(resolveRegistryDefaults(config));
      expect(config).toEqual(before);
   });

   it('profiles and fallbackMode do not change the defaults', () => {
      const preferred = { driver: 'copilot', model: 'm3' };
      const extra: Partial<RegistryConfig> = {
         profiles: { Builder: { model: 'm2', driver: 'kiro' } }, fallbackMode: 'fail-fast',
      };
      const plain = resolveRegistryDefaults(registryOf(TWO_DRIVERS, preferred));
      expect(resolveRegistryDefaults(registryOf(TWO_DRIVERS, preferred, extra))).toEqual(plain);
   });
});

describe('a model request with and without a driver', () => {
   it('the preferred driver does not list the model: another driver does', () => {
      const config = registryOf(TWO_DRIVERS, { driver: 'kiro' });
      expect(resolveRegistry(config, 'm3')).toEqual({ model: 'm3', driver: 'copilot' });
   });

   it('a given driver that lists the model wins over the preferred driver', () => {
      const config = registryOf(TWO_DRIVERS, { driver: 'copilot' });
      expect(resolveRegistry(config, 'm1', 'kiro')).toEqual({ model: 'm1', driver: 'kiro' });
   });

   it('a given driver that lacks the model falls to the preferred driver, then to registry order', () => {
      const lists   = { a: ['auto', 'm1'], b: ['auto', 'm3'], c: ['auto', 'm3'] };
      const preferC = registryOf(lists, { driver: 'c' });
      expect(resolveRegistry(preferC, 'm3', 'a')).toEqual({ model: 'm3', driver: 'c' });
      expect(resolveRegistry(registryOf(lists), 'm3', 'a')).toEqual({ model: 'm3', driver: 'b' });
   });

   it('the auto retry keeps a given driver that lists auto, over the preferred driver', () => {
      const config = registryOf(TWO_DRIVERS, { driver: 'copilot' });
      expect(resolveRegistry(config, 'nope', 'kiro')).toEqual({ model: 'auto', driver: 'kiro' });
   });

   it('the auto retry moves to the first driver with auto when the best known one has none', () => {
      const config = registryOf({ kiro: ['m1'], copilot: ['auto'] });
      expect(resolveRegistry(config, 'nope')).toEqual({ model: 'auto', driver: 'copilot' });
   });

   it('no model and no driver: auto on the preferred driver', () => {
      const config = registryOf(TWO_DRIVERS, { driver: 'copilot' });
      expect(resolveRegistry(config)).toEqual({ model: 'auto', driver: 'copilot' });
   });
});

describe('names every object has', () => {
   it.each(INHERITED_NAMES)('"%s" as the given driver is skipped, not thrown on', name => {
      const config = registryOf(TWO_DRIVERS, { driver: 'copilot' });
      expect(resolveRegistry(config, 'm1', name)).toEqual({ model: 'm1', driver: 'copilot' });
      expect(resolveRegistry(config, 'nope', name)).toEqual({ model: 'auto', driver: 'kiro' });
   });

   it.each(INHERITED_NAMES)('"%s" as the preferred driver is skipped, not thrown on', name => {
      const config = registryOf(TWO_DRIVERS, { driver: name, model: 'm3' });
      expect(resolveRegistryDefaults(config)).toEqual({ model: 'm3', driver: 'copilot' });
   });

   it.each(INHERITED_NAMES)('"%s" as a profile driver is skipped, not thrown on', name => {
      const profiles = { Builder: { model: 'm1', driver: name } };
      const config   = registryOf(TWO_DRIVERS, undefined, { profiles });
      const resolver = createDispatchResolver({ config, logger: createLogger() });
      expect(resolver.resolve('Builder')).toMatchObject({ model: 'm1', driver: 'kiro', source: 'profile' });
   });
});

describe('dispatch resolver without a profile', () => {
   const configWith = (extra: Partial<RegistryConfig> = {}) =>
      registryOf(TWO_DRIVERS, { driver: 'copilot', model: 'm3' }, extra);

   const resolveWith = (config: RegistryConfig, profile?: string) =>
      createDispatchResolver({ config, logger: createLogger() }).resolve(profile);

   it('resolve() with no profile uses the registry defaults', () => {
      const config = configWith();
      expect(resolveWith(config)).toEqual({ ...resolveRegistryDefaults(config), source: 'registry-default' });
   });

   it('profiles in the config are ignored when none is asked for', () => {
      const config = configWith({ profiles: { Builder: { model: 'm2', driver: 'kiro' } } });
      expect(resolveWith(config)).toEqual({ model: 'm3', driver: 'copilot', source: 'registry-default' });
   });

   it('the resolution is logged once, without a profile', () => {
      const logger = createLogger();
      createDispatchResolver({ config: configWith(), logger }).resolve();
      const logged = logger.entries.filter(entry => 'registry-default' === entry.data.source);
      expect(logged).toHaveLength(1);
      expect(logged[0].data).toMatchObject({ model: 'm3', driver: 'copilot' });
      expect(logged[0].data).not.toHaveProperty('profile');
   });

   it('fail-fast does not change it', () => {
      const config = configWith({ fallbackMode: 'fail-fast' });
      expect(resolveWith(config)).toEqual({ model: 'm3', driver: 'copilot', source: 'registry-default' });
   });

   it('defaults that cannot resolve throw the resolver error, logged without a profile', () => {
      const config   = registryOf({ solo: ['m-custom'] }, { driver: 'solo', model: 'm9' });
      const logger   = createLogger();
      const resolver = createDispatchResolver({ config, logger });
      const error    = thrown(() => resolver.resolve());
      expect(error).toBeInstanceOf(NoDriverAvailableError);
      expect(error).not.toBeInstanceOf(DispatchResolutionError);
      const failures = logger.entries.filter(entry => 'error' === entry.level);
      expect(failures).toHaveLength(1);
      expect(failures[0].data).not.toHaveProperty('profile');
   });

   it('a profile name that is not under profiles: gets the defaults, logged under that name', () => {
      const logger   = createLogger();
      const resolver = createDispatchResolver({ config: configWith(), logger });
      expect(resolver.resolve('Nobody')).toEqual(resolver.resolve());
      expect(logger.entries.filter(entry => 'Nobody' === entry.data.profile)).toHaveLength(1);
   });

   it('a profile with an entry is unchanged', () => {
      const config = configWith({ profiles: { Builder: { model: 'm2', driver: 'kiro' } } });
      expect(resolveWith(config, 'Builder')).toEqual({ model: 'm2', driver: 'kiro', source: 'profile' });
   });
});

// Group 3: Dispatch Resolver — Profile → Registry Default Fallback -----------

describe('Group 3 — dispatch resolver fallback chain', () => {
   function configWith(overrides: Partial<RegistryConfig> = {}): RegistryConfig {
      return {
         drivers: {
            kiro:    driverEntry(['auto', 'claude-opus-5', 'claude-sonnet-5']),
            copilot: driverEntry(['auto', 'claude-sonnet-5']),
         },
         ...overrides,
      };
   }

   it('profile has a profiles: entry with a model, registry resolves it directly', () => {
      const config = configWith({
         profiles: { Architect: { model: 'claude-opus-5', driver: 'kiro' } },
      });
      const logger   = createLogger();
      const resolver = createDispatchResolver({ config, logger });
      const result   = resolver.resolve('Architect');
      expect(result).toEqual({ driver: 'kiro', model: 'claude-opus-5', source: 'profile' });
   });

   it('profile entry model fails to resolve via registry, falls back to registry defaults', () => {
      // Profile's chosen driver exists but doesn't support "claude-sonnet-5"
      // under a registry where that's the ONLY driver (so no first-match
      // fallback exists), and "auto" is unsupported too — the profile
      // attempt genuinely fails. Registry defaults point at a different
      // driver that does support the model, so the fallback succeeds.
      const config: RegistryConfig = {
         drivers: {
            solo: driverEntry(['claude-opus-5']), // no "claude-sonnet-5", no "auto"
         },
         profiles:        { Builder: { model: 'claude-sonnet-5', driver: 'solo' } },
         preferred:       { driver: 'solo', model: 'claude-opus-5' },
      };
      const resolver = createDispatchResolver({ config, logger: createLogger() });
      const result   = resolver.resolve('Builder');
      expect(result).toMatchObject({ driver: 'solo', model: 'claude-opus-5', source: 'registry-default' });
   });

   it('profile has no profiles: entry at all → uses registry defaults directly', () => {
      const config = configWith({
         preferred: { driver: 'copilot', model: 'claude-sonnet-5' },
      });
      const resolver = createDispatchResolver({ config, logger: createLogger() });
      const result   = resolver.resolve('UnknownProfile');
      expect(result).toEqual({ driver: 'copilot', model: 'claude-sonnet-5', source: 'registry-default' });
   });

   it('profile entry has no model field → uses registry defaults directly', () => {
      const config = configWith({
         profiles:  { Builder: { model: '' } as any },
         preferred: { driver: 'copilot' },
      });
      const resolver = createDispatchResolver({ config, logger: createLogger() });
      const result   = resolver.resolve('Builder');
      expect(result.source).toBe('registry-default');
   });

   it('both profile-entry and registry-default resolution fail → one combined error', () => {
      const config: RegistryConfig = {
         drivers:  { kiro: driverEntry(['claude-opus-5']) }, // no "auto"
         profiles: { Builder: { model: 'nonexistent-model', driver: 'nonexistent-driver' } },
      };
      const resolver = createDispatchResolver({ config, logger: createLogger() });
      expect(() => resolver.resolve('Builder')).toThrow(DispatchResolutionError);
   });

   it('combined error wraps both underlying resolver errors', () => {
      const config: RegistryConfig = {
         drivers:  { kiro: driverEntry(['claude-opus-5']) },
         profiles: { Builder: { model: 'nonexistent-model' } },
      };
      const resolver = createDispatchResolver({ config, logger: createLogger() });
      let caught: unknown;
      try { resolver.resolve('Builder'); }
      catch (err) { caught = err; }
      expect(caught).toBeInstanceOf(DispatchResolutionError);
      expect((caught as any).profileError).toBeDefined();
      expect((caught as any).registryDefaultError).toBeDefined();
   });
});

// Group 4: Error Handling (fail-fast vs. fallback-to-default-driver) ---------

describe('Group 4 — configurable fallback behavior', () => {
   it('fail-fast mode: fails immediately, no registry-default fallback attempted', () => {
      const config: RegistryConfig = {
         drivers:  { kiro: driverEntry(['claude-opus-5']) }, // no "auto"
         profiles: { Builder: { model: 'nonexistent-model' } },
      };
      const logger   = createLogger();
      const resolver = createDispatchResolver({ config, logger, fallbackMode: 'fail-fast' });
      expect(() => resolver.resolve('Builder')).toThrow(ModelNotFoundError);
      const fallbackAttempts = logger.entries.filter(e => 'dispatch_fallback_attempt' === e.event);
      expect(fallbackAttempts).toHaveLength(0);
   });

   it('fallback-to-default-driver mode (default): attempts registry defaults when profile fails', () => {
      // No driver in the registry supports "auto" at all, so once the
      // profile's named model fails to match, its auto-retry has nothing
      // to fall through to either — the profile attempt genuinely fails
      // with NoDriverAvailableError. Registry defaults resolve directly
      // via a named-model match (not via auto), so the fallback succeeds.
      const config: RegistryConfig = {
         drivers: {
            solo: driverEntry(['claude-sonnet-5']), // no "auto"
         },
         profiles:        { Builder: { model: 'nonexistent-model', driver: 'solo' } },
         preferred:       { driver: 'solo', model: 'claude-sonnet-5' },
      };
      const resolver = createDispatchResolver({ config, logger: createLogger() });
      const result   = resolver.resolve('Builder');
      expect(result.source).toBe('registry-default');
   });

   it('registry config fallbackMode is used when no explicit option is given', () => {
      const config: RegistryConfig = {
         drivers:     { kiro: driverEntry(['claude-opus-5']) }, // no "auto"
         profiles:    { Builder: { model: 'nonexistent-model' } },
         fallbackMode: 'fail-fast',
      };
      const logger   = createLogger();
      const resolver = createDispatchResolver({ config, logger });
      expect(() => resolver.resolve('Builder')).toThrow(ModelNotFoundError);
      // fail-fast: no registry-default attempt, so no DispatchResolutionError wrapping.
      const entry = logger.entries.find(e => 'dispatch_failed' === e.event);
      expect(entry?.data.registryDefaultAttempt).toBeUndefined();
   });

   it('explicit fallbackMode option overrides the registry config value', () => {
      // No driver supports "auto", so the profile's unresolvable named
      // model has no auto-retry rescue — it genuinely fails. Registry
      // defaults resolve directly via a named-model match.
      const config: RegistryConfig = {
         drivers:         { solo: driverEntry(['claude-sonnet-5']) }, // no "auto"
         profiles:        { Builder: { model: 'nonexistent-model', driver: 'solo' } },
         preferred:       { driver: 'solo', model: 'claude-sonnet-5' },
         fallbackMode:    'fail-fast', // registry says fail-fast...
      };
      const resolver = createDispatchResolver({
         config, logger: createLogger(), fallbackMode: 'fallback-to-default-driver',
      });
      // ...but the explicit option overrides it, so registry-default is attempted and succeeds.
      const result = resolver.resolve('Builder');
      expect(result.source).toBe('registry-default');
   });
});

// Group 5: Operational Logging -----------------------------------------------

describe('Group 5 — operational logging', () => {
   it('successful dispatch logs profile, resolved model, resolved driver, and source', () => {
      const config: RegistryConfig = {
         drivers:  { kiro: driverEntry(['claude-opus-5']) },
         profiles: { Architect: { model: 'claude-opus-5', driver: 'kiro' } },
      };
      const logger   = createLogger();
      const resolver = createDispatchResolver({ config, logger });
      resolver.resolve('Architect');
      const entry = logger.entries.find(e => 'dispatch_resolved' === e.event);
      expect(entry?.data.profile).toBe('Architect');
      expect(entry?.data.model).toBe('claude-opus-5');
      expect(entry?.data.driver).toBe('kiro');
      expect(entry?.data.source).toBe('profile');
   });

   it('failed dispatch logs profile, both attempted (model, driver) pairs, and both failure reasons', () => {
      const config: RegistryConfig = {
         drivers:  { kiro: driverEntry(['claude-opus-5']) },
         profiles: { Builder: { model: 'nonexistent-model', driver: 'nonexistent-driver' } },
      };
      const logger   = createLogger();
      const resolver = createDispatchResolver({ config, logger });
      expect(() => resolver.resolve('Builder')).toThrow();
      const entry = logger.entries.find(e => 'dispatch_failed' === e.event);
      expect(entry?.data.profile).toBe('Builder');
      expect(entry?.data.profileAttempt).toEqual({ model: 'nonexistent-model', driver: 'nonexistent-driver' });
      expect(entry?.data.registryDefaultAttempt).toBeDefined();
      expect(entry?.data.profileError).toBeDefined();
      expect(entry?.data.registryDefaultError).toBeDefined();
      expect(entry?.level).toBe('error');
   });

   it('logs config load errors with the file path and problem', () => {
      const logger      = createLogger();
      const missingPath = join(dir, 'does-not-exist.yaml');
      expect(() => createDispatchResolver({ configPath: missingPath, logger })).toThrow();
      const entry = logger.entries.find(e => 'registry_config_error' === e.event);
      expect(entry?.data.filePath).toBe(missingPath);
      expect(entry?.level).toBe('error');
   });
});

// Group 6: Constructor Contract -----------------------------------------------

describe('Group 6 — createDispatchResolver construction', () => {
   it('loads config from configPath when provided', () => {
      const filePath = writeRegistry(`
drivers:
  kiro:
    module: ${FIXTURE_MODULE}
    models: [claude-opus-5]
profiles:
  Architect:
    model: claude-opus-5
    driver: kiro
`);
      const resolver = createDispatchResolver({ configPath: filePath, logger: createLogger() });
      const result   = resolver.resolve('Architect');
      expect(result).toEqual({ driver: 'kiro', model: 'claude-opus-5', source: 'profile' });
   });

   it('throws when neither config nor configPath is provided', () => {
      expect(() => createDispatchResolver({ logger: createLogger() } as any)).toThrow();
   });
});
