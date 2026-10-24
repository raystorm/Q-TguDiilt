/**
 * What the agent prints on stderr: kept bounded, and redacted before anyone
 * reads it. Redaction is by pattern (see `shared/redact.ts`): a safeguard,
 * not a guarantee.
 */
import { redact } from '../../shared/redact.js';

/** At most this many of the last lines are kept. */
export const STDERR_TAIL_MAX_LINES = 200;

/** At most this many of the last bytes are kept. */
export const STDERR_TAIL_MAX_BYTES = 5120;

/** The line that introduces the agent's output in an error message. */
export const TAIL_HEADER = 'the agent printed (last lines, secrets removed, not guaranteed):';

/** A summary and, when the agent printed anything, its last lines. `tail` is already redacted. */
export function withTail(summary: string, tail: string): string {
   return '' === tail
      ? summary
      : `${summary}\n${TAIL_HEADER}\n${tail}`;
}

export interface StderrTail {
   add(text: string): void;
   /** The end of the output, within the limits and redacted. */
   tail(): string;
}

export function createStderrTail(): StderrTail {
   let text = '';

   return {
      add(chunk) {
         text += chunk;
         if (text.length > 4 * STDERR_TAIL_MAX_BYTES) { text = text.slice(-2 * STDERR_TAIL_MAX_BYTES); }
      },

      tail() {
         let lines = text.split('\n');
         if ('' === lines[lines.length - 1]) { lines.pop(); }
         lines = lines.slice(-STDERR_TAIL_MAX_LINES);
         let out = lines.join('\n');
         if (Buffer.byteLength(out) > STDERR_TAIL_MAX_BYTES) {
            // Cut at a line start, so a half secret never survives the cut.
            out = Buffer.from(out).subarray(-STDERR_TAIL_MAX_BYTES).toString();
            const newline = out.indexOf('\n');
            out = -1 === newline ? out.replace(/^\uFFFD+/, '') : out.slice(newline + 1);
         }
         return redact(out);
      },
   };
}
