/**
 * Reading the completion block of a turn's text: the next step a profile suggests.
 *
 * The block is the last line that begins with `**Next**` and every line after it, without
 * fenced code. Only single-backtick code spans on those lines are read. A span that starts
 * with `@handoff` or `/handoff` suggests a handoff; one with `@send` or `/send` suggests a
 * side trip. Agent text is untrusted: every step is linear in the size of the text, and
 * nothing here throws.
 */
import type { ProfileNames } from './workflow-command.js';

const MARKER = '**Next**';
const FENCE  = '```';
const MARKS  = ',.:;';

export type BlockStopReason =
   'no_suggestion' | 'several_suggestions' | 'no_target' | 'unknown_profile';

export type CompletionBlock =
   | { kind: 'continue'; target: string }
   | { kind: 'send'; target: string }
   | { kind: 'stop'; reason: BlockStopReason; word?: string };

/** One distinct suggestion: a known target, an unknown word, or neither (a bare span). */
interface Suggestion { target?: string; word?: string }

/** The lines from the last marker line to the end; none when no line begins with the marker. */
function blockLines(text: string): string[]
{
   const lines = text.split(/\r?\n/);
   let at = lines.length - 1;
   while (0 <= at && !lines[at].startsWith(MARKER)) { at--; }
   return 0 > at ? [] : lines.slice(at);
}

/** The text between each backtick and the next one on the line, trimmed. */
function spansOf(line: string): string[]
{
   const spans: string[] = [];
   let from = line.indexOf('`');
   while (-1 !== from) {
      const to = line.indexOf('`', from + 1);
      if (-1 === to) { break; }
      spans.push(line.slice(from + 1, to).trim());
      from = line.indexOf('`', to + 1);
   }
   return spans;
}

/**
 * What follows the command in `span`, trimmed, or undefined when the span does not start with
 * `@` or `/` and then `command` (ignoring case) as a whole word.
 */
function argumentOf(span: string, command: string): string | undefined
{
   const prefixed = '@' === span[0] || '/' === span[0];
   if (!prefixed || command !== span.slice(1, command.length + 1).toLowerCase()) { return undefined; }
   const rest = span.slice(command.length + 1);
   return '' === rest || /^\s/.test(rest) ? rest.trim() : undefined;
}

/**
 * The profile name in a handoff argument: what follows `to=` (any case), or the whole argument
 * when it has no `to=`. One trailing `,` `.` `:` or `;` is removed. Empty when none is given.
 */
function nameIn(argument: string): string
{
   const named = 'to=' === argument.slice(0, 3).toLowerCase() ? argument.slice(3).trim() : argument;
   return '' !== named && MARKS.includes(named.slice(-1)) ? named.slice(0, -1) : named;
}

const stop = (reason: BlockStopReason, word?: string): CompletionBlock =>
   undefined === word ? { kind: 'stop', reason } : { kind: 'stop', reason, word };

/**
 * Adds the suggestion that `argument` makes to `found`. Keyed so that spellings of one profile are
 * one suggestion: `b` for bare, `k` plus the canonical name for a known one, `u` plus the
 * lower-case name for an unknown one.
 */
function note(found: Map<string, Suggestion>, argument: string, names: ProfileNames): void
{
   const name = nameIn(argument);
   if ('' === name) { if (!found.has('b')) { found.set('b', {}); } return; }
   const target = names.resolve(name);
   const key    = undefined === target ? `u${name.toLowerCase()}` : `k${target}`;
   if (!found.has(key)) { found.set(key, undefined === target ? { word: name } : { target }); }
}

/**
 * The step the completion block of `text` suggests. One distinct known handoff target continues,
 * and one distinct known send target is a send. The rest stops, for the first reason that applies:
 * no handoff and no send span (`no_suggestion`), a handoff span and a send span together, or two
 * or more distinct suggestions of one command (`several_suggestions`), one bare span
 * (`no_target`), one unknown name (`unknown_profile`, with the name as looked up). Names match
 * profile names and aliases exactly, ignoring case.
 */
export function parseCompletionBlock(text: string, names: ProfileNames): CompletionBlock
{
   const handoffs = new Map<string, Suggestion>();
   const sends    = new Map<string, Suggestion>();
   let fenced     = false;

   for (const line of blockLines(text)) {
      if (line.trim().startsWith(FENCE)) { fenced = !fenced; continue; }
      if (fenced) { continue; }
      for (const span of spansOf(line)) {
         const handoff = argumentOf(span, 'handoff');
         if (undefined !== handoff) { note(handoffs, handoff, names); continue; }
         const send = argumentOf(span, 'send');
         if (undefined !== send) { note(sends, send, names); }
      }
   }

   if (0 === handoffs.size && 0 === sends.size) { return stop('no_suggestion'); }
   if (0 < handoffs.size && 0 < sends.size) { return stop('several_suggestions'); }
   const found = 0 < handoffs.size ? handoffs : sends;
   if (1 < found.size) { return stop('several_suggestions'); }
   const [only] = found.values();
   if (undefined !== only.target) {
      return 0 < handoffs.size ? { kind: 'continue', target: only.target } : { kind: 'send', target: only.target };
   }
   return undefined === only.word ? stop('no_target') : stop('unknown_profile', only.word);
}
