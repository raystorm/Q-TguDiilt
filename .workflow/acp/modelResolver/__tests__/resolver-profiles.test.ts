import { describe, it, expect } from 'vitest';
import { createDispatchResolver, DispatchResolver } from '../resolver.js';
import { DriverNotFoundError, ModelNotFoundError, DispatchResolutionError } from '../errors.js';
import type { ProfilePreference, RegistryConfig } from '../../drivers/registry.js';
import {
   INHERITED_NAMES, TWO_DRIVERS, registryOf,
} from '../../drivers/__tests__/registry-fixtures.js';
import { createLogger } from '../../protocol/__tests__/agent.helpers.js';

/** TWO_DRIVERS (kiro: auto, m1, m2; copilot: auto, m1, m3) with `Builder` set to `entry`. */
const withBuilder = (entry: ProfilePreference, extra: Partial<RegistryConfig> = {}) =>
   registryOf(TWO_DRIVERS, undefined, { profiles: { Builder: entry }, ...extra });

/** One driver that lists no `auto`: a model nobody lists has nothing to fall to. */
const NO_AUTO = { solo: ['m1', 'm2'] };

function resolverOn(config: RegistryConfig)
{
   const logger = createLogger();
   return { logger, resolver: createDispatchResolver({ config, logger }) };
}

const logged = (logger: ReturnType<typeof createLogger>, event: string) =>
   logger.entries.filter(entry => event === entry.event);

/** The error `resolve('Builder')` throws; fails the test when it does not throw. */
function builderError(resolver: DispatchResolver): Error
{
   try { resolver.resolve('Builder'); }
   catch (err) { return err as Error; }
   throw new Error('expected resolve to throw');
}

describe('names every object has', () => {
   it.each(INHERITED_NAMES)(
      '[H] "%s" is not a profile entry: the defaults apply and are not labelled as a profile',
      name => {
         const { logger, resolver } = resolverOn(withBuilder({ model: 'm2', driver: 'kiro' }));
         const result = resolver.resolve(name);
         expect(result).toEqual(resolver.resolve());
         expect(result.source).toBe('registry-default');
         expect(result).not.toHaveProperty('substitution');
         const entries = logger.entries.filter(entry => name === entry.data.profile);
         expect(entries.map(entry => entry.data.source)).toEqual(['registry-default']);
      },
   );
});

describe('a profile resolved exactly', () => {
   const EXACT: Array<[string, ProfilePreference, string, string]> = [
      ['a model and a driver', { model: 'm2', driver: 'kiro' }, 'kiro', 'm2'],
      ['a model only',         { model: 'm1' },                 'kiro', 'm1'],
   ];

   it.each(EXACT)('has no substitution: %s', (_label, entry, driver, model) => {
      const result = resolverOn(withBuilder(entry)).resolver.resolve('Builder');
      expect(result).toEqual({ driver, model, source: 'profile' });
      expect(result).not.toHaveProperty('substitution');
   });
});

describe('a profile that runs on a substitute', () => {
   type Pair = { driver: string; model: string };

   const SUBSTITUTED: Array<[string, ProfilePreference, Pair, string]> = [
      [
         'a driver the registry does not list',
         { model: 'm1', driver: 'gone' },
         { driver: 'kiro', model: 'm1' },
         'driver not available',
      ],
      [
         'a model the asked driver lacks, another driver lists it',
         { model: 'm3', driver: 'kiro' },
         { driver: 'copilot', model: 'm3' },
         'model not listed',
      ],
      [
         'a model nobody lists, no driver asked',
         { model: 'nope' },
         { driver: 'kiro', model: 'auto' },
         'model not listed',
      ],
      [
         'a model nobody lists, on a listed driver',
         { model: 'nope', driver: 'copilot' },
         { driver: 'copilot', model: 'auto' },
         'model not listed',
      ],
      [
         'a model nobody lists, on a driver the registry does not list: the driver reason wins',
         { model: 'nope', driver: 'gone' },
         { driver: 'kiro', model: 'auto' },
         'driver not available',
      ],
   ];

   it.each(SUBSTITUTED)('[H] %s: source stays profile, and says what was asked and why',
      (_label, entry, used, reason) => {
         const result = resolverOn(withBuilder(entry)).resolver.resolve('Builder');
         expect(result).toMatchObject({ ...used, source: 'profile' });
         expect(result.substitution).toStrictEqual({ asked: entry, reason });
      },
   );
});

describe('an entry that cannot be resolved', () => {
   const config = (entry: ProfilePreference) =>
      registryOf(NO_AUTO, { driver: 'solo', model: 'm2' }, { profiles: { Builder: entry } });

   const ENTRIES: Array<[string, ProfilePreference]> = [
      ['without a driver', { model: 'nope' }],
      ['with a driver',    { model: 'nope', driver: 'solo' }],
   ];

   it.each(ENTRIES)('[H] %s: the defaults apply, labelled as defaults, with the entry as asked',
      (_label, entry) => {
         const result = resolverOn(config(entry)).resolver.resolve('Builder');
         expect(result).toMatchObject({ driver: 'solo', model: 'm2', source: 'registry-default' });
         expect(result.substitution)
            .toStrictEqual({ asked: entry, reason: 'entry could not be resolved' });
      },
   );
});

describe('no profile, or no entry', () => {
   it.each([
      ['no profile', undefined],
      ['a profile with no entry', 'Nobody'],
   ])('%s: the defaults apply, with no substitution', (_label, profile) => {
      const { resolver } = resolverOn(withBuilder({ model: 'm2', driver: 'kiro' }));
      const result = resolver.resolve(profile);
      expect(result).toEqual({ driver: 'kiro', model: 'auto', source: 'registry-default' });
      expect(result).not.toHaveProperty('substitution');
   });
});

describe('fail-fast', () => {
   const failFast = (entry: ProfilePreference) => withBuilder(entry, { fallbackMode: 'fail-fast' });

   const noAutoFailFast = registryOf(NO_AUTO, undefined, {
      profiles: { Builder: { model: 'nope' } }, fallbackMode: 'fail-fast',
   });

   type Raised = typeof DriverNotFoundError | typeof ModelNotFoundError;

   // label, config, the error raised, what its message names besides the profile
   const FAILURES: Array<[string, RegistryConfig, Raised, string]> = [
      [
         'a driver the registry does not list',
         failFast({ model: 'm1', driver: 'gone' }), DriverNotFoundError, 'gone',
      ],
      [
         'a model nobody lists',
         failFast({ model: 'nope' }), ModelNotFoundError, 'nope',
      ],
      [
         'a model nobody lists, on a listed driver',
         failFast({ model: 'nope', driver: 'kiro' }), ModelNotFoundError, 'nope',
      ],
      [
         'an unlisted driver and a model nobody lists: the driver comes first',
         failFast({ model: 'nope', driver: 'gone' }), DriverNotFoundError, 'gone',
      ],
      [
         'a model nobody lists and no auto anywhere: the model is named, not the lack of a driver',
         noAutoFailFast, ModelNotFoundError, 'nope',
      ],
   ];

   it.each(FAILURES)('[H] %s: raises the existing error, naming the profile',
      (_label, config, errorClass, named) => {
         const error = builderError(resolverOn(config).resolver);
         expect(error).toBeInstanceOf(errorClass);
         expect(error.message).toContain('Builder');
         expect(error.message).toContain(named);
      },
   );

   it.each(FAILURES)('[H] %s: is logged once as a failed dispatch, never as resolved',
      (_label, config) => {
         const { logger, resolver } = resolverOn(config);
         builderError(resolver);
         const failures = logged(logger, 'dispatch_failed');
         expect(failures).toHaveLength(1);
         expect(failures[0].data.profile).toBe('Builder');
         expect(logged(logger, 'dispatch_resolved')).toHaveLength(0);
      },
   );

   it('[H] a listed driver that lacks the model is substituted, not raised', () => {
      const { logger, resolver } = resolverOn(failFast({ model: 'm3', driver: 'kiro' }));
      const result = resolver.resolve('Builder');
      expect(result).toMatchObject({ driver: 'copilot', model: 'm3', source: 'profile' });
      expect(result.substitution).toStrictEqual({
         asked: { model: 'm3', driver: 'kiro' }, reason: 'model not listed',
      });
      expect(logged(logger, 'dispatch_resolved')).toHaveLength(1);
   });

   it.each([
      ['no profile', undefined],
      ['a satisfied profile', 'Builder'],
      ['a profile with no entry', 'Nobody'],
   ])('%s resolves as in default mode', (_label, profile) => {
      const entry   = { model: 'm2', driver: 'kiro' };
      const strict  = resolverOn(withBuilder(entry, { fallbackMode: 'fail-fast' })).resolver;
      const lenient = resolverOn(withBuilder(entry)).resolver;
      expect(strict.resolve(profile)).toEqual(lenient.resolve(profile));
   });
});

describe('default mode, the entry and the defaults both fail', () => {
   it('the combined error names the profile', () => {
      const config = registryOf(NO_AUTO, undefined, { profiles: { Builder: { model: 'nope' } } });
      const error  = builderError(resolverOn(config).resolver);
      expect(error).toBeInstanceOf(DispatchResolutionError);
      expect(error.message).toContain('Builder');
   });
});
