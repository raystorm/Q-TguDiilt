/**
 * Session store for the ACP Service Boundary.
 *
 * Maps each ACP session to exactly one workflowId, tracks the driver's
 * continuity sessionId, and holds the per-session active-turn flag used for
 * reject-with-retry concurrency. Distinct sessions get distinct workflows;
 * closing (single or all) releases mappings so disconnect / stdin EOF leaks
 * nothing.
 */

/** The main thread's session while a side trip runs: what the record's own fields held before it. */
export interface ParkedSession {
   driver:           string;
   model?:           string;
   driverSessionId?: string;
   profile?:         string;
}

export interface SessionRecord {
   sessionId:        string;
   workflowId:       string;
   /** The driver and model this session was resolved to. Set when the session opens. */
   driver?:          string;
   model?:           string;
   driverSessionId?: string;
   activeTurn:       boolean;
   /** The canonical name of the profile the last applied activation found. */
   profile?:         string;
   /** One chat line the next turn leads with. Cleared when a turn ends normally. */
   notice?:          string;
   /**
    * Set while a side trip is open: the main thread's session, waiting for the trip to end. The
    * record's own fields are always the session that is running.
    */
   parked?:          ParkedSession;
   abort?:           AbortController;
}

export interface SessionStoreDeps {
   /** Generates a fresh workflowId for each new session. */
   newWorkflowId(): string;
}

export interface SessionStore {
   create(sessionId: string): SessionRecord;
   load(sessionId: string, workflowId: string): SessionRecord;
   get(sessionId: string): SessionRecord | undefined;
   close(sessionId: string): void;
   closeAll(): void;
   hasActiveTurn(sessionId: string): boolean;
   setActiveTurn(sessionId: string, active: boolean, controller?: AbortController): void;
   /** Aborts the active turn once; true only if a turn was actually aborted. */
   abortTurn(sessionId: string): boolean;
   abortAllTurns(): void;
}

export function createSessionStore(deps: SessionStoreDeps): SessionStore {
   const sessions = new Map<string, SessionRecord>();

   return {
      create(sessionId) {
         const record: SessionRecord = {
            sessionId,
            workflowId: deps.newWorkflowId(),
            activeTurn: false,
         };
         sessions.set(sessionId, record);
         return record;
      },

      load(sessionId, workflowId) {
         const record: SessionRecord = {
            sessionId, workflowId, activeTurn: false,
         };
         sessions.set(sessionId, record);
         return record;
      },

      get(sessionId) {
         return sessions.get(sessionId);
      },

      close(sessionId) {
         const record = sessions.get(sessionId);
         if (record) { record.abort = undefined; }
         sessions.delete(sessionId);
      },

      closeAll() {
         for (const record of sessions.values()) { record.abort = undefined; }
         sessions.clear();
      },

      hasActiveTurn(sessionId) {
         return sessions.get(sessionId)?.activeTurn ?? false;
      },

      setActiveTurn(sessionId, active, controller) {
         const record = sessions.get(sessionId);
         if (record) {
            record.activeTurn = active;
            record.abort      = active ? controller : undefined;
         }
      },

      abortTurn(sessionId) {
         const abort = sessions.get(sessionId)?.abort;
         if (undefined === abort || abort.signal.aborted) { return false; }
         abort.abort();
         return true;
      },

      abortAllTurns() {
         for (const record of sessions.values()) { record.abort?.abort(); }
      },
   };
}
