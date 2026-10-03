/**
 * Error taxonomy owned by the Governance Engine.
 *
 * Config load/parse failures must fail closed (never default to
 * approve-all), so every failure mode here is a distinct, named error
 * carrying the offending file path and problem for an actionable message.
 */
import { defineError } from '../shared/errors.js';

/** Governance config file does not exist at the configured path. */
export const GovernanceConfigMissingError = defineError(
   'GovernanceConfigMissingError',
   (filePath: string) => ({ message: `governance config not found: ${filePath}` }),
);

/** Governance config file exists but is not valid YAML. */
export const GovernanceConfigParseError = defineError(
   'GovernanceConfigParseError',
   (filePath: string, cause: unknown) =>
      ({ message: `governance config is not valid YAML: ${filePath}`, cause }),
);

/** Governance config parsed but violates the required shape. */
export const GovernanceConfigInvalidError = defineError(
   'GovernanceConfigInvalidError',
   (filePath: string, problem: string) =>
      ({ message: `governance config is invalid (${filePath}): ${problem}` }),
);
