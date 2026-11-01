/**
 * Tool-call-aware driver interface.
 *
 * Self-contained and provider/protocol neutral. A driver reports each tool
 * call through `onToolCall` BEFORE running it and runs it only on an exact
 * 'approve'. Fail closed: no handler, or any other answer, is a deny.
 */

export type ToolCallKind =
   | 'read' | 'edit' | 'delete' | 'move' | 'search'
   | 'execute' | 'fetch' | 'think' | 'other';

export interface ToolCallReport {
   /** The agent's id for the call, when the driver has one. */
   id?:       string;
   kind:      ToolCallKind;
   title:     string;
   command?:  string;
   paths?:    string[];
   diff?:     string;
   rawInput?: unknown;
}

export type ToolCallDecision = 'approve' | 'deny';

export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * What the agent produced, reported as it happens. A `tool_call` update carries
 * only the fields the agent's message carried; the receiver merges them by `id`.
 */
export type TurnUpdate =
   | { type: 'text'; text: string }
   | {
      type: 'tool_call'; id: string; kind?: ToolCallKind; title?: string; status?: ToolCallStatus;
      command?: string; paths?: string[];
   };

/** Why a turn ended, other than being cancelled. */
export type TurnEnd = 'completed' | 'output_limit' | 'request_limit' | 'refused';

export interface ToolCallOutcome {
   report:   ToolCallReport;
   decision: ToolCallDecision;
}

export interface ExecuteOptions {
   context?:    string;
   sessionId?:  string;
   model?:      string;
   onToolCall?: (report: ToolCallReport) => Promise<ToolCallDecision>;
   /** Aborts the turn. Supplied per call, like `onToolCall`. */
   signal?:     AbortSignal;
   /**
    * Optional. Called once per update, in the order the agent produced them, only
    * while the turn runs. A throw is ignored. A driver that cannot stream may
    * ignore it: the turn's text then arrives in the result.
    */
   onUpdate?:   (update: TurnUpdate) => void;
}

export interface DriverResult {
   text:      string;
   sessionId: string;
   toolCalls: ToolCallOutcome[];
   /**
    * True when the turn ended because the signal aborted.
    * `sessionId` may be empty only if cancelled before a downstream session existed.
    */
   cancelled?: boolean;
   /** Why the turn ended. Absent reads as `completed`. */
   end?: TurnEnd;
}

export interface Driver {
   readonly name: string;
   readonly supportsToolCallGovernance: boolean;
   execute(command: string, options?: ExecuteOptions): Promise<DriverResult>;
   /**
    * Releases every process the driver started; a resolved no-op if it
    * started none. Takes no argument. Idempotent and safe to call
    * concurrently: every call resolves and the downstream agent is
    * released once.
    */
   close(): Promise<void>;
}

export function validateExecuteArgs(command: string, options: ExecuteOptions = {}): void {
   if (null === command || undefined === command || '' === command.trim())
   { throw new Error('command is required and must be a non-empty string'); }
   if (options.model !== undefined && '' === options.model)
   { throw new Error('options.model must be a non-empty string when provided'); }
}

/** True only for an explicit `supportsToolCallGovernance: true`. */
export function declaresToolCallGovernance(driver: unknown): boolean {
   return true === (driver as Partial<Driver> | null | undefined)?.supportsToolCallGovernance;
}

/**
 * Asks the per-call handler whether a tool call may run. A missing handler or
 * any answer other than exactly 'approve' is a deny. A handler that throws or
 * rejects propagates, so the call never runs.
 */
export async function gateToolCall(
   options: ExecuteOptions,
   report: ToolCallReport,
): Promise<ToolCallDecision> {
   if (undefined === options.onToolCall) { return 'deny'; }
   const decision = await options.onToolCall(report);
   return 'approve' === decision ? 'approve' : 'deny';
}
