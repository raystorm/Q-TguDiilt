/**
 * Error taxonomy owned by the driver registry loader and the driver catalog.
 *
 * Config load/parse failures must fail closed, so every failure mode here
 * is a distinct, named error carrying the offending file path and problem
 * for an actionable message (mirrors the Governance Engine's errors.ts).
 */
import { TguDiiltError, defineError } from '../shared/errors.js';

/** Driver registry config file does not exist at the configured path. */
export const RegistryConfigMissingError = defineError(
   'RegistryConfigMissingError',
   (filePath: string) => ({
      message: `driver registry config not found: ${filePath}. `
             + 'Copy registry.example.yaml to registry.yaml in the same folder, then edit it.',
   }),
);

/** Driver registry config file exists but is not valid YAML. */
export const RegistryConfigParseError = defineError(
   'RegistryConfigParseError',
   (filePath: string, cause: unknown) =>
      ({ message: `driver registry config is not valid YAML: ${filePath}`, cause }),
);

/** Driver registry config parsed but violates the required shape. */
export const RegistryConfigInvalidError = defineError(
   'RegistryConfigInvalidError',
   (filePath: string, problem: string) =>
      ({ message: `driver registry config is invalid (${filePath}): ${problem}` }),
);

/** A driver the catalog could not load: its registry entry, resolved module path and failure kind. */
export interface DriverFailure { name: string; path: string; kind: string; }

/** The default import found no module file at the resolved path. */
export const DriverModuleNotFoundError = defineError(
   'DriverModuleNotFoundError',
   (path: string) => ({ message: `driver module not found: ${path}` }),
);

/** `get` was asked for a driver that is not in the catalog. */
export const DriverNotInCatalogError = defineError(
   'DriverNotInCatalogError',
   (name: string, available: string[]) => ({
      message: `driver not in catalog: "${name}" (available: ${available.join(', ') || 'none'})`,
   }),
);

/**
 * The catalog cannot be built: the registry lists no drivers, none works, or its
 * defaults cannot select a working one. Hand-written (not `defineError`) because
 * it carries the failure list.
 */
export class DriverCatalogBuildError extends TguDiiltError {
   constructor(
      problem: string,
      readonly failures: readonly DriverFailure[],
      fix: string,
      cause?: unknown,
   ) {
      const lines = failures.map(failure => `  - ${failure.name}: ${failure.path} (${failure.kind})`);
      super([problem, ...lines, `Fix: ${fix}`].join('\n'), undefined !== cause ? { cause } : undefined);
      this.name = 'DriverCatalogBuildError';
   }
}
