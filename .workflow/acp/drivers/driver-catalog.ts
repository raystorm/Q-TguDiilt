/**
 * Driver catalog: loads the drivers a registry names, checks each one, and
 * hands out the working ones by name. One broken driver is logged and left
 * out; the others still load. The build fails only when no usable driver is
 * left, so a service never starts without a working one.
 *
 * The registry's preferred driver may be missing or broken. That is not a
 * failure: the catalog flags it, logs one warning and supplies a notice that
 * names the driver the defaults pick instead.
 *
 * No driver name appears here: everything comes from the registry.
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Logger, printErrorMessage } from '../shared/logger.js';
import { resolveRegistry } from '../modelResolver/resolver.js';
import {
   DriverCatalogBuildError,
   DriverFailure,
   DriverModuleNotFoundError,
   DriverNotInCatalogError,
} from './errors.js';
import { Driver, declaresToolCallGovernance } from './governed-driver.js';
import { RegistryConfig } from './registry.js';

/**
 * Why a driver was left out, or why the preferred driver is unavailable.
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
   notInRegistry:  'not in registry',
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
   /** The driver the registry prefers, and the working driver the defaults pick in its place. */
   preferred: {
      name:    string;
      /** The working driver the registry defaults resolve to. */
      inUse:   string;
      /** True when the preferred driver is not in the registry, or failed a check. */
      flagged: boolean;
      /** Why it is flagged (a `DRIVER_FAILURE` kind). Absent when not flagged. */
      kind?:   string;
   };
   /** For the user: the preferred driver, the driver in use and the kind. Only when flagged. */
   notice?: string;
}

export interface BuildDriverCatalogOptions {
   config:        RegistryConfig;
   /** Where the registry file is; relative module paths are read from its folder. */
   registryPath:  string;
   logger:        Logger;
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

interface LoadFailure { kind: string; reason?: string; reportedName?: string; rejected?: unknown; }
type LoadResult = { driver: Driver } | LoadFailure;

/** Runs the checks on one registry entry, in order, and stops at the first that fails. */
async function loadDriver(
   name:         string,
   path:         string,
   logger:       Logger,
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
   try { made = await create({ logger }); }
   catch (err) { return { kind: DRIVER_FAILURE.factoryFailed, reason: printErrorMessage(err) }; }
   if (null === made || 'object' !== typeof made) { return { kind: DRIVER_FAILURE.notADriver }; }

   const driver = made as Driver;
   if (name !== driver.name)
   { return { kind: DRIVER_FAILURE.nameMismatch, reportedName: String(driver.name), rejected: driver }; }
   if (!declaresToolCallGovernance(driver)) { return { kind: DRIVER_FAILURE.noGovernance, rejected: driver }; }
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

/**
 * The driver the registry prefers: `preferredModel.driver`, else `preferredDriver`,
 * else the first driver listed.
 */
function preferredName(config: RegistryConfig): string
{
   return config.preferredModel?.driver ?? config.preferredDriver ?? Object.keys(config.drivers)[0];
}

/**
 * Loads and checks every driver in `config`. Each failure is logged once (entry
 * name, resolved path, kind) and the driver is left out. Rejects with
 * `DriverCatalogBuildError` when the registry lists no drivers, when all fail,
 * or when the registry defaults cannot select a working driver.
 */
export async function buildDriverCatalog(options: BuildDriverCatalogOptions): Promise<DriverCatalog>
{
   const { config, registryPath, logger, importModule = importDriverModule } = options;
   const registryDir = dirname(resolve(registryPath));
   const working     = new Map<string, Driver>();
   const failures: DriverFailure[] = [];

   for (const [name, entry] of Object.entries(config.drivers)) {
      const path   = resolve(registryDir, entry.module);
      const result = await loadDriver(name, path, logger, importModule);
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
   const { preferredModel, preferredDriver } = config;
   let inUse: string;
   try { inUse = resolveRegistry(resolverConfig, preferredModel?.model, preferredDriver).driver; }
   catch (err) {
      return abort(`the registry defaults cannot select a working driver: ${printErrorMessage(err)}`,
                   'list "auto" under a working driver, or correct the registry defaults.',
                   err);
   }

   const name = preferredName(config);
   const kind = Object.hasOwn(config.drivers, name)
      ? failures.find(failure => name === failure.name)?.kind
      : DRIVER_FAILURE.notInRegistry;
   const flagged = undefined !== kind;
   if (flagged) { logger.warn('preferred_driver_unavailable', { preferred: name, inUse, kind }); }

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
      preferred: { name, inUse, flagged, ...(flagged ? { kind } : {}) },
      ...(flagged
         ? { notice: `preferred driver "${name}" is unavailable (${kind}); using "${inUse}"` }
         : {}),
   };
}
