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
 */
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { parse as parseShell } from 'shell-quote';
import { matchCommandGlob } from './command-glob.js';
import { Logger } from '../shared/logger.js';
import { AskDetails } from '../shared/types.js';
import { Decision, GovernanceAction, GovernanceConfig, GovernanceRule } from './types.js';
import {
   GovernanceConfigMissingError,
   GovernanceConfigParseError,
   GovernanceConfigInvalidError,
} from './errors.js';

const ACTIONS: readonly GovernanceAction[] = ['approve', 'deny', 'ask'];

/** Most-restrictive-wins ranking for reducing multiple segment decisions. */
const RESTRICTIVENESS: Record<GovernanceAction, number> = { deny: 2, ask: 1, approve: 0 };

/** Command-substitution markers `shell-quote` does not interpret; unsafe to segment. */
const COMMAND_SUBSTITUTION_RE = /\$\(|`/;

/**
 * Newline, carriage return, tab, and `#` (shell comment) — `shell-quote`
 * silently drops these instead of treating them as separators, so a hidden
 * command after one of these characters would otherwise ride along with
 * the visible command's decision. Unsafe to segment.
 */
const UNPARSEABLE_CHARS_RE = /[\n\r\t#]/;

/** Shell operators that end a segment without starting a new evaluable command. */
const REDIRECT_OPS = new Set(['>', '>>', '<', '>&', '<&', '<<<']);

/**
 * Result of splitting a command into segments. `hadRedirect` is true when
 * any redirect operator (`>`, `>>`, `<`, etc.) was seen — a redirect is
 * itself a side effect (writes/overwrites a file, or reads one into a
 * command's stdin) whose target is dropped rather than evaluated, so its
 * mere presence must not let the rest of the command silently ride an
 * `approve` decision.
 */
interface SplitResult {
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
 * any `shell-quote` parse failure. Callers must treat `null` as fail-closed
 * (`ask`), never fall back to whole-string matching.
 */
function splitCommandSegments(command: string): SplitResult | null {
   if (COMMAND_SUBSTITUTION_RE.test(command)) { return null; }
   if (UNPARSEABLE_CHARS_RE.test(command)) { return null; }
   if (!hasBalancedQuotes(command)) { return null; }

   let entries: unknown[];
   try { entries = parseShell(command) as unknown[]; }
   catch { return null; }

   const segments: string[] = [];
   let current: string[] = [];
   let dropNextToken = false;
   let hadRedirect = false;

   for (const entry of entries) {
      if (dropNextToken) { dropNextToken = false; continue; }

      if ('object' === typeof entry && null !== entry && 'op' in (entry as Record<string, unknown>)) {
         const op = (entry as { op: string }).op;
         if (REDIRECT_OPS.has(op)) {
            hadRedirect = true;
            flushSegment(current, segments);
            current = [];
            dropNextToken = true; // the redirect target is a file, not a command
            continue;
         }
         // Composition operators (&&, ||, ;, |, &, etc.) end the segment.
         flushSegment(current, segments);
         current = [];
         continue;
      }

      if ('object' === typeof entry && null !== entry && 'pattern' in (entry as Record<string, unknown>)) {
         current.push((entry as { pattern: string }).pattern);
         continue;
      }

      if ('string' === typeof entry) { current.push(entry); }
   }
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

   const rules: GovernanceRule[] = (rawRules ?? []).map((rawRule: unknown, index: number) => {
      if (null === rawRule || 'object' !== typeof rawRule)
      { throw new GovernanceConfigInvalidError(filePath, `rule at index ${index} must be an object`); }

      const { pattern, action } = rawRule as Record<string, unknown>;
      if ('string' !== typeof pattern || '' === pattern)
      { throw new GovernanceConfigInvalidError(filePath, `rule at index ${index} is missing "pattern"`); }
      if (!isAction(action))
      {
         throw new GovernanceConfigInvalidError(
            filePath,
            `rule at index ${index} has invalid "action": ${JSON.stringify(action)}`,
         );
      }
      return { pattern, action };
   });

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
   for (const rule of config.rules) {
      if (matchesRule(segment, rule.pattern)) {
         return buildDecision(rule.action, segment, rule.pattern, extraDetails);
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

export interface GovernanceEngine {
   evaluate(command: string, extraDetails?: Omit<AskDetails, 'command'>): Decision;
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
   };
}
