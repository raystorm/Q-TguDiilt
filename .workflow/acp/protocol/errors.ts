/**
 * Error taxonomy owned by the ACP Service Boundary.
 *
 * Transport, malformed-message, unknown-method, and protocol-version errors
 * are handled by the ACP SDK. These classes cover the boundary's own,
 * domain-specific outcomes that the translation seam must surface distinctly.
 */
import { TguDiiltError, defineError } from '../shared/errors.js';

/**
 * A second prompt turn arrived while one is already in flight on the same
 * session. This is session-lifecycle backpressure, NOT a transport or
 * malformed-input error. The in-flight turn is unaffected; the client may
 * retry after it completes.
 *
 * Carries `retryable = true` in addition to the base `name` — kept as a
 * hand-written subclass (rather than `defineError`) because it has this
 * extra field.
 */
export class TurnInProgressError extends TguDiiltError {
   readonly retryable = true;

   constructor(sessionId: string) {
      super(`a turn is already in progress for session ${sessionId}`);
      this.name = 'TurnInProgressError';
   }
}

/** Provider quota / rate-limit reached. Actionable and resumable. */
export const ProviderQuotaError = defineError(
   'ProviderQuotaError',
   (message: string) => ({ message }),
);

/** Provider authentication required (e.g. re-login). Actionable and resumable. */
export const ProviderAuthError = defineError(
   'ProviderAuthError',
   (message: string) => ({ message }),
);

/**
 * Session continuity collapsed: the provider session expired AND/OR the
 * context window overflowed. Detected and surfaced; recovery is out of scope
 * (the ACP Service Boundary never silently starts a fresh context).
 */
export const SessionCollapseError = defineError(
   'SessionCollapseError',
   (message: string) => ({ message }),
);

/**
 * The resolved driver does not declare tool-call governance support (flag
 * false or absent). Raised before any work
 * starts; there is no warn mode and no setting.
 */
export const DriverGovernanceUnsupportedError = defineError(
   'DriverGovernanceUnsupportedError',
   (driverName: string | undefined) => ({
      message: `${undefined === driverName ? 'an unnamed driver' : `driver ${driverName}`} ` +
         'cannot report tool calls, so tool-call governance cannot be enforced; ' +
         'use a driver that declares supportsToolCallGovernance: true',
   }),
);

/**
 * The profile names file cannot be used: it is missing or cannot be read, or it lists the same
 * alias twice. The message names the file and, for a duplicate, the alias.
 */
export const ProfileError = defineError(
   'ProfileError',
   (message: string, cause?: unknown) => ({ message, cause }),
);

/** The distinct error `kind` values the boundary maps to an ACP error stop. */
export type BoundaryErrorKind =
   | 'provider_quota'
   | 'provider_auth'
   | 'session_collapse';

/** Maps a caught error to a boundary error kind, or undefined if generic. */
export function boundaryErrorKind(err: unknown): BoundaryErrorKind | undefined {
   if (err instanceof ProviderQuotaError)   { return 'provider_quota';   }
   if (err instanceof ProviderAuthError)    { return 'provider_auth';    }
   if (err instanceof SessionCollapseError) { return 'session_collapse'; }
   return undefined;
}
