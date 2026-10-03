/**
 * Error taxonomy owned by the driver registry loader.
 *
 * Config load/parse failures must fail closed, so every failure mode here
 * is a distinct, named error carrying the offending file path and problem
 * for an actionable message (mirrors the Governance Engine's errors.ts).
 */
import { defineError } from '../shared/errors.js';

/** Driver registry config file does not exist at the configured path. */
export const RegistryConfigMissingError = defineError(
   'RegistryConfigMissingError',
   (filePath: string) => ({ message: `driver registry config not found: ${filePath}` }),
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
