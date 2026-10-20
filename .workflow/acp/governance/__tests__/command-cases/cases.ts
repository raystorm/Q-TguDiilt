import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));

/** One case, as the engine sees it. `tier` is set on case files whose lines start with `P:` or `S:`. */
export interface CaseLine {
   text:  string;
   tier?: 'P' | 'S';
}

const SIMPLE: Record<string, string> = { n: '\n', r: '\r', t: '\t', v: '\v', f: '\f', 0: '\0' };

/** Turns `\n`, `\r`, `\t`, `\v`, `\f`, `\0` and `\uXXXX` in a line into the characters. */
export function unescape(text: string): string {
   return text.replace(/\\(?:u([0-9a-fA-F]{4})|([nrtvf0]))/g, (_match, hex?: string, simple?: string) =>
      undefined !== hex ? String.fromCharCode(parseInt(hex, 16)) : SIMPLE[simple as string]);
}

/**
 * The cases in one file of this folder, one command per line.
 *
 * - Empty lines and lines starting with `#` are skipped.
 * - A line starting with `esc:` has `\n`, `\r`, `\t`, `\v`, `\f`, `\0` and `\uXXXX`
 *   turned into the characters; every other line is literal.
 * - With `tiered`, a leading `P: ` or `S: ` is the tier of the case, not part of the
 *   command: `P` is primary (a plausible accident), `S` secondary (needs crafted input).
 */
export function readCases(file: string, tiered = false): CaseLine[] {
   return readFileSync(join(DIR, file), 'utf8').split('\n')
      .filter(line => '' !== line.trim() && !line.startsWith('#'))
      .map(line => {
         const match = tiered ? /^([PS]): (.*)$/.exec(line) : null;
         const body  = null === match ? line : match[2];
         const text  = body.startsWith('esc:') ? unescape(body.slice('esc:'.length)) : body;
         return null === match ? { text } : { text, tier: match[1] as 'P' | 'S' };
      });
}

/** The accepted findings in one file, keyed by command. Lines are `<command> | <tier> | <reason>`. */
export function readAccepted(file: string): Map<string, { tier: string; reason: string }> {
   return new Map(
      readFileSync(join(DIR, file), 'utf8').split('\n')
         .filter(line => '' !== line.trim() && !line.startsWith('#'))
         .map(line => {
            // The command may contain ' | ' itself, so the tier and reason are read from the right.
            const parts  = line.split(' | ');
            const reason = parts.pop() as string;
            const tier   = parts.pop() as string;
            return [parts.join(' | '), { tier, reason }] as const;
         }),
   );
}
