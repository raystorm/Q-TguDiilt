/**
 * Permission mapping for the ACP-client core: what the agent's stream says
 * about a tool call, the report governance evaluates when the agent asks
 * permission, and the option that answers the request. Nothing here depends
 * on which agent is behind the connection.
 */
import type {
   PermissionOption,
   RequestPermissionResponse,
   ToolCallContent,
   ToolCallLocation,
   ToolCallUpdate,
} from '@agentclientprotocol/sdk';
import type { ToolCallDecision, ToolCallKind, ToolCallReport } from '../governed-driver.js';

/** The kinds a report may carry. Any other kind the agent names is `other`. */
const KINDS: ReadonlySet<string> = new Set<ToolCallKind>([
   'read', 'edit', 'delete', 'move', 'search', 'execute', 'fetch', 'think', 'other',
]);

/** Kinds that run without a request and are not worth a log entry. */
const UNGATED: ReadonlySet<ToolCallKind> = new Set<ToolCallKind>(['read', 'search', 'think']);

/** What the stream has said about one tool call so far. */
interface CallRecord {
   kind?:      string;
   title?:     string;
   content?:   readonly ToolCallContent[];
   locations?: readonly ToolCallLocation[];
   rawInput?:  unknown;
   /** True once the stream has shown the call in progress or completed. */
   ran:        boolean;
}

/** A tool call that ran without a permission request. */
export interface UnrequestedCall {
   toolCallId: string;
   kind:       ToolCallKind;
   paths:      string[];
}

/**
 * The tool calls of one turn, as the agent's stream describes them. A
 * permission request is matched to its call by exact id only, and a record
 * is used once. The table holds nothing across turns: `clear` empties it.
 */
export interface ToolCallTable {
   /**
    * Notes a `tool_call` (`announced`) or a `tool_call_update` from the
    * stream. Returns the call, once, when it has run without a request.
    */
   note(update: ToolCallUpdate, announced: boolean): UnrequestedCall | undefined;
   /** Builds the report for a permission request and marks its call as asked. */
   report(request: ToolCallUpdate): ToolCallReport;
   clear(): void;
   /** Entries held, of every kind. */
   readonly size: number;
}

const present = <T>(value: T | null | undefined): value is T => undefined !== value && null !== value;

/** The record after `update`: a field the update names replaces the earlier one. */
function merge(previous: CallRecord | undefined, update: ToolCallUpdate): CallRecord {
   const next: CallRecord = { ...previous, ran: previous?.ran ?? false };
   if (present(update.kind))      { next.kind      = update.kind; }
   if (present(update.title))     { next.title     = update.title; }
   if (present(update.content))   { next.content   = update.content; }
   if (present(update.locations)) { next.locations = update.locations; }
   if (undefined !== update.rawInput) { next.rawInput = update.rawInput; }
   if ('in_progress' === update.status || 'completed' === update.status) { next.ran = true; }
   return next;
}

function kindOf(kind: string | undefined): ToolCallKind {
   return undefined !== kind && KINDS.has(kind) ? kind as ToolCallKind : 'other';
}

/**
 * The command, exactly as received. `commands`, when present, must be exactly
 * `[command]`; any other shape leaves the command missing, so governance denies.
 */
function commandOf(rawInput: unknown): string | undefined {
   if (null === rawInput || 'object' !== typeof rawInput) { return undefined; }
   const { command, commands } = rawInput as { command?: unknown; commands?: unknown };
   if ('string' !== typeof command || '' === command.trim()) { return undefined; }
   if (undefined === commands) { return command; }
   return Array.isArray(commands) && 1 === commands.length && command === commands[0] ? command : undefined;
}

/** Paths from the locations, then from the diff blocks; each once, as given. */
function pathsOf(record: CallRecord): string[] {
   const found = [
      ...(record.locations ?? []).map(location => location.path),
      ...(record.content ?? []).flatMap(block => 'diff' === block.type ? [block.path] : []),
   ];
   return [...new Set(found)].filter(path => '' !== path.trim());
}

function diffOf(record: CallRecord): string | undefined {
   const blocks = (record.content ?? []).flatMap(block => 'diff' === block.type ? [block] : []);
   if (0 === blocks.length) { return undefined; }
   return blocks
      .map(block => `--- ${block.path}\n${block.oldText ?? ''}\n+++ ${block.path}\n${block.newText}`)
      .join('\n');
}

/** The report for a record. The title is never used as the command. */
function buildReport(record: CallRecord): ToolCallReport {
   const report: ToolCallReport = { kind: kindOf(record.kind), title: record.title ?? '' };
   const command = commandOf(record.rawInput);
   const paths   = pathsOf(record);
   const diff    = diffOf(record);
   if (undefined !== command)         { report.command  = command; }
   if (0 < paths.length)              { report.paths    = paths; }
   if (undefined !== diff)            { report.diff     = diff; }
   if (undefined !== record.rawInput) { report.rawInput = record.rawInput; }
   return report;
}

export function createToolCallTable(): ToolCallTable {
   const calls    = new Map<string, CallRecord>();
   const asked    = new Set<string>();
   const reported = new Set<string>();

   return {
      note(update, announced) {
         const id = update.toolCallId;
         // A new announcement starts the call afresh; updates for a call that was asked are ignored.
         if (announced) { asked.delete(id); }
         else if (asked.has(id)) { return undefined; }
         const record = merge(announced ? undefined : calls.get(id), update);
         calls.set(id, record);
         const kind = kindOf(record.kind);
         if (!record.ran || reported.has(id) || UNGATED.has(kind)) { return undefined; }
         reported.add(id);
         return { toolCallId: id, kind, paths: pathsOf(record) };
      },

      report(request) {
         const id     = request.toolCallId;
         const record = merge(calls.get(id), request);
         calls.delete(id);
         asked.add(id);
         return buildReport(record);
      },

      clear() {
         calls.clear();
         asked.clear();
         reported.clear();
      },

      get size() { return calls.size + asked.size + reported.size; },
   };
}

/** The answer that selects nothing: the request is cancelled. */
export function cancelledAnswer(): RequestPermissionResponse {
   return { outcome: { outcome: 'cancelled' } };
}

const selected = (option: PermissionOption): RequestPermissionResponse =>
   ({ outcome: { outcome: 'selected', optionId: option.optionId } });

/**
 * Answers a permission request with one of its own options, chosen by kind
 * only: `allow_once` for an approve, `reject_once` for a deny. An approve with
 * no `allow_once` offered falls back to `reject_once`; with neither, or a deny
 * with no `reject_once`, the request is cancelled. `onMissing` hears which
 * decision could not be honoured. An `allow_always` or `reject_always` option
 * is never selected.
 */
export function answerFor(
   options:   readonly PermissionOption[],
   decision:  ToolCallDecision,
   onMissing: (wanted: ToolCallDecision) => void,
): RequestPermissionResponse {
   const allow  = options.find(option => 'allow_once' === option.kind);
   const reject = options.find(option => 'reject_once' === option.kind);
   if ('approve' === decision) {
      if (undefined !== allow) { return selected(allow); }
      onMissing(decision);
      return undefined !== reject ? selected(reject) : cancelledAnswer();
   }
   if (undefined !== reject) { return selected(reject); }
   onMissing(decision);
   return cancelledAnswer();
}
