/**
 * Applying the profile a command activates: the driver and model it resolves to, the session it
 * releases, and the driver of a record that governs tool calls.
 */
import { Driver, declaresToolCallGovernance } from '../../drivers/governed-driver.js';
import { join } from 'node:path';
import type { DriverCatalog } from '../../drivers/driver-catalog.js';
import type { DispatchResolver } from '../../modelResolver/resolver.js';
import type { DispatchResult, DispatchSubstitution } from '../../modelResolver/types.js';
import { Logger } from '../../shared/logger.js';
import { redact } from '../../shared/redact.js';
import { DriverGovernanceUnsupportedError, boundaryErrorKind } from '../errors.js';
import {
   HANDOFF_PATH,
   MESSAGE_PATH,
   ProfileNames,
   detectActivation,
   readChangeoverTarget,
} from '../workflow-command.js';
import { SessionRecord } from '../session-store.js';

/** The one chat line that says a profile did not get what it asked for. */
function substitutionLine(profile: string, used: DispatchResult, substitution: DispatchSubstitution): string
{
   const { asked, reason } = substitution;
   const askedDriver = undefined === asked.driver ? '' : `driver "${asked.driver}", `;
   return `Profile "${profile}" asks for ${askedDriver}model "${asked.model}"; ` +
      `using driver "${used.driver}", model "${used.model}" (${reason}).`;
}

/** What the boundary needs to apply a profile: the driver and model it resolves to. */
export function createActivation(
   { catalog, resolver, logger, profileNames, workDir }: {
      catalog: DriverCatalog; resolver: DispatchResolver; logger: Logger;
      profileNames: ProfileNames; workDir: string;
   },
) {
   /** Ends the process behind the record's driver session. A failure is logged by kind only. */
   async function releaseDriverSession(record: SessionRecord): Promise<void> {
      const id = record.driverSessionId;
      if (undefined === id || '' === id) { return; }
      try { await catalog.get(record.driver as string).release(id); }
      catch (err) {
         logger.warn('release_failed', {
            sessionId: record.sessionId, failureKind: boundaryErrorKind(err) ?? 'internal',
         });
      }
   }

   /**
    * Applies the profile a command activates: the driver and model it resolves to. The profile
    * is the name typed after `as` (or a shortcut's), or, for `@start` and `@receive`, the one
    * the changeover file names, read now and never cached. A different driver releases the old
    * session first and starts a new one; `fresh` does that even when the driver is the same.
    * `park` keeps the old session instead: it is saved in the record's `parked` slot, not
    * released, and a new session starts. The release or the parking comes after the resolution
    * succeeded, so a resolution that throws leaves the record as it was. Does not touch the
    * active-turn flag. Resolves true when a profile was applied, false when the command names
    * none that can be found.
    */
   async function applyActivation(
      record: SessionRecord, command: string, options: { fresh?: boolean; park?: boolean } = {},
   ): Promise<boolean> {
      const activation = detectActivation(command);
      if (undefined === activation) { return false; }

      // The path never comes from the command text.
      const changeover = 'changeover' === activation.kind;
      const file       = 'start' === activation.command ? HANDOFF_PATH : MESSAGE_PATH;
      const name       = changeover ? readChangeoverTarget(join(workDir, file)) : activation.name;
      const profile    = undefined === name ? undefined : profileNames.resolve(name);
      if (undefined === profile) {
         // The word is free text from the user: redacted, then capped.
         logger.info('profile_unknown', {
            sessionId: record.sessionId,
            source:    changeover ? 'changeover' : 'prompt',
            reason:    undefined === name ? 'no target' : 'unknown name',
            ...(undefined === name ? {} : { word: redact(name).slice(0, 64) }),
         });
         return false;
      }

      const result = resolver.resolve(profile);
      const { driver, model, substitution } = result;
      if (true === options.park) {
         record.parked = {
            driver: record.driver as string, model: record.model,
            driverSessionId: record.driverSessionId, profile: record.profile,
         };
         record.driverSessionId = undefined;
      }
      else if (driver !== record.driver || true === options.fresh) {
         await releaseDriverSession(record);
         record.driverSessionId = undefined;
      }
      const previous = record.profile;
      record.driver  = driver;
      record.model   = model;
      record.profile = profile;
      // Set at every resolution. A profile that got what it asked for has no notice; one with
      // no entry gets the catalog notice again.
      if (undefined !== substitution) { record.notice = substitutionLine(profile, result, substitution); }
      else { record.notice = 'registry-default' === result.source ? catalog.notice : undefined; }

      // Logged only now, after the activation was applied.
      const fields = { sessionId: record.sessionId, profile };
      if (changeover) { logger.info('profile_activated', { ...fields, source: 'changeover' }); }
      else if (undefined !== previous) {
         logger.warn('profile_reactivated', { ...fields, previous });
         if (previous !== profile) { logger.warn('profile_switched', { ...fields, previous }); }
      }
      return true;
   }

   /** The record's driver. One that cannot govern tool calls is refused. */
   function governedDriver(sessionId: string, record: SessionRecord): Driver {
      const driver = catalog.get(record.driver as string);
      if (!declaresToolCallGovernance(driver)) {
         logger.error('driver_governance_unsupported', { sessionId, driver: driver.name ?? 'unnamed' });
         throw new DriverGovernanceUnsupportedError(driver.name);
      }
      return driver;
   }

   return { applyActivation, governedDriver, releaseDriverSession };
}

export type Activation = ReturnType<typeof createActivation>;
