import { dump, load as parseYaml } from 'js-yaml';

/**
 * Pure transform from a canonical prompt (or authored skill) to its Kiro and
 * Copilot forms. Nothing is read from or written to disk: the caller passes a
 * label for the file (used in error messages), its text, and its source.
 *
 * A canonical file declares the input it takes in its frontmatter `arguments`
 * and writes `{{slot}}` in the body. `input` is the free-text slot and is never
 * mixed with positional slots. A name is at most 64 characters: it starts with
 * a letter, a number or `_` (an internal skill), then letters, numbers,
 * hyphens and underscores only. No spaces, dots or colons. A skill's name is
 * also lower-case. Letters are ASCII: A to Z and a to z.
 */

/** Where a canonical file comes from: a saved prompt, or a skill written by hand. */
export type Source = 'prompt' | 'skill';

/**
 * What a file is:
 * - prompt  frontmatter with a name; a command the user can run
 * - helper  frontmatter with a name and `user-invocable: false`; other prompts read it by path
 * - none    anything else: no frontmatter, or none that is closed, or no name
 */
export type Kind = 'prompt' | 'helper' | 'none';

/**
 * Why the transform refuses a file:
 * - input_mixed        `input` is declared together with another slot
 * - slot_repeated      a slot name is declared twice
 * - slot_unused        a declared slot is not in the body
 * - name_invalid       the name breaks the name rule
 * - arguments_invalid  `arguments` is not a list of valid slot names
 */
export type Reason = 'input_mixed' | 'slot_repeated' | 'slot_unused' | 'name_invalid' | 'arguments_invalid';

/** A refusal to render: the reason, the caller's label for the file, and the slot or name at fault. */
export class TransformError extends Error {
   readonly reason: Reason;
   readonly file:   string;
   readonly detail: string;

   constructor(reason: Reason, file: string, detail: string) {
      super(`${file}: ${reason}${'' === detail ? '' : ` (${detail})`}`);
      this.name   = 'TransformError';
      this.reason = reason;
      this.file   = file;
      this.detail = detail;
   }
}

/**
 * The name rule, for the whole string: 1 to 64 characters. The first is a letter, a number or `_`
 * (`_` marks an internal skill); up to 63 more follow, each a letter, number, underscore or hyphen.
 * Letters are A to Z and a to z only, so `café` and any space, dot or colon fail.
 */
const NAME  = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;

/**
 * The extra rule for a skill's name, for the whole string:
 * lower-case letters, numbers, underscores and hyphens, no capital.
 * A skill's name must match NAME as well.
 */
const SKILL = /^[a-z0-9_-]+$/;

/**
 * A slot name, for the whole string: a letter first, then any number of letters, numbers,
 * underscores and hyphens. No spaces, so `{{name}}` stays one token.
 */
const SLOT  = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * A token, `{{name}}`: a slot-shaped name between double braces and nothing else inside,
 * so `{{ to }}` and `{{profileName or "None"}}` do not match.
 * Global, to find every token in a body.
 */
const TOKEN = /\{\{([A-Za-z][A-Za-z0-9_-]*)\}\}/g;

/** The frontmatter keys a Copilot skill keeps, in this order, when the source has them. */
const COPILOT_KEYS = ['name', 'description', 'version', 'argument-hint'];

interface Parts
{
   data: Record<string, unknown>;
   head: string;
   body: string;
}

function isRecord(value: unknown): value is Record<string, unknown>
{ return 'object' === typeof value && null !== value && !Array.isArray(value); }

function isSlotList(value: unknown): value is string[]
{
   return( Array.isArray(value)
           && value.every((slot) => 'string' === typeof slot && SLOT.test(slot)) );
}

/**
 * Splits a text at its frontmatter. The first line must be `---`; the first
 * later line that is exactly `---` closes it, and any further `---` line
 * belongs to the body. `head` is the frontmatter block as written, closing
 * line and its line break included; `head` followed by `body` is the text.
 * Returns null when there is no closed frontmatter.
 */
function split(text: string): Parts | null
{
   const lines   = text.split('\n');
   const isFence = (line: string) => '---' === line.replace(/\r$/, '');
   if (!isFence(lines[0])) { return null; }

   const close = lines.findIndex((line, index) => 0 < index && isFence(line));
   if (-1 === close) { return null; }

   const data    = parseYaml(lines.slice(1, close).join('\n'));
   const headEnd = lines.slice(0, close + 1).join('\n').length + 1;
   return {
      data: isRecord(data) ? data : {},
      head: text.slice(0, headEnd),
      body: text.slice(headEnd)
   };
}

function hasName(data: Record<string, unknown>): boolean
{ return 'string' === typeof data.name && '' !== data.name.trim(); }

/**
 * A prompt has frontmatter with a name;
 * `user-invocable: false` makes it a helper;
 * anything else is none.
 */
export function classify(_file: string, text: string): { kind: Kind }
{
   const parts = split(text);
   if (null === parts || !hasName(parts.data)) { return { kind: 'none' }; }
   return { kind: false === parts.data['user-invocable'] ? 'helper' : 'prompt' };
}

function validName(name: string, source: Source): boolean
{ return NAME.test(name) && ('prompt' === source || SKILL.test(name)); }

/**
 * Reads a canonical file and checks its name and slots;
 * stops with a TransformError on the first fault.
 */
function prepare(file: string, text: string, source: Source):
         { name: string; slots: string[]; parts: Parts }
{
   const parts = split(text);
   const name  = parts?.data.name;
   if (null === parts || 'string' !== typeof name || !validName(name, source))
   { throw new TransformError('name_invalid', file, 'string' === typeof name ? name : ''); }

   const declared = parts.data.arguments ?? [];
   if ( !isSlotList(declared) )
   { throw new TransformError('arguments_invalid', file, JSON.stringify(declared)); }
   if (declared.includes('input') && declared.some((slot) => 'input' !== slot))
   { throw new TransformError('input_mixed', file, 'input'); }

   const repeated = declared.find((slot, index) => index !== declared.indexOf(slot));
   if (undefined !== repeated) { throw new TransformError('slot_repeated', file, repeated); }

   const unused = declared.find((slot) => !parts.body.includes(`{{${slot}}}`));
   if (undefined !== unused) { throw new TransformError('slot_unused', file, unused); }

   return { name, slots: declared, parts };
}

/**
 * Replaces the token of each declared slot with what `write` gives for it (the slot and its 1-based
 * position); any other `{{...}}` is left as written. The replacement is a function, so `$` in its
 * result is text and never a replacement pattern.
 */
function fill(body: string, slots: string[], write: (slot: string, position: number) => string): string
{
   return body.replace(TOKEN, (token, slot: string) =>
   {
      const index = slots.indexOf(slot);
      return -1 === index ? token : write(slot, index + 1);
   });
}

const present = (value: unknown) => undefined !== value && null !== value;

/**
 * A word break in a name, an empty match between two characters: after a lower-case letter or a
 * number when a capital follows (`debug|Profile`, `v2|Beta`), or after a capital when a capital and a
 * lower-case letter follow, which ends a run of capitals (`HTTP|Server`). A `_` or a hyphen never
 * precedes a match, so no hyphen is added at the start, after `_` or beside an existing hyphen.
 */
const WORD_BREAK = /(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g;

/** The folder of a prompt: lower case, a hyphen at each word break (`HTTPServer` gives `http-server`). */
const kebab = (name: string) => name.replace(WORD_BREAK, '-').toLowerCase();

/**
 * The Kiro text: `{{slot}}` becomes `${n}` (n is the slot's position in `arguments`) and `{{input}}`
 * becomes `$ARGUMENTS`. The frontmatter block is kept exactly as written.
 */
export function renderKiro(file: string, text: string, source: Source): { text: string }
{
   const { slots, parts } = prepare(file, text, source);
   const write = (slot: string, position: number) =>
         ('input' === slot ? '$ARGUMENTS' : '${' + position + '}');
   return { text: parts.head + fill(parts.body, slots, write) };
}

/**
 * The Copilot skill: `{{slot}}` becomes `$(n)` and `{{input}}` becomes `$(input)`.
 * The frontmatter holds only name, description, version, and argument-hint (each when the source has it)
 * and `disable-model-invocation`: always `true` for a prompt,
 * the source's own value (if any) for a skill.
 * The folder is the kebab-case name; a skill's name has no upper-case letter,
 * so it is unchanged.
 */
export function renderCopilot(file: string, text: string, source: Source):
       { folder: string; text: string }
{
   const { name, slots, parts } = prepare(file, text, source);
   const write = (slot: string, position: number) =>
         ('input' === slot ? '$(input)' : `$(${position})`);
   const entries: Array<[string, unknown]> = [
      ...COPILOT_KEYS.map((key): [string, unknown] => [key, parts.data[key]]),
      [
       'disable-model-invocation',
       'prompt' === source ? true : parts.data['disable-model-invocation']
      ],
   ];
   const front = Object.fromEntries(entries.filter(([, value]) => present(value)));
   return {
      folder: kebab(name),
      text: `---\n${dump(front, { lineWidth: -1 })}---\n${fill(parts.body, slots, write)}`,
   };
}
