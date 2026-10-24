/**
 * The diagnostic log: where the failures of a downstream agent are recorded.
 *
 * One JSON line per failure, in an owner-only file that is capped and rotated
 * to `<file>.1`. Unlike the service log it may hold text that came from the
 * provider or the agent (never the user's own content). The shared writer
 * redacts free text. If the file cannot be used the service carries on: the
 * sink logs one warning with the error code only and then records nothing.
 */
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { createFileLogger, errorCode, type Logger } from './logger.js';

export const DIAGNOSTIC_LOG_MAX_BYTES     = 1024 * 1024;
export const DIAGNOSTIC_MESSAGE_MAX_BYTES = 8 * 1024;

const OWNER_ONLY = 0o600;
const CUT_MARKER = ' [truncated]';

export interface FailureRecord {
   kind:            string;
   message:         string;
   driver:          string;
   pid?:            number;
   agentSessionId?: string;
   exitCode?:       number;
   signal?:         string;
   tail?:           string;
   model?:          string;
}

export interface Diagnostics {
   /** Absent when the file could not be opened at start-up. */
   readonly path?: string;
   /** Never throws. */
   record(data: FailureRecord): void;
}

/** Keeps the beginning of a long message, so one record stays small. */
function cut(message: string): string
{
   if (DIAGNOSTIC_MESSAGE_MAX_BYTES >= Buffer.byteLength(message)) { return message; }
   return Buffer.from(message).subarray(0, DIAGNOSTIC_MESSAGE_MAX_BYTES).toString() + CUT_MARKER;
}

export function createDiagnosticLog(
   { filePath, logger, maxBytes = DIAGNOSTIC_LOG_MAX_BYTES }:
   { filePath: string; logger: Logger; maxBytes?: number },
): Diagnostics
{
   try {
      mkdirSync(dirname(filePath), { recursive: true });
      closeSync(openSync(filePath, 'a', OWNER_ONLY));
   }
   catch (error) {
      logger.warn('diagnostic_log_unavailable', { code: errorCode(error) });
      return { record: () => {} };
   }
   const file = createFileLogger({
      filePath, mode: OWNER_ONLY, maxBytes,
      onWriteFailure: code => logger.warn('diagnostic_log_write_failed', { code }),
   });
   logger.info('diagnostic_log_ready', { path: filePath });
   return {
      path: filePath,
      record(data)
      {
         try { file.error('agent_failure', { ...data, message: cut(data.message) }); }
         catch { /* a record must never break the failure it describes */ }
      },
   };
}
