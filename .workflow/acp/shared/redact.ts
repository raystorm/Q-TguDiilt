/**
 * Removes secrets from free text before it is shown or kept.
 *
 * WARNING: this works by pattern. It is a safeguard, not a guarantee. A secret
 * that looks like nothing in the list below goes through untouched, and text
 * that only resembles a secret is replaced. Treat anything it returns as
 * possibly still sensitive, and do not publish it unreviewed.
 */

/** A run of base64 or hex characters this long, with a digit and a letter in it, is taken for a secret. */
export const LONG_RUN_MIN_LENGTH = 32;

/** After a plain space (no colon or equals sign) a value is replaced only when it is this long and has a digit. */
export const SPACED_VALUE_MIN_LENGTH = 6;

export const REDACTED = '[redacted]';

/** Words whose value is a secret: `<word>=value`, `<word>: value` or `<word> value`, in any case. Only the s is optional. */
const SECRET_WORDS = '(?:token|key|credential|securit(?:y|ie))s?';

/** One whitespace character that is not a line break: a value never starts on the next line. */
const BLANK = '[^\\S\\r\\n]';

type Replacer = (substring: string, ...groups: any[]) => string;

const redactAll: Replacer = () => REDACTED;

/** Keeps the word and its separator, replaces the value. */
const keepWord: Replacer = (_match, word: string, assigned?: string, spaced?: string) =>
   `${word}${assigned ?? spaced}${REDACTED}`;

/** A long base64 or hex run needs a digit and a letter, so words, identifiers and plain numbers survive. */
const redactRun: Replacer = run => /\d/.test(run) && /[A-Za-z]/.test(run) ? REDACTED : run;

/** The value is replaced, the rest of the line stays. */
const RULES: ReadonlyArray<readonly [RegExp, Replacer]> = [
   // A private key block, whole or cut short.
   [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, redactAll],
   [/\bBearer\s+[\w.~+\/=-]+/gi, () => `Bearer ${REDACTED}`],
   [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, redactAll],
   [/\bgithub_pat_\w{20,}/g, redactAll],
   [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, redactAll],
   [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, redactAll],
   [/\bsk-[\w-]{20,}/g, redactAll],
   // <secret word>, then a colon or an equals sign and any value, or a space and a value that looks like a secret.
   // A value is the run of non-space characters after the separator, so it ends at the space or the line.
   [new RegExp(
      `(\\b[\\w-]*${SECRET_WORDS}["']?)` +
      `(?:(${BLANK}*[:=]${BLANK}*)\\S+|(${BLANK}+)(?=\\S*\\d)\\S{${SPACED_VALUE_MIN_LENGTH},})`, 'gi'), keepWord],
   // A long base64 or hex run on its own.
   [new RegExp(`(?<![\\w+/=-])[A-Za-z0-9+/]{${LONG_RUN_MIN_LENGTH},}={0,2}`, 'g'), redactRun],
];

export function redact(text: string): string {
   return RULES.reduce((out, [pattern, replacer]) => out.replace(pattern, replacer), text);
}
