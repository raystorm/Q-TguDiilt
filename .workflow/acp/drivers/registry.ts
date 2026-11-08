/**
 * Driver registry config: schema and loader for the YAML file that maps
 * driver names to supported models, with an optional system default
 * (`preferred`) and per-profile (`profiles:`)
 * preference. See `registry.example.yaml` and `EXTENDING.md` for the
 * documented format.
 *
 * Loading fails closed (mirrors the Governance Engine's config-error
 * pattern): a missing file, malformed YAML, or an invalid shape throws a
 * named, actionable error.
 */
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import {
   RegistryConfigMissingError,
   RegistryConfigParseError,
   RegistryConfigInvalidError,
} from './errors.js';

/**
 * A single driver registry entry: the module that provides the driver
 * (path as written in the registry file, not resolved here) and the
 * models that driver supports.
 */
export interface RegistryDriverEntry { module: string; models: string[]; }

/** The registry's system default: a driver, and optionally a model on it. */
export interface PreferredDefaults {
   driver: string;
   model?: string;
}

/** Per-profile model/driver preference under the registry's `profiles:` section. */
export interface ProfilePreference {
   model:   string;
   driver?: string;
}

/**
 * Fallback behavior when a profile's own model/driver preference fails to
 * resolve. System-level (applies uniformly to all profiles), not
 * per-profile — an operator drift-tolerance policy, not a per-dispatch
 * decision (Architect decision, 2026-10-03).
 */
export type FallbackMode = 'fail-fast' | 'fallback-to-default-driver';

/** Parsed shape of the driver registry YAML config. */
export interface RegistryConfig {
   drivers:          Record<string, RegistryDriverEntry>;
   preferred?:       PreferredDefaults;
   profiles?:        Record<string, ProfilePreference>;
   /** Default: 'fallback-to-default-driver' (see `FallbackMode`). */
   fallbackMode?:    FallbackMode;
}

/** The top-level keys a registry file may have. Any other key is rejected. */
const KNOWN_KEYS = ['drivers', 'preferred', 'profiles', 'fallbackMode'];

/** Reads and parses the driver registry YAML config. Fails closed on any error. */
export function loadRegistryConfig(filePath: string): RegistryConfig
{
   let raw: string;
   try { raw = readFileSync(filePath, 'utf8'); }
   catch { throw new RegistryConfigMissingError(filePath); }

   let doc: unknown;
   try { doc = parseYaml(raw); }
   catch (cause) { throw new RegistryConfigParseError(filePath, cause); }

   return validateConfigShape(filePath, doc);
}

/** Validates the parsed YAML document shape; throws on any deviation. */
function validateConfigShape(filePath: string, doc: unknown): RegistryConfig
{
   if (null === doc || 'object' !== typeof doc || Array.isArray(doc))
   { throw new RegistryConfigInvalidError(filePath, 'root document must be an object'); }

   const unknownKeys = Object.keys(doc).filter(key => !KNOWN_KEYS.includes(key));
   if (0 !== unknownKeys.length) {
      throw new RegistryConfigInvalidError(
         filePath,
         `unknown top-level key(s) ${unknownKeys.map(key => `"${key}"`).join(', ')}; ` +
         `known keys: ${KNOWN_KEYS.join(', ')}`,
      );
   }

   const { drivers: rawDrivers, preferred, profiles, fallbackMode } = doc as Record<string, unknown>;

   if (null === rawDrivers || 'object' !== typeof rawDrivers || Array.isArray(rawDrivers))
   { throw new RegistryConfigInvalidError(filePath, 'missing required "drivers" key'); }

   const drivers: RegistryConfig['drivers'] = {};
   for (const [name, rawEntry] of Object.entries(rawDrivers as Record<string, unknown>)) {
      if (null === rawEntry || 'object' !== typeof rawEntry)
      { throw new RegistryConfigInvalidError(filePath, `driver "${name}" must be an object`); }
      const { module: modulePath, models } = rawEntry as Record<string, unknown>;
      if ('string' !== typeof modulePath || '' === modulePath.trim())
      {
         throw new RegistryConfigInvalidError(filePath,
                                              `driver "${name}" must have a non-empty string "module"`);
      }
      if (!Array.isArray(models) || 0 === models.length)
      {
         throw new RegistryConfigInvalidError(filePath,
                                              `driver "${name}" must have a non-empty "models" list`);
      }
      drivers[name] = { module: modulePath, models: models as string[] };
   }

   const config: RegistryConfig = { drivers };

   if (undefined !== preferred) { config.preferred = validatePreferred(filePath, preferred); }

   if (undefined !== profiles) { config.profiles = validateProfiles(filePath, profiles); }

   if (undefined !== fallbackMode) {
      if ('fail-fast' !== fallbackMode && 'fallback-to-default-driver' !== fallbackMode) {
         throw new RegistryConfigInvalidError(
            filePath,
            `"fallbackMode" must be "fail-fast" or "fallback-to-default-driver", got: ${JSON.stringify(fallbackMode)}`,
         );
      }
      config.fallbackMode = fallbackMode;
   }

   return config;
}

function validatePreferred(filePath: string, raw: unknown): PreferredDefaults {
   if (null === raw || 'object' !== typeof raw || Array.isArray(raw))
   { throw new RegistryConfigInvalidError(filePath, '"preferred" must be an object'); }
   const { driver, model } = raw as Record<string, unknown>;
   if ('string' !== typeof driver || '' === driver)
   { throw new RegistryConfigInvalidError(filePath, '"preferred.driver" must be a non-empty string'); }
   if (undefined === model) { return { driver }; }
   if ('string' !== typeof model || '' === model)
   { throw new RegistryConfigInvalidError(filePath, '"preferred.model" must be a non-empty string'); }
   return { driver, model };
}

function validateProfiles(filePath: string, raw: unknown): RegistryConfig['profiles'] {
   if (null === raw || 'object' !== typeof raw || Array.isArray(raw))
   { throw new RegistryConfigInvalidError(filePath, '"profiles" must be an object'); }

   const profiles: NonNullable<RegistryConfig['profiles']> = {};
   for (const [name, rawEntry] of Object.entries(raw as Record<string, unknown>)) {
      if (null === rawEntry || 'object' !== typeof rawEntry)
      { throw new RegistryConfigInvalidError(filePath, `profiles entry "${name}" must be an object`); }
      const { model, driver } = rawEntry as Record<string, unknown>;
      if ('string' !== typeof model || '' === model)
      {
         throw new RegistryConfigInvalidError(
            filePath, `profiles entry "${name}" must have a non-empty string "model"`);
      }
      if (undefined !== driver && ('string' !== typeof driver))
      { throw new RegistryConfigInvalidError(filePath, `profiles entry "${name}.driver" must be a string`); }
      profiles[name] = { model, ...(driver ? { driver: driver as string } : {}) };
   }
   return profiles;
}
