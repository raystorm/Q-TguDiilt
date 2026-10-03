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
 *   own `preferredModel`/`preferredDriver` defaults, and raises one
 *   combined error (wrapping both underlying failures) when both fail.
 *   `fallbackMode: 'fail-fast'` skips the registry-default attempt
 *   entirely and surfaces the profile failure immediately.
 *
 * No hardcoded driver/model names anywhere in this module — everything
 * comes from the externalized YAML registry (loaded fail-closed by
 * `../drivers/registry.js`).
 */
import { Logger, printErrorMessage } from '../shared/logger.js';
import { loadRegistryConfig, FallbackMode, RegistryConfig } from '../drivers/registry.js';
import { DispatchResult } from './types.js';
import { NoDriverAvailableError, DispatchResolutionError } from './errors.js';

/** The implicit fallback model, assumed supported by every driver. */
const AUTO_MODEL = 'auto';

/** True when `driver` is given and exists in the registry and supports `model`. */
function driverSupports(config: RegistryConfig, driver: string | undefined, model: string): boolean {
   return undefined !== driver && (config.drivers[driver]?.models.includes(model) ?? false);
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
   const requestedModel = model;

   if (undefined !== model) {
      // Step 1: (model, driver) given, driver supports model -> use it.
      if (driverSupports(config, driver, model)) { return { model, driver: driver as string }; }

      // Step 2: model given, no driver match (or none given) -> first driver
      // in registry order that supports it; preferredModel binding wins,
      // then preferredDriver tie-break.
      if (undefined !== config.preferredModel && config.preferredModel.model === model &&
         driverSupports(config, config.preferredModel.driver, model)) {
         return { model, driver: config.preferredModel.driver };
      }
      if (driverSupports(config, config.preferredDriver, model)) {
         return { model, driver: config.preferredDriver as string };
      }
      const firstMatch = firstDriverSupporting(config, model);
      if (undefined !== firstMatch) { return { model, driver: firstMatch }; }
   }

   // Step 3: named model not found (or none given) -> retry with "auto",
   // keeping whatever driver context is already known.
   const autoDriverContext = driver ?? config.preferredDriver ?? firstRegisteredDriver(config);

   if (driverSupports(config, autoDriverContext, AUTO_MODEL)) {
      return { model: AUTO_MODEL, driver: autoDriverContext as string };
   }
   const firstAutoMatch = firstDriverSupporting(config, AUTO_MODEL);
   if (undefined !== firstAutoMatch) { return { model: AUTO_MODEL, driver: firstAutoMatch }; }

   // Step 4: no driver available even for "auto" -> fail closed, never silent.
   throw new NoDriverAvailableError(requestedModel,
                                    new Error(`no driver in the registry supports "${AUTO_MODEL}"`));
}

export interface DispatchResolver { resolve(profile: string): DispatchResult; }

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
      resolve(profile: string): DispatchResult {
         const profilePref    = config.profiles?.[profile];
         const profileAttempt = { model: profilePref?.model, driver: profilePref?.driver };

         if (undefined !== profilePref && '' !== profilePref.model) {
            try {
               const resolved = resolveRegistry(config, profilePref.model, profilePref.driver);
               logger.info('dispatch_resolved', {
                  profile, model: resolved.model, driver: resolved.driver, source: 'profile',
               });
               return { ...resolved, source: 'profile' };
            }
            catch (profileError) {
               if ('fail-fast' === fallbackMode) {
                  logger.error('dispatch_failed', {
                     profile, profileAttempt, profileError: printErrorMessage(profileError),
                  });
                  throw profileError;
               }
               return resolveRegistryDefault(config, logger, profile, profileAttempt, profileError);
            }
         }

         return resolveRegistryDefault(config, logger, profile, profileAttempt, undefined);
      },
   };
}

function resolveRegistryDefault(
   config:         RegistryConfig,
   logger:         Logger,
   profile:        string,
   profileAttempt: { model?: string; driver?: string },
   profileError:   unknown,
): DispatchResult {
   const registryDefaultAttempt = { model: config.preferredModel?.model, driver: config.preferredDriver };
   try {
      const resolved = resolveRegistry(config, config.preferredModel?.model, config.preferredDriver);
      logger.info('dispatch_resolved', {
         profile, model: resolved.model, driver: resolved.driver, source: 'registry-default',
      });
      return { ...resolved, source: 'registry-default' };
   }
   catch (registryDefaultError) {
      if (undefined === profileError) {
         // No profile entry at all (or no model) — registry-default is the
         // only attempt that was made; log and surface its error directly.
         logger.error('dispatch_failed', {
            profile, registryDefaultAttempt, registryDefaultError: printErrorMessage(registryDefaultError),
         });
         throw registryDefaultError;
      }
      logger.error('dispatch_failed', {
         profile, profileAttempt, registryDefaultAttempt,
         profileError:         printErrorMessage(profileError),
         registryDefaultError: printErrorMessage(registryDefaultError),
      });
      throw new DispatchResolutionError(profileError, registryDefaultError);
   }
}
