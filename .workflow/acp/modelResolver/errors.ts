/**
 * Error taxonomy owned by the Model Dispatch resolver.
 *
 * Registry config load errors (`RegistryConfigMissingError`, etc.) live
 * in `../drivers/errors.js` — that module owns registry loading. This
 * module only defines errors specific to dispatch resolution itself.
 */
import { TguDiiltError, defineError } from '../shared/errors.js';
import { printErrorMessage } from '../shared/logger.js';

/** No driver in the registry supports the requested (named) model. */
export const ModelNotFoundError = defineError(
   'ModelNotFoundError',
   (model: string) => ({ message: `no driver in the registry supports model: ${model}` }),
);

/** The requested/resolved driver does not exist in the registry. */
export const DriverNotFoundError = defineError(
   'DriverNotFoundError',
   (driver: string) => ({ message: `driver not found in registry: ${driver}` }),
);

/**
 * Terminal registry-resolution failure: no driver is available even for
 * the `auto` model fallback. Fail-closed, never silent.
 */
export const NoDriverAvailableError = defineError(
   'NoDriverAvailableError',
   (attemptedModel: string | undefined, autoCause: unknown) => ({
      message: `no driver available for ${attemptedModel ? `model "${attemptedModel}" or ` : ''}` +
         `fallback model "auto": ${autoCause instanceof Error ? autoCause.message : String(autoCause)}`,
      cause: autoCause,
   }),
);

/**
 * Both the profile-preference resolution and the registry-default
 * resolution failed. Wraps both underlying errors rather than swallowing
 * either.
 *
 * Carries `profileError`/`registryDefaultError` in addition to the base
 * `name` — kept as a hand-written subclass (rather than `defineError`)
 * because it has these extra fields.
 */
export class DispatchResolutionError extends TguDiiltError {
   constructor(
      // `unknown` because these come from `catch` clauses
      // (TS types catch variables as `unknown`, never narrowed to what was thrown).
      // Expected runtime type: NoDriverAvailableError (from resolveRegistry).
      readonly profileError: unknown,
      // Expected runtime type: NoDriverAvailableError (from resolveRegistry).
      readonly registryDefaultError: unknown,
   ) {
      super(
         'no model/driver could be resolved from profile or registry defaults: ' +
         `profile attempt failed (${printErrorMessage(profileError)}); ` +
         `registry default attempt failed (${printErrorMessage(registryDefaultError)})`,
      );
      this.name = 'DispatchResolutionError';
   }
}
