/**
 * Session store for the ACP Service Boundary.
 *
 * Maps each ACP session to exactly one workflowId, tracks the driver's
 * continuity sessionId, and holds the per-session active-turn flag used for
 * reject-with-retry concurrency. Distinct sessions get distinct workflows;
 * closing (single or all) releases mappings so disconnect / stdin EOF leaks
 * nothing.
 */

export interface SessionRecord {
   sessionId:        string;
   workflowId:       string;
   driverSessionId?: string;
   activeTurn:       boolean;
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
   setActiveTurn(sessionId: string, active: boolean): void;
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
         const record: SessionRecord = { sessionId, workflowId, activeTurn: false };
         sessions.set(sessionId, record);
         return record;
      },

      get(sessionId) {
         return sessions.get(sessionId);
      },

      close(sessionId) {
         sessions.delete(sessionId);
      },

      closeAll() {
         sessions.clear();
      },

      hasActiveTurn(sessionId) {
         return sessions.get(sessionId)?.activeTurn ?? false;
      },

      setActiveTurn(sessionId, active) {
         const record = sessions.get(sessionId);
         if (record) { record.activeTurn = active; }
      },
   };
}
