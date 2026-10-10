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
   kind:      ToolCallKind;
   title:     string;
   command?:  string;
   paths?:    string[];
   diff?:     string;
   rawInput?: unknown;
}

export type ToolCallDecision = 'approve' | 'deny';

export interface ToolCallOutcome {
   report:   ToolCallReport;
   decision: ToolCallDecision;
}

export interface ExecuteOptions {
   context?:    string;
   sessionId?:  string;
   model?:      string;
   onToolCall?: (report: ToolCallReport) => Promise<ToolCallDecision>;
}

export interface DriverResult {
   text:      string;
   sessionId: string;
   toolCalls: ToolCallOutcome[];
}

export interface Driver {
   readonly name: string;
   readonly supportsToolCallGovernance: boolean;
   execute(command: string, options?: ExecuteOptions): Promise<DriverResult>;
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
