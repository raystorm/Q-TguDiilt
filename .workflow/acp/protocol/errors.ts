/**
 * Error taxonomy owned by the ACP Service Boundary.
 *
 * Transport, malformed-message, unknown-method, and protocol-version errors
 * are handled by the ACP SDK. These classes cover the boundary's own,
 * domain-specific outcomes that the translation seam must surface distinctly.
 */

/**
 * A second prompt turn arrived while one is already in flight on the same
 * session. This is session-lifecycle backpressure, NOT a transport or
 * malformed-input error. The in-flight turn is unaffected; the client may
 * retry after it completes.
 */
export class TurnInProgressError extends Error {
   readonly kind      = 'turn_in_progress';
   readonly retryable = true;

   constructor(sessionId: string) {
      super(`a turn is already in progress for session ${sessionId}`);
      this.name = 'TurnInProgressError';
   }
}

/** Provider quota / rate-limit reached. Actionable and resumable. */
export class ProviderQuotaError extends Error {
   readonly kind = 'provider_quota';

   constructor(message: string) {
      super(message);
      this.name = 'ProviderQuotaError';
   }
}

/** Provider authentication required (e.g. re-login). Actionable and resumable. */
export class ProviderAuthError extends Error {
   readonly kind = 'provider_auth';

   constructor(message: string) {
      super(message);
      this.name = 'ProviderAuthError';
   }
}

/**
 * Session continuity collapsed: the provider session expired AND/OR the
 * context window overflowed. Detected and surfaced; recovery is out of scope
 * (A4a never silently starts a fresh context).
 */
export class SessionCollapseError extends Error {
   readonly kind = 'session_collapse';

   constructor(message: string) {
      super(message);
      this.name = 'SessionCollapseError';
   }
}

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
