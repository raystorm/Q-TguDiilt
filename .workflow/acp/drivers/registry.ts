/**
 * Driver registry config: schema and loader for the YAML file that maps
 * driver names to supported models, with optional system-default
 * (`preferredDriver`/`preferredModel`) and per-profile (`profiles:`)
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

/** A single driver registry entry: the models that driver supports. */
export interface RegistryDriverEntry { models: string[]; }

/** Binds a specific model to a specific driver; overrides `preferredDriver`. */
export interface PreferredModel {
   model:  string;
   driver: string;
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
   preferredDriver?: string;
   preferredModel?:  PreferredModel;
   profiles?:        Record<string, ProfilePreference>;
   /** Default: 'fallback-to-default-driver' (see `FallbackMode`). */
   fallbackMode?:    FallbackMode;
}

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

   const { drivers: rawDrivers, preferredDriver, preferredModel, profiles, fallbackMode } =
      doc as Record<string, unknown>;

   if (null === rawDrivers || 'object' !== typeof rawDrivers || Array.isArray(rawDrivers))
   { throw new RegistryConfigInvalidError(filePath, 'missing required "drivers" key'); }

   const drivers: RegistryConfig['drivers'] = {};
   for (const [name, rawEntry] of Object.entries(rawDrivers as Record<string, unknown>)) {
      if (null === rawEntry || 'object' !== typeof rawEntry)
      { throw new RegistryConfigInvalidError(filePath, `driver "${name}" must be an object`); }
      const { models } = rawEntry as Record<string, unknown>;
      if (!Array.isArray(models) || 0 === models.length)
      {
         throw new RegistryConfigInvalidError(filePath,
                                              `driver "${name}" must have a non-empty "models" list`);
      }
      drivers[name] = { models: models as string[] };
   }

   const config: RegistryConfig = { drivers };

   if (undefined !== preferredDriver)
   {
      if ('string' !== typeof preferredDriver || '' === preferredDriver)
      { throw new RegistryConfigInvalidError(filePath, '"preferredDriver" must be a non-empty string'); }
      config.preferredDriver = preferredDriver;
   }

   if (undefined !== preferredModel)
   { config.preferredModel = validatePreferredModel(filePath, preferredModel); }

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

function validatePreferredModel(filePath: string, raw: unknown): PreferredModel {
   if (null === raw || 'object' !== typeof raw)
   { throw new RegistryConfigInvalidError(filePath, '"preferredModel" must be an object'); }
   const { model, driver } = raw as Record<string, unknown>;
   if ('string' !== typeof model || '' === model)
   { throw new RegistryConfigInvalidError(filePath, '"preferredModel.model" must be a non-empty string'); }
   if ('string' !== typeof driver || '' === driver)
   { throw new RegistryConfigInvalidError(filePath, '"preferredModel.driver" must be a non-empty string'); }
   return { model, driver };
}

function validateProfiles(filePath: string, raw: unknown): RegistryConfig['profiles'] {
   if (null === raw || 'object' !== typeof raw || Array.isArray(raw))
   { throw new RegistryConfigInvalidError(filePath, '"profiles" must be an object'); }

   const profiles: NonNullable<RegistryConfig['profiles']> = {};
   for (const [name, rawEntry] of Object.entries(raw as Record<string, unknown>)) {
      if (null === rawEntry || 'object' !== typeof rawEntry)
      { throw new RegistryConfigInvalidError(filePath, `profiles entry "${name}" must be an object`); }
      const { model, driver } = rawEntry as Record<string, unknown>;
      if (undefined !== model && ('string' !== typeof model))
      { throw new RegistryConfigInvalidError(filePath, `profiles entry "${name}.model" must be a string`); }
      if (undefined !== driver && ('string' !== typeof driver))
      { throw new RegistryConfigInvalidError(filePath, `profiles entry "${name}.driver" must be a string`); }
      profiles[name] = { model: (model as string) ?? '', ...(driver ? { driver: driver as string } : {}) };
   }
   return profiles;
}
