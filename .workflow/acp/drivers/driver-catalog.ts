/**
 * Driver catalog: loads the drivers a registry names, checks each one, and
 * hands out the working ones by name. One broken driver is logged and left
 * out; the others still load. The build fails only when no usable driver is
 * left, so a service never starts without a working one.
 *
 * The registry's preferred driver may be missing or broken, or may not list the
 * preferred model. That is not a failure: the catalog flags it, logs one warning
 * and supplies a notice that names the driver and model the defaults pick instead.
 *
 * No driver name appears here: everything comes from the registry.
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Diagnostics } from '../shared/diagnostic-log.js';
import { Logger, printErrorMessage } from '../shared/logger.js';
import { resolveRegistryDefaults } from '../modelResolver/resolver.js';
import {
   DriverCatalogBuildError,
   DriverFailure,
   DriverModuleNotFoundError,
   DriverNotInCatalogError,
} from './errors.js';
import { Driver, declaresToolCallGovernance } from './governed-driver.js';
import { RegistryConfig } from './registry.js';

/**
 * Why a driver was left out, or why the preferred driver or model is unavailable.
 * Compare against these constants, not their text.
 */
export const DRIVER_FAILURE = {
   moduleNotFound: 'module not found',
   importFailed:   'import failed',
   noCreateDriver: 'no createDriver',
   factoryFailed:  'factory failed',
   notADriver:     'not a driver',
   nameMismatch:   'name mismatch',
   noGovernance:   'no governance',
   missingMethod:  'missing method',
   notInRegistry:  'not in registry',
   modelNotListed: 'model not listed',
} as const;

/** The working drivers of one registry, and the registry as the resolver should see it. */
export interface DriverCatalog {
   /** The working driver called `name`; throws `DriverNotInCatalogError` otherwise. */
   get(name: string): Driver;
   /** Working driver names, in registry order. */
   names(): string[];
   /** Closes every driver, attempting all, then rethrows the first failure. Safe to repeat. */
   closeAll(): Promise<void>;
   /** The registry without the drivers that failed. Everything else is unchanged. */
   resolverConfig: RegistryConfig;
   /** The driver and model the registry prefers, and what the defaults pick instead. */
   preferred: {
      name:       string;
      /** The preferred model as the registry says. Absent when it names none. */
      model?:     string;
      /** The working driver the registry defaults resolve to. */
      inUse:      string;
      /** The model the registry defaults resolve to. */
      inUseModel: string;
      /**
       * True when the preferred driver is not in the registry or failed a check,
       * or does not list the preferred model.
       */
      flagged:    boolean;
      /** Why it is flagged (a `DRIVER_FAILURE` kind). Absent when not flagged. */
      kind?:      string;
   };
   /** For the user: what is preferred, what is used instead, and why. Only when flagged. */
   notice?: string;
}

export interface BuildDriverCatalogOptions {
   config:        RegistryConfig;
   /** Where the registry file is; relative module paths are read from its folder. */
   registryPath:  string;
   logger:        Logger;
   /** Where drivers record failures of their agents. Passed to every `createDriver`. */
   diagnostics:   Diagnostics;
   /** Loads the module at an absolute path. Default: a real dynamic import. */
   importModule?: (path: string) => Promise<unknown>;
}

/**
 * The file to import for `path`: the path itself, or for a `.js` path the `.ts`
 * file beside it (TypeScript sources are named with a `.js` suffix).
 */
function moduleFile(path: string): string | undefined
{
   const candidates = path.endsWith('.js') ? [path, `${path.slice(0, -3)}.ts`] : [path];
   return candidates.find(file => existsSync(file) && statSync(file).isFile());
}

async function importDriverModule(path: string): Promise<unknown>
{
   const file = moduleFile(path);
   if (undefined === file) { throw new DriverModuleNotFoundError(path); }
   return import(pathToFileURL(file).href);
}

/** The (model, driver) pair the registry defaults resolve to. */
interface InUse { model: string; driver: string; }

interface LoadFailure { kind: string; reason?: string; reportedName?: string; rejected?: unknown; }
type LoadResult = { driver: Driver } | LoadFailure;

/** The methods of the contract every loaded driver must have, in the order a reason names them. */
const REQUIRED_METHODS = ['execute', 'close', 'release'] as const;

/** Runs the checks on one registry entry, in order, and stops at the first that fails. */
async function loadDriver(
   name:         string,
   path:         string,
   logger:       Logger,
   diagnostics:  Diagnostics,
   importModule: (path: string) => Promise<unknown>,
): Promise<LoadResult>
{
   let loaded: any;
   try { loaded = await importModule(path); }
   catch (err) {
      const notFound = err instanceof DriverModuleNotFoundError;
      return { kind: notFound ? DRIVER_FAILURE.moduleNotFound : DRIVER_FAILURE.importFailed,
               reason: printErrorMessage(err) };
   }

   const create = loaded?.createDriver;
   if ('function' !== typeof create) { return { kind: DRIVER_FAILURE.noCreateDriver }; }

   let made: unknown;
   try { made = await create({ logger, diagnostics }); }
   catch (err) { return { kind: DRIVER_FAILURE.factoryFailed, reason: printErrorMessage(err) }; }
   if (null === made || 'object' !== typeof made) { return { kind: DRIVER_FAILURE.notADriver }; }

   const driver = made as Driver;
   if (name !== driver.name)
   { return { kind: DRIVER_FAILURE.nameMismatch, reportedName: String(driver.name), rejected: driver }; }
   if (!declaresToolCallGovernance(driver)) { return { kind: DRIVER_FAILURE.noGovernance, rejected: driver }; }
   const missing = REQUIRED_METHODS.filter(method => 'function' !== typeof driver[method]);
   if (0 < missing.length)
   { return { kind: DRIVER_FAILURE.missingMethod, reason: missing.join(', '), rejected: driver }; }
   return { driver };
}

/** Closes a driver that will not be used; an error from closing is logged, not thrown. */
async function closeQuietly(driver: unknown, name: string, logger: Logger): Promise<void>
{
   const close = (driver as Partial<Driver> | undefined)?.close;
   if ('function' !== typeof close) { return; }
   try { await close.call(driver); }
   catch (err) { logger.error('driver_close_failed', { name, reason: printErrorMessage(err) }); }
}

/** The driver the registry prefers: `preferred.driver`, else the first driver listed. */
function preferredName(config: RegistryConfig): string
{
   return config.preferred?.driver ?? Object.keys(config.drivers)[0];
}

/**
 * Why the preferred driver or model cannot be used, or undefined when it can:
 * not in the registry, failed a check, or its driver does not list the model.
 * A driver problem wins over a model problem.
 */
function flagKind(
   config: RegistryConfig, failures: DriverFailure[], name: string,
): string | undefined
{
   if (!Object.hasOwn(config.drivers, name)) { return DRIVER_FAILURE.notInRegistry; }
   const failed = failures.find(failure => name === failure.name);
   if (undefined !== failed) { return failed.kind; }
   const model = config.preferred?.model;
   return undefined !== model && !config.drivers[name].models.includes(model)
      ? DRIVER_FAILURE.modelNotListed
      : undefined;
}

/** For the user: what is preferred, why it cannot be used, and what is used instead. */
function noticeFor(name: string, model: string | undefined, kind: string, inUse: InUse): string
{
   const preferred = undefined === model ? `driver "${name}"` : `driver "${name}", model "${model}"`;
   return `preferred ${preferred} cannot be used (${kind}); `
        + `using driver "${inUse.driver}", model "${inUse.model}"`;
}

/**
 * Loads and checks every driver in `config`. Each failure is logged once (entry
 * name, resolved path, kind) and the driver is left out. Rejects with
 * `DriverCatalogBuildError` when the registry lists no drivers, when all fail,
 * or when the registry defaults cannot select a working driver.
 */
export async function buildDriverCatalog(options: BuildDriverCatalogOptions): Promise<DriverCatalog>
{
   const { config, registryPath, logger, diagnostics, importModule = importDriverModule } = options;
   const registryDir = dirname(resolve(registryPath));
   const working     = new Map<string, Driver>();
   const failures: DriverFailure[] = [];

   for (const [name, entry] of Object.entries(config.drivers)) {
      const path   = resolve(registryDir, entry.module);
      const result = await loadDriver(name, path, logger, diagnostics, importModule);
      if (!('kind' in result)) {
         working.set(name, result.driver);
         logger.debug('driver_loaded', { name, path });
         continue;
      }
      failures.push({ name, path, kind: result.kind });
      logger.error('driver_failed', {
         name, path, kind: result.kind, reason: result.reason, reportedName: result.reportedName,
      });
      await closeQuietly(result.rejected, name, logger);
   }

   const abort = async (problem: string, fix: string, cause?: unknown): Promise<never> => {
      for (const [name, driver] of working) { await closeQuietly(driver, name, logger); }
      throw new DriverCatalogBuildError(problem, failures, fix, cause);
   };

   const resolverConfig: RegistryConfig = {
      ...config,
      drivers: Object.fromEntries(Object.entries(config.drivers).filter(([name]) => working.has(name))),
   };

   if (0 === Object.keys(config.drivers).length) {
      return abort(`driver registry lists no drivers: ${registryPath}`,
                   'add at least one driver under "drivers:" in the registry.');
   }
   if (0 === working.size) {
      return abort('no driver in the registry could be loaded:',
                   'correct the module paths in the registry, or the driver modules.');
   }
   let inUse: InUse;
   try { inUse = resolveRegistryDefaults(resolverConfig); }
   catch (err) {
      return abort(`the registry defaults cannot select a working driver: ${printErrorMessage(err)}`,
                   'list "auto" under a working driver, or correct the registry defaults.',
                   err);
   }

   const name    = preferredName(config);
   const model   = config.preferred?.model;
   const kind    = flagKind(config, failures, name);
   const flagged = undefined !== kind;
   if (flagged) {
      logger.warn('preferred_unavailable', {
         preferred: name, preferredModel: model,
         inUse: inUse.driver, inUseModel: inUse.model, kind,
      });
   }

   let closing: Promise<void> | undefined;
   const closeEvery = async (): Promise<void> => {
      const results = await Promise.allSettled([...working.values()].map(async driver => driver.close()));
      const failed  = results.find((result): result is PromiseRejectedResult => 'rejected' === result.status);
      if (undefined !== failed) { throw failed.reason; }
   };

   return {
      get(name: string): Driver {
         const driver = working.get(name);
         if (undefined === driver) { throw new DriverNotInCatalogError(name, [...working.keys()]); }
         return driver;
      },
      names:    () => [...working.keys()],
      closeAll: () => (closing ??= closeEvery()),
      resolverConfig,
      preferred: {
         name,
         ...(undefined !== model ? { model } : {}),
         inUse:      inUse.driver,
         inUseModel: inUse.model,
         flagged,
         ...(flagged ? { kind } : {}),
      },
      ...(flagged
         ? { notice: noticeFor(name, model, kind as string, inUse) }
         : {}),
   };
}
