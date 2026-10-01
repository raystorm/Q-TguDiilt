/**
 * Error taxonomy owned by the Governance Engine.
 *
 * Config load/parse failures must fail closed (never default to
 * approve-all), so every failure mode here is a distinct, named error
 * carrying the offending file path and problem for an actionable message.
 */

/** Governance config file does not exist at the configured path. */
export class GovernanceConfigMissingError extends Error {
   readonly kind = 'governance_config_missing';

   constructor(filePath: string) {
      super(`governance config not found: ${filePath}`);
      this.name = 'GovernanceConfigMissingError';
   }
}

/** Governance config file exists but is not valid YAML. */
export class GovernanceConfigParseError extends Error {
   readonly kind = 'governance_config_parse';

   constructor(filePath: string, cause: unknown) {
      super(`governance config is not valid YAML: ${filePath}`, { cause });
      this.name = 'GovernanceConfigParseError';
   }
}

/** Governance config parsed but violates the required shape. */
export class GovernanceConfigInvalidError extends Error {
   readonly kind = 'governance_config_invalid';

   constructor(filePath: string, problem: string) {
      super(`governance config is invalid (${filePath}): ${problem}`);
      this.name = 'GovernanceConfigInvalidError';
   }
}
