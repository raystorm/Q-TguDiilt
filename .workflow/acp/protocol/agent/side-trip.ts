/**
 * A side trip: the main profile's session is parked while the profiles of the trip run, one after
 * another, each in a session of its own. When the trip ends, the last session is released and the
 * parked one is restored. The trip is open while the record's `parked` slot is set.
 */
import type { SessionRecord } from '../session-store.js';

/**
 * The prompt the restored session gets: fixed, it names the last profile of the trip and carries
 * none of its results. It holds no `@` or `/` word and does not begin with `as`, so it is never
 * taken for a command.
 */
export const returnPrompt = (profile: string) =>
   `The side trip to ${profile} is finished. Its results are in the files it changed and in the `
   + 'workflow log. Continue your work.';

/** The chat line when a side-trip profile starts. */
export const sideTripLine = (profile: string) => `Side trip: ${profile}`;

/** The chat line at the return. */
export const backLine = (profile: string) => `Back to ${profile}`;

/** What the boundary needs to end a side trip: a way to release the session that is running. */
export function createSideTrip(
   { releaseDriverSession }: { releaseDriverSession: (record: SessionRecord) => Promise<void> },
) {
   /**
    * Ends the trip of `record`: releases the running session (a failed release is logged and does
    * not stop this), then puts the parked session back as the record's own and empties the slot.
    * The profile the main thread had is not resolved again.
    */
   async function end(record: SessionRecord): Promise<void> {
      const { parked } = record;
      await releaseDriverSession(record);
      if (undefined === parked) { return; }
      record.driver          = parked.driver;
      record.model           = parked.model;
      record.driverSessionId = parked.driverSessionId;
      record.profile         = parked.profile;
      record.parked          = undefined;
   }

   return { end };
}

export type SideTrip = ReturnType<typeof createSideTrip>;
