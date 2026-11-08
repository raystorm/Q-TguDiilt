/**
 * Model Dispatch Resolver — resolves the (model, driver) pair the protocol
 * layer should dispatch a profile's commands to.
 *
 * Two layers:
 * - `resolveRegistry` is the registry-level resolver: given a model and an
 *   optional driver, finds a driver that supports the model, falling back
 *   to the "auto" model (assumed supported by every driver) when the named
 *   model cannot be matched. Fails closed with `NoDriverAvailableError`
 *   when no driver is available even for "auto".
 * - `createDispatchResolver` is the profile-level fallback chain: tries the
 *   active profile's `profiles:` entry first, falls back to the registry's
 *   own `preferred` defaults, and raises one
 *   combined error (wrapping both underlying failures) when both fail.
 *   A result that differs from the entry carries a `substitution`.
 *   `fallbackMode: 'fail-fast'` skips the registry-default attempt: a driver the
 *   registry does not list raises `DriverNotFoundError`, a model no driver lists
 *   raises `ModelNotFoundError`. A listed driver that lacks a model another driver
 *   lists is substituted, as in the default mode.
 *
 * No hardcoded driver/model names anywhere in this module — everything
 * comes from the externalized YAML registry (loaded fail-closed by
 * `../drivers/registry.js`).
 */
import { Logger, printErrorMessage } from '../shared/logger.js';
import {
   loadRegistryConfig, FallbackMode, ProfilePreference, RegistryConfig,
} from '../drivers/registry.js';
import { DispatchResult, DispatchSubstitution } from './types.js';
import {
   NoDriverAvailableError, DispatchResolutionError, DriverNotFoundError, ModelNotFoundError,
} from './errors.js';

/** The implicit fallback model, assumed supported by every driver. */
export const AUTO_MODEL = 'auto';

/** True when `driver` is given, is listed in the registry (own entries only) and supports `model`. */
function driverSupports(config: RegistryConfig, driver: string | undefined, model: string): boolean {
   return undefined !== driver && Object.hasOwn(config.drivers, driver) &&
      config.drivers[driver].models.includes(model);
}

/** First driver in registry insertion order that supports `model`, or undefined. */
function firstDriverSupporting(config: RegistryConfig, model: string): string | undefined {
   return Object.keys(config.drivers).find(name => driverSupports(config, name, model));
}

/** First driver registered in the registry, regardless of what it supports, or undefined. */
function firstRegisteredDriver(config: RegistryConfig): string | undefined {
   return Object.keys(config.drivers)[0];
}

/**
 * Resolves `model`(+ optional `driver`) against the registry. Retries with
 * `model = "auto"` (keeping known driver context) when the named model
 * cannot be matched, or when no model was given at all. Throws
 * `NoDriverAvailableError` when no driver supports even "auto".
 */
export function resolveRegistry(
   config: RegistryConfig,
   model?: string,
   driver?: string,
): { model: string; driver: string } {
   const requestedModel  = model;
   const preferredDriver = config.preferred?.driver;

   if (undefined !== model) {
      // Step 1: (model, driver) given, driver supports model -> use it.
      if (driverSupports(config, driver, model)) { return { model, driver: driver as string }; }

      // Step 2: model given, no driver match (or none given) -> the preferred
      // driver if it supports it, else the first driver in registry order that
      // does.
      if (driverSupports(config, preferredDriver, model)) {
         return { model, driver: preferredDriver as string };
      }
      const firstMatch = firstDriverSupporting(config, model);
      if (undefined !== firstMatch) { return { model, driver: firstMatch }; }
   }

   // Step 3: named model not found (or none given) -> retry with "auto",
   // keeping whatever driver context is already known.
   const autoDriverContext = driver ?? preferredDriver ?? firstRegisteredDriver(config);

   if (driverSupports(config, autoDriverContext, AUTO_MODEL)) {
      return { model: AUTO_MODEL, driver: autoDriverContext as string };
   }
   const firstAutoMatch = firstDriverSupporting(config, AUTO_MODEL);
   if (undefined !== firstAutoMatch) { return { model: AUTO_MODEL, driver: firstAutoMatch }; }

   // Step 4: no driver available even for "auto" -> fail closed, never silent.
   throw new NoDriverAvailableError(requestedModel,
                                    new Error(`no driver in the registry supports "${AUTO_MODEL}"`));
}

/**
 * The (model, driver) pair the registry defaults resolve to: the preferred model
 * (else "auto") on the preferred driver (else the first one listed), by the same
 * chain as `resolveRegistry`. Throws `NoDriverAvailableError` when none works.
 */
export function resolveRegistryDefaults(config: RegistryConfig): { model: string; driver: string } {
   return resolveRegistry(config, config.preferred?.model, config.preferred?.driver);
}

/** The profile's entry when `profiles:` holds it as its own entry, not a name every object has. */
function profileEntry(config: RegistryConfig, profile: string): ProfilePreference | undefined {
   return Object.hasOwn(config.profiles ?? {}, profile) ? config.profiles?.[profile] : undefined;
}

/** The entry as a substitution reports it: `driver` is absent when the entry has none. */
function askedBy(entry: ProfilePreference): DispatchSubstitution['asked'] {
   return { model: entry.model, ...(undefined !== entry.driver ? { driver: entry.driver } : {}) };
}

/** True when the registry lists `driver` (own entries only). */
function listsDriver(config: RegistryConfig, driver: string): boolean {
   return Object.hasOwn(config.drivers, driver);
}

/** Why a resolved entry differs from what it asked, or undefined when it matches exactly. */
function substitutionFor(
   config:   RegistryConfig,
   entry:    ProfilePreference,
   resolved: { model: string; driver: string },
): DispatchSubstitution | undefined {
   if (resolved.model === entry.model && (undefined === entry.driver || resolved.driver === entry.driver))
   { return undefined; }
   const driverGone = undefined !== entry.driver && !listsDriver(config, entry.driver);
   return { asked: askedBy(entry), reason: driverGone ? 'driver not available' : 'model not listed' };
}

/** `fail-fast`: raises for a driver the registry does not list, then for a model no driver lists. */
function assertListed(config: RegistryConfig, entry: ProfilePreference, profile: string): void {
   if (undefined !== entry.driver && !listsDriver(config, entry.driver))
   { throw new DriverNotFoundError(entry.driver, profile); }
   if (undefined === firstDriverSupporting(config, entry.model))
   { throw new ModelNotFoundError(entry.model, profile); }
}

export interface DispatchResolver {
   /** With no profile, goes straight to the registry defaults. */
   resolve(profile?: string): DispatchResult;
}

export interface DispatchResolverOptions {
   /** Pre-loaded config. Mutually exclusive with `configPath`. */
   config?:       RegistryConfig;
   /** Path to the driver registry YAML config. Mutually exclusive with `config`. */
   configPath?:   string;
   logger:        Logger;
   /**
    * Explicit override for this resolver instance. Falls back to the
    * registry config's own `fallbackMode` field when omitted, then to
    * 'fallback-to-default-driver' when neither is set (system-level
    * setting — see `FallbackMode`).
    */
   fallbackMode?: FallbackMode;
}

/**
 * Builds a dispatch resolver bound to a `Logger`. Every successful
 * resolution is logged (`dispatch_resolved`); every failed resolution is
 * logged (`dispatch_failed`) with whichever attempted (model, driver)
 * pairs and failure reasons actually apply. A config load failure is
 * logged (`registry_config_error`) and rethrown — construction fails
 * closed.
 */
export function createDispatchResolver(options: DispatchResolverOptions): DispatchResolver {
   const { config: providedConfig, configPath, logger, fallbackMode: fallbackModeOption } = options;

   let config: RegistryConfig;
   if (undefined !== providedConfig) { config = providedConfig; }
   else if (undefined !== configPath) {
      try { config = loadRegistryConfig(configPath); }
      catch (err) {
         logger.error('registry_config_error', {
            filePath: configPath,
            problem:  printErrorMessage(err),
         });
         throw err;
      }
   }
   else { throw new Error('createDispatchResolver requires either "config" or "configPath"'); }

   const fallbackMode = fallbackModeOption ?? config.fallbackMode ?? 'fallback-to-default-driver';

   return {
      resolve(profile?: string): DispatchResult {
         if (undefined === profile) {
            return resolveRegistryDefault(config, logger, undefined, undefined, undefined);
         }
         const entry = profileEntry(config, profile);

         if (undefined !== entry && '' !== entry.model) {
            try {
               if ('fail-fast' === fallbackMode) { assertListed(config, entry, profile); }
               const resolved     = resolveRegistry(config, entry.model, entry.driver);
               const substitution = substitutionFor(config, entry, resolved);
               logger.info('dispatch_resolved', {
                  profile, model: resolved.model, driver: resolved.driver, source: 'profile',
               });
               return { ...resolved, source: 'profile', ...(undefined !== substitution ? { substitution } : {}) };
            }
            catch (profileError) {
               if ('fail-fast' === fallbackMode) {
                  logger.error('dispatch_failed', {
                     profile, profileAttempt: { model: entry.model, driver: entry.driver },
                     profileError: printErrorMessage(profileError),
                  });
                  throw profileError;
               }
               return resolveRegistryDefault(config, logger, profile, entry, profileError);
            }
         }

         return resolveRegistryDefault(config, logger, profile, undefined, undefined);
      },
   };
}

function resolveRegistryDefault(
   config:       RegistryConfig,
   logger:       Logger,
   profile:      string | undefined,
   entry:        ProfilePreference | undefined,
   profileError: unknown,
): DispatchResult {
   const who                    = undefined === profile ? {} : { profile };
   const registryDefaultAttempt = { model: config.preferred?.model, driver: config.preferred?.driver };
   try {
      const resolved = resolveRegistryDefaults(config);
      logger.info('dispatch_resolved', {
         ...who, model: resolved.model, driver: resolved.driver, source: 'registry-default',
      });
      // A profile entry was tried and failed: the defaults stand in for it.
      const substitution: DispatchSubstitution | undefined =
         undefined === entry || undefined === profileError
            ? undefined
            : { asked: askedBy(entry), reason: 'entry could not be resolved' };
      return { ...resolved, source: 'registry-default', ...(undefined !== substitution ? { substitution } : {}) };
   }
   catch (registryDefaultError) {
      if (undefined === profileError) {
         // No profile entry at all (or no model) — registry-default is the
         // only attempt that was made; log and surface its error directly.
         logger.error('dispatch_failed', {
            ...who, registryDefaultAttempt, registryDefaultError: printErrorMessage(registryDefaultError),
         });
         throw registryDefaultError;
      }
      logger.error('dispatch_failed', {
         ...who, profileAttempt: { model: entry?.model, driver: entry?.driver }, registryDefaultAttempt,
         profileError:         printErrorMessage(profileError),
         registryDefaultError: printErrorMessage(registryDefaultError),
      });
      throw new DispatchResolutionError(profileError, registryDefaultError, profile);
   }
}
