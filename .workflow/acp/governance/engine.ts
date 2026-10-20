/**
 * Governance Engine — evaluates every AI command against a declarative
 * YAML config before execution and produces an approve/deny/ask `Decision`.
 *
 * Config load failures fail closed: a missing file, malformed YAML, or an
 * invalid shape (bad pattern/action) throws a named, actionable error and
 * never defaults to approve-all. First-match-wins glob matching (via
 * `matchCommandGlob` — not a path-glob library; see command-glob.ts for
 * why) is evaluated against the full command string, not a substring.
 * Every decision and config load error is logged.
 *
 * Tool-call reports are matched on `kind`, `command` and `paths` only —
 * never the title, annotation hints or the raw request. `execute` commands
 * go through `evaluateCommand`, so segmentation and fail-closed parsing are
 * not reimplemented. First match wins; shadowed rules only log a warning.
 */
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { parse as parseShell } from 'shell-quote';
import { matchCommandGlob } from './command-glob.js';
import { hasParentSegment, lastSegment, matchesName, pathUnder } from './path-match.js';
import { findShadowedRules, ruleKinds } from './shadow.js';
import { Logger } from '../shared/logger.js';
import { AskDetails } from '../shared/types.js';
import { Decision, GovernanceAction, GovernanceConfig, GovernanceRule, PATH_KINDS, RESTRICTIVENESS } from './types.js';
import type { ToolCallKind, ToolCallReport } from '../drivers/governed-driver.js';
import {
   GovernanceConfigMissingError,
   GovernanceConfigParseError,
   GovernanceConfigInvalidError,
} from './errors.js';

const ACTIONS: readonly GovernanceAction[] = ['approve', 'deny', 'ask'];

/**
 * Every tool-call kind. The record form makes the compiler flag a kind added to or removed from the
 * driver vocabulary.
 */
const KIND_FLAGS: Record<ToolCallKind, true> = {
   read: true, edit: true, delete: true, move: true, search: true,
   execute: true, fetch: true, think: true, other: true,
};
const TOOL_CALL_KINDS = Object.keys(KIND_FLAGS) as ToolCallKind[];

/** Kinds that cannot act without paths; a report lacking them is a driver defect. */
const MUTATION_KINDS: readonly ToolCallKind[] = ['edit', 'delete', 'move'];

const RULE_KEYS = ['action', 'pattern', 'kind', 'path', 'files'];

/** Command-substitution markers `shell-quote` does not interpret; unsafe to segment. */
const COMMAND_SUBSTITUTION_RE = /\$\(|`/;

/**
 * Any whitespace other than a plain space (newline, carriage return, tab,
 * vertical tab, form feed, no-break space and the other Unicode spaces), and
 * `#` (shell comment). `shell-quote` either drops these or splits words on
 * them, where a shell keeps most of them inside a word, so the engine and the
 * shell would read different commands, and a hidden command after one of them
 * would ride along with the visible command's decision. Unsafe to segment.
 */
const UNPARSEABLE_CHARS_RE = /[^\S ]|#/;

/** The character after a `$` that starts a variable expansion: a name, `{`, a digit or a special parameter. */
const VARIABLE_START_RE = /[A-Za-z_{0-9@*#?!$-]/;

/** Shell operators that end a segment without starting a new evaluable command. */
const REDIRECT_OPS = new Set(['>', '>>', '<', '>&', '<&', '<<<']);

/** Operators that open a group; a command follows. */
const GROUP_OPEN_OPS = new Set(['(', '<(']);

/** Operators that need a command after them; at the end of the input the command is incomplete. */
const NEEDS_OPERAND_OPS = new Set(['&&', '||', '|', '|&']);

/**
 * Result of splitting a command into segments. `hadRedirect` is true when
 * any redirect operator (`>`, `>>`, `<`, etc.) was seen — a redirect is
 * itself a side effect (writes/overwrites a file, or reads one into a
 * command's stdin) whose target is dropped rather than evaluated, so its
 * mere presence must not let the rest of the command silently ride an
 * `approve` decision.
 */
export interface SplitResult {
   segments:    string[];
   hadRedirect: boolean;
}

/**
 * Splits `command` into independently-evaluable segments at shell
 * composition operators (`&&`, `||`, `;`, `|`, `&`) and redirection
 * operators (`>`, `>>`, `<`, etc. — the redirect target is dropped, not
 * evaluated as a command). Quoted operator characters are not treated as
 * operators (delegated to `shell-quote`). Returns `null` when the command
 * cannot be safely segmented: command substitution (`$(...)`, backticks),
 * newline/carriage-return/tab/comment characters, unbalanced quotes, or
 * a variable expansion outside single quotes (`shell-quote` replaces it with nothing, so the
 * words the shell puts there would go unseen), an operator with no command before it,
 * an incomplete trailing `&&`, `||`, `|`
 * or `|&` (shells reject all of these), or any `shell-quote` parse failure.
 * A trailing `;` or `&`, and operators after a closing `)`, are valid.
 * Callers must treat `null` as fail-closed
 * (`ask`), never fall back to whole-string matching.
 */
export function splitCommandSegments(command: string): SplitResult | null {
   if (COMMAND_SUBSTITUTION_RE.test(command)) { return null; }
   if (UNPARSEABLE_CHARS_RE.test(command)) { return null; }
   if (!hasBalancedQuotes(command)) { return null; }
   if (hasVariableExpansion(command)) { return null; }

   let entries: unknown[];
   try { entries = parseShell(command) as unknown[]; }
   catch { return null; }

   const segments: string[] = [];
   let current: string[] = [];
   let dropNextToken = false;
   let hadRedirect = false;
   /** True once a command word, or a closing `)`, came since the last operator. */
   let afterCommand = false;
   /** True while the last operator still needs a command after it. */
   let pendingOperand = false;

   for (const entry of entries) {
      if (dropNextToken) { dropNextToken = false; continue; }

      if ('object' === typeof entry && null !== entry && 'pattern' in (entry as Record<string, unknown>)) {
         current.push((entry as { pattern: string }).pattern);
         afterCommand = true; pendingOperand = false;
         continue;
      }

      if ('object' === typeof entry && null !== entry && 'op' in (entry as Record<string, unknown>)) {
         const op = (entry as { op: string }).op;
         if (REDIRECT_OPS.has(op)) {
            hadRedirect = true;
            flushSegment(current, segments);
            current = [];
            dropNextToken = true; // the redirect target is a file, not a command
            continue;
         }
         if (GROUP_OPEN_OPS.has(op) || ')' === op) {
            afterCommand   = ')' === op;
            pendingOperand = false;
         }
         else {
            // Composition operators (&&, ||, ;, |, &, etc.) need a command before them.
            if (!afterCommand) { return null; }
            afterCommand   = false;
            pendingOperand = NEEDS_OPERAND_OPS.has(op);
         }
         // They also end the segment.
         flushSegment(current, segments);
         current = [];
         continue;
      }

      if ('string' === typeof entry) { current.push(entry); afterCommand = true; pendingOperand = false; }
   }
   if (pendingOperand) { return null; }
   flushSegment(current, segments);

   return { segments, hadRedirect };
}

function flushSegment(tokens: string[], segments: string[]): void {
   if (0 < tokens.length) { segments.push(tokens.join(' ')); }
}

/** Counts unescaped, unquoted-context quote characters to detect unbalanced quoting. */
function hasBalancedQuotes(command: string): boolean {
   let inSingle = false;
   let inDouble = false;
   for (let i = 0; i < command.length; i += 1) {
      const c = command[i];
      if ('\\' === c && !inSingle) { i += 1; continue; } // skip escaped char outside single quotes
      if ('\'' === c && !inDouble) { inSingle = !inSingle; continue; }
      if ('"' === c && !inSingle) { inDouble = !inDouble; continue; }
   }
   return !inSingle && !inDouble;
}

/** True when a variable is expanded outside single quotes. Escaped `$` and `$` before a quote or space are literal. */
function hasVariableExpansion(command: string): boolean {
   let inSingle = false;
   let inDouble = false;
   for (let i = 0; i < command.length; i += 1) {
      const c = command[i];
      if ('\\' === c && !inSingle) { i += 1; continue; } // skip escaped char outside single quotes
      if ('\'' === c && !inDouble) { inSingle = !inSingle; continue; }
      if ('"' === c && !inSingle) { inDouble = !inDouble; continue; }
      if ('$' === c && !inSingle && VARIABLE_START_RE.test(command[i + 1] ?? '')) { return true; }
   }
   return false;
}

/** Reduces multiple segment decisions to the single most-restrictive action. */
function mostRestrictive(decisions: Decision[]): GovernanceAction {
   return decisions.reduce<GovernanceAction>(
      (worst, d) => RESTRICTIVENESS[d.action] > RESTRICTIVENESS[worst] ? d.action : worst,
      'approve',
   );
}

/** Max length of the redacted command logged with each governance decision. */
const REDACTED_COMMAND_MAX_LENGTH = 80;

/** Token characters that stop redaction: flags, paths, and pipes. */
const REDACTION_STOP_CHARS = /[-/\\|]/;

/**
 * Redacts a command for logging: keeps leading whitespace-separated tokens
 * up to (not including) the first token containing `-`, `/`, `\`, or `|`,
 * then truncates to a max length. This avoids persisting flags, paths, or
 * free-text argument values (which may carry secrets) while still logging
 * enough of the command shape to be useful for audit/troubleshooting.
 */
function redactCommand(command: string): string {
   const tokens = command.split(/\s+/).filter(Boolean);
   const kept: string[] = [];
   let truncated = false;
   for (const token of tokens) {
      if (REDACTION_STOP_CHARS.test(token)) { truncated = true; break; }
      kept.push(token);
   }
   let result = kept.join(' ');
   if (result.length > REDACTED_COMMAND_MAX_LENGTH) {
      result = result.slice(0, REDACTED_COMMAND_MAX_LENGTH);
      truncated = true;
   }
   return truncated ? `${result} […redacted]` : result;
}

function isAction(value: unknown): value is GovernanceAction {
   return 'string' === typeof value && (ACTIONS as readonly string[]).includes(value);
}

function invalidRule(filePath: string, index: number, problem: string): never {
   throw new GovernanceConfigInvalidError(filePath, `rule at index ${index} ${problem}`);
}

function isKind(value: unknown): value is ToolCallKind {
   return 'string' === typeof value && (TOOL_CALL_KINDS as string[]).includes(value);
}

/** `files` must be a non-empty list of non-empty names without a `/`. */
function isFileNameList(value: unknown): value is string[] {
   return Array.isArray(value) && 0 < value.length
      && value.every(entry => 'string' === typeof entry && '' !== entry && !entry.includes('/'));
}

/**
 * Validates one raw rule. Rejects anything no report could satisfy, so a
 * typo or a nonsense combination fails at startup instead of silently never
 * matching (or, worse, matching more than intended).
 */
function parseRule(filePath: string, rawRule: unknown, index: number): GovernanceRule {
   if (null === rawRule || 'object' !== typeof rawRule || Array.isArray(rawRule))
   { invalidRule(filePath, index, 'must be an object'); }

   const rule       = rawRule as Record<string, unknown>;
   const unknownKey = Object.keys(rule).find(key => !RULE_KEYS.includes(key));
   if (undefined !== unknownKey)
   { invalidRule(filePath, index, `has unknown key ${JSON.stringify(unknownKey)}`); }

   const { action, pattern, kind, path, files } = rule;
   if (!isAction(action))
   { invalidRule(filePath, index, `has invalid "action": ${JSON.stringify(action)}`); }
   if (undefined !== pattern && ('string' !== typeof pattern || '' === pattern))
   { invalidRule(filePath, index, 'has an empty or non-string "pattern"'); }
   if (undefined !== kind && !isKind(kind))
   { invalidRule(filePath, index, `has unknown "kind": ${JSON.stringify(kind)}`); }
   if (undefined !== path && ('string' !== typeof path || !path.startsWith('/')))
   { invalidRule(filePath, index, '"path" must be an absolute path'); }
   if (undefined !== files && !isFileNameList(files))
   { invalidRule(filePath, index, '"files" must be a non-empty list of names without "/"'); }

   if (undefined === pattern && undefined === kind && undefined === path && undefined === files)
   { invalidRule(filePath, index, 'has no constraint (needs "pattern", "kind", "path" or "files")'); }
   if (undefined !== pattern && undefined !== kind && 'execute' !== kind)
   { invalidRule(filePath, index, '"pattern" only applies to kind "execute"'); }
   if (undefined !== pattern && (undefined !== path || undefined !== files))
   { invalidRule(filePath, index, '"pattern" cannot be combined with "path" or "files"'); }
   if ((undefined !== path || undefined !== files) && undefined !== kind
      && !PATH_KINDS.includes(kind as ToolCallKind))
   { invalidRule(filePath, index, '"path" and "files" only apply to kinds with paths'); }

   const parsed: GovernanceRule = { action: action as GovernanceAction };
   if (undefined !== pattern) { parsed.pattern = pattern as string; }
   if (undefined !== kind)    { parsed.kind    = kind as ToolCallKind; }
   if (undefined !== path)    { parsed.path    = path as string; }
   if (undefined !== files)   { parsed.files   = files as string[]; }
   return parsed;
}

/** Validates the parsed YAML document shape; throws on any deviation. */
function validateConfigShape(filePath: string, doc: unknown): GovernanceConfig {
   if (null === doc || 'object' !== typeof doc || Array.isArray(doc))
   { throw new GovernanceConfigInvalidError(filePath, 'root document must be an object'); }

   const governance = (doc as Record<string, unknown>).governance;
   if (null === governance || 'object' !== typeof governance || Array.isArray(governance))
   { throw new GovernanceConfigInvalidError(filePath, 'missing required "governance" key'); }

   const { rules: rawRules, default: rawDefault } = governance as Record<string, unknown>;

   if (undefined !== rawRules && !Array.isArray(rawRules))
   { throw new GovernanceConfigInvalidError(filePath, '"governance.rules" must be an array'); }

   const rules: GovernanceRule[] = (rawRules ?? []).map(
      (rawRule: unknown, index: number) => parseRule(filePath, rawRule, index),
   );

   const defaultAction: GovernanceAction = undefined === rawDefault ? 'ask' : (rawDefault as GovernanceAction);
   if (!isAction(defaultAction))
   {
      throw new GovernanceConfigInvalidError(
         filePath,
         `"governance.default" has invalid value: ${JSON.stringify(rawDefault)}`,
      );
   }

   return { rules, default: defaultAction };
}

/** Reads and parses the governance YAML config. Fails closed on any error. */
export function loadGovernanceConfig(filePath: string): GovernanceConfig {
   let raw: string;
   try { raw = readFileSync(filePath, 'utf8'); }
   catch { throw new GovernanceConfigMissingError(filePath); }

   let doc: unknown;
   try { doc = parseYaml(raw); }
   catch (cause) { throw new GovernanceConfigParseError(filePath, cause); }

   return validateConfigShape(filePath, doc);
}

/**
 * Evaluates `command` against `config`. Compound commands (composed with
 * shell operators like `&&`, `||`, `;`, `|`, `&`, or redirects) are split
 * into segments; each segment is matched independently against `config`
 * using first-match-wins glob matching (via `matchCommandGlob`), and the overall
 * decision is the most restrictive across segments (`deny` > `ask` >
 * `approve`). Anything that cannot be safely segmented — command
 * substitution (`$(...)`, backticks), unbalanced quotes, or a parse
 * failure — fails closed to `ask` for the whole command; it is never
 * auto-approved or auto-denied. `ask` decisions (from a matched rule, the
 * config's `default`, or an unparseable/most-restrictive fallback) are
 * enriched with `AskDetails` carrying the full original command string.
 */
export function evaluateCommand(
   config: GovernanceConfig,
   command: string,
   extraDetails?: Omit<AskDetails, 'command'>,
): Decision {
   const split = splitCommandSegments(command);
   if (null === split || 0 === split.segments.length) {
      return buildDecision('ask', command, undefined, extraDetails);
   }
   const { segments, hadRedirect } = split;

   if (1 === segments.length && !hadRedirect && segments[0] === command.trim()) {
      return evaluateSegment(config, command, extraDetails);
   }

   const decisions   = segments.map(segment => evaluateSegment(config, segment));
   const segmentBest = mostRestrictive(decisions);
   // A redirect's target is dropped, not evaluated; its mere presence must
   // not let the remaining segments' decision silently approve.
   const action      = hadRedirect && RESTRICTIVENESS[segmentBest] < RESTRICTIVENESS.ask ? 'ask' : segmentBest;
   const matchedRule = 1 === decisions.length && !hadRedirect ? decisions[0].matchedRule : undefined;
   return buildDecision(action, command, matchedRule, extraDetails);
}

/** Suffix that makes a rule pattern also match the bare command with no
 * trailing arguments (see `matchesRule`). */
const TRAILING_ARGS_SUFFIX = ' *';

/**
 * Tests `segment` against a rule's glob `pattern`. A pattern ending in
 * `" *"` (e.g. `"ls *"`) also matches the bare command with no trailing
 * arguments (e.g. `"ls"`), so a single rule covers both forms without
 * requiring a separate bare-command entry in config.
 */
function matchesRule(segment: string, pattern: string): boolean {
   if (matchCommandGlob(segment, pattern)) { return true; }
   if (pattern.endsWith(TRAILING_ARGS_SUFFIX)) {
      const bareCommand = pattern.slice(0, -TRAILING_ARGS_SUFFIX.length);
      if (segment === bareCommand) { return true; }
   }
   return false;
}

function evaluateSegment(
   config: GovernanceConfig,
   segment: string,
   extraDetails?: Omit<AskDetails, 'command'>,
): Decision {
   for (const [index, rule] of config.rules.entries()) {
      if (appliesToCommand(rule, segment)) {
         return buildDecision(rule.action, segment, ruleLabel(rule, index), extraDetails);
      }
   }
   return buildDecision(config.default, segment, undefined, extraDetails);
}

function buildDecision(
   action: GovernanceAction,
   command: string,
   matchedRule: string | undefined,
   extraDetails?: Omit<AskDetails, 'command'>,
): Decision {
   const decision: Decision = { action };
   if (undefined !== matchedRule) { decision.matchedRule = matchedRule; }
   if ('ask' === action) { decision.details = { ...extraDetails, command }; }
   return decision;
}

/** Names a rule in logs: its pattern, or `#<position> kind=… path=… files=…`. */
function ruleLabel(rule: GovernanceRule, index: number): string {
   if (undefined !== rule.pattern) { return rule.pattern; }
   const parts = [`#${index + 1}`];
   if (undefined !== rule.kind)  { parts.push(`kind=${rule.kind}`); }
   if (undefined !== rule.path)  { parts.push(`path=${rule.path}`); }
   if (undefined !== rule.files) { parts.push(`files=${rule.files.join(',')}`); }
   return parts.join(' ');
}

/** True when a rule governs shell commands: execute-kind, no path or file constraint. */
function appliesToCommand(rule: GovernanceRule, segment: string): boolean {
   if (undefined !== rule.path || undefined !== rule.files) { return false; }
   if (undefined !== rule.kind && 'execute' !== rule.kind)  { return false; }
   return undefined === rule.pattern || matchesRule(segment, rule.pattern);
}

/** True when every constraint the rule names matches this kind and (optional) path. */
function appliesToSubject(rule: GovernanceRule, kind: ToolCallKind, path: string | undefined): boolean {
   if (undefined !== rule.pattern)      { return false; }
   if (!ruleKinds(rule).includes(kind)) { return false; }
   if (undefined !== rule.path && (undefined === path || !pathUnder(path, rule.path))) { return false; }
   if (undefined !== rule.files) {
      if (undefined === path) { return false; }
      const name = lastSegment(path);
      if (!rule.files.some(entry => matchesName(name, entry))) { return false; }
   }
   return true;
}

/** One path's first-match result, before the paths of a report are reduced. */
interface PathResult {
   action:       GovernanceAction;
   matchedRule?: string;
   guarded:      boolean;
}

/**
 * First-match result for one path (or none). A `..` segment is never
 * approved by a rule or by the default: an approve becomes an ask. A
 * matching deny still denies.
 */
function evaluateSubject(config: GovernanceConfig, kind: ToolCallKind, path: string | undefined): PathResult {
   let result: PathResult = { action: config.default, guarded: false };
   for (const [index, rule] of config.rules.entries()) {
      if (appliesToSubject(rule, kind, path)) {
         result = { action: rule.action, matchedRule: ruleLabel(rule, index), guarded: false };
         break;
      }
   }
   if ('approve' === result.action && undefined !== path && hasParentSegment(path)) {
      return { ...result, action: 'ask', guarded: true };
   }
   return result;
}

/** Non-blank paths of a report; blank entries are ignored. */
function usablePaths(report: ToolCallReport): string[] {
   return (report.paths ?? []).filter(path => '' !== path.trim());
}

/** Everything but the command that an `ask` must show the user. */
export function askDetails(report: ToolCallReport): Omit<AskDetails, 'command'> {
   const details: Omit<AskDetails, 'command'> = {};
   if (undefined !== report.paths)    { details.paths    = report.paths; }
   if (undefined !== report.diff)     { details.diff     = report.diff; }
   if (undefined !== report.rawInput) { details.rawInput = report.rawInput; }
   return details;
}

/** True when an ask would show the user something: a command, paths, a diff, raw input or a title. */
function hasDetails(report: ToolCallReport, paths: string[]): boolean {
   const rawInput = report.rawInput;
   const hasRaw   = undefined !== rawInput && null !== rawInput
      && ('object' !== typeof rawInput || 0 < Object.keys(rawInput).length);
   return '' !== (report.command ?? '').trim() || 0 < paths.length || '' !== (report.diff ?? '')
      || hasRaw || '' !== report.title.trim();
}

/**
 * Evaluates a driver's tool-call report. Matches on `kind`, `command` and
 * `paths` only. `execute` delegates to `evaluateCommand`. A report missing
 * what its kind needs (an `execute` without a command; an `edit`, `delete`
 * or `move` without usable paths) is a driver defect and is denied outright,
 * even under `default: approve`. Several paths are each matched by first
 * match; the most restrictive result wins (`deny` > `ask` > `approve`). A
 * report that would be asked about but has nothing to show the user (no
 * command, usable paths, diff or raw input, and a blank title) is denied:
 * an ask nobody can judge is not an ask.
 */
export function evaluateToolCall(config: GovernanceConfig, report: ToolCallReport): Decision {
   if ('execute' === report.kind) {
      if (undefined === report.command || '' === report.command.trim())
      { return { action: 'deny', reason: 'missing_command' }; }
      return evaluateCommand(config, report.command, askDetails(report));
   }

   const paths = usablePaths(report);
   if (MUTATION_KINDS.includes(report.kind) && 0 === paths.length)
   { return { action: 'deny', reason: 'missing_paths' }; }

   const subjects = PATH_KINDS.includes(report.kind) && 0 < paths.length ? paths : [undefined];
   const results  = subjects.map(path => evaluateSubject(config, report.kind, path));
   const worst    = results.reduce((best, next) =>
      RESTRICTIVENESS[next.action] > RESTRICTIVENESS[best.action] ? next : best);

   if ('ask' === worst.action && !hasDetails(report, paths)) {
      return { action: 'deny', reason: 'missing_details' };
   }

   const decision: Decision = { action: worst.action };
   if (undefined !== worst.matchedRule) { decision.matchedRule = worst.matchedRule; }
   if (worst.guarded)                   { decision.reason      = 'parent_segment'; }
   if ('ask' === worst.action) {
      decision.details = { ...askDetails(report) };
      if (undefined !== report.command) { decision.details.command = report.command; }
   }
   return decision;
}

/** Max length of each path logged with a tool-call decision. */
const LOGGED_PATH_MAX_LENGTH = 500;

/** A path as logged: cut at the logged-path limit. */
export function loggedPath(path: string): string {
   return path.length > LOGGED_PATH_MAX_LENGTH ? `${path.slice(0, LOGGED_PATH_MAX_LENGTH)}…` : path;
}

function toolCallLogFields(report: ToolCallReport, decision: Decision, context: ToolCallLogContext) {
   const fields: Record<string, unknown> = {
      sessionId: context.sessionId,
      callId:    context.callId,
      kind:      report.kind,
      action:    decision.action,
   };
   if ('execute' === report.kind && undefined !== report.command && '' !== report.command.trim())
   { fields.command = redactCommand(report.command); }

   const paths = usablePaths(report).map(path => loggedPath(path));
   if (PATH_KINDS.includes(report.kind) && 0 < paths.length) { fields.paths = paths; }

   const missingField = 'missing_command' === decision.reason || 'missing_paths' === decision.reason;
   if (undefined !== decision.matchedRule) { fields.matchedRule = decision.matchedRule; }
   else if (!missingField)                 { fields.matchedRule = 'default'; }
   if (undefined !== decision.reason)      { fields.reason = decision.reason; }
   return fields;
}

/** Correlates a tool-call decision with its later outcome entry. */
export interface ToolCallLogContext {
   sessionId: string;
   callId:    number;
}

export interface GovernanceEngine {
   evaluate(command: string, extraDetails?: Omit<AskDetails, 'command'>): Decision;
   /** Evaluates a tool-call report and logs one `governance_decision` entry. */
   evaluateToolCall(report: ToolCallReport, context: ToolCallLogContext): Decision;
}

export interface GovernanceEngineOptions {
   /** Pre-loaded config. Mutually exclusive with `configPath`. */
   config?:     GovernanceConfig;
   /** Path to the governance YAML config. Mutually exclusive with `config`. */
   configPath?: string;
   logger:      Logger;
}

/**
 * Builds a governance engine bound to a `Logger`. Every evaluated command
 * is logged (`governance_decision`); a config load failure is logged
 * (`governance_config_error`) and rethrown — construction fails closed.
 */
export function createGovernanceEngine(options: GovernanceEngineOptions): GovernanceEngine {
   const { config: providedConfig, configPath, logger } = options;

   let config: GovernanceConfig;
   if (undefined !== providedConfig) { config = providedConfig; }
   else if (undefined !== configPath) {
      try { config = loadGovernanceConfig(configPath); }
      catch (err) {
         logger.error('governance_config_error', {
            filePath: configPath,
            problem:  err instanceof Error ? err.message : String(err),
         });
         throw err;
      }
   }
   else { throw new Error('createGovernanceEngine requires either "config" or "configPath"'); }

   for (const { rule, shadowedBy } of findShadowedRules(config.rules)) {
      const later   = config.rules[rule];
      const earlier = config.rules[shadowedBy];
      logger.warn('governance_rule_shadowed', {
         rule:                 ruleLabel(later, rule),
         shadowedBy:           ruleLabel(earlier, shadowedBy),
         ruleAction:           later.action,
         shadowedByAction:     earlier.action,
         approveHidesStricter: 'approve' === earlier.action
            && RESTRICTIVENESS[later.action] > RESTRICTIVENESS[earlier.action],
      });
   }

   return {
      evaluate(command, extraDetails) {
         const decision = evaluateCommand(config, command, extraDetails);
         logger.info('governance_decision', {
            command:     redactCommand(command),
            matchedRule: decision.matchedRule ?? 'default',
            action:      decision.action,
         });
         return decision;
      },

      evaluateToolCall(report, context) {
         const decision = evaluateToolCall(config, report);
         logger.info('governance_decision', toolCallLogFields(report, decision, context));
         return decision;
      },
   };
}
