/**
 * Live tests of the Kiro driver against the real `kiro-cli`. Manual only: they cost money and need a
 * logged-in kiro-cli on PATH. Excluded from `npm test`. Run one file at a time:
 *
 *    npx vitest run --config vitest.integration.config.ts drivers/__integration__/kiro-acp.integration.test.ts
 *
 * Every prompt is tiny and runs in a throwaway directory. Every tool request is denied.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../acp-client/__tests__/acp-driver.helpers.js';
import { createKiroAcpDriver } from '../kiro-driver-acp.js';

const version = execFileSync('kiro-cli', ['--version'], { encoding: 'utf8' }).trim();
console.log(`live run: ${version}`);

const LIVE_TIMEOUT_MS = 120000;

let previous: string;
let dir: string;

beforeAll(() => {
   previous = process.cwd();
   dir      = realpathSync(mkdtempSync(join(tmpdir(), 'kiro-live-')));
   process.chdir(dir);
});
afterAll(() => {
   process.chdir(previous);
   rmSync(dir, { recursive: true, force: true });
});

describe('kiro-cli through the ACP driver (live)', () => {
   it('[H] setup and verify pass, and a plain turn returns text and no tool calls', async () => {
      const logger = createLogger();
      const driver = createKiroAcpDriver({ logger });
      try {
         const result = await driver.execute('Reply with the single word: ok. Do not use any tools.', {
            onToolCall: async () => 'deny',
         });
         console.log('live turn:', JSON.stringify({ text: result.text, sessionId: result.sessionId }));
         expect(result.sessionId).not.toBe('');
         expect(result.text.length).toBeGreaterThan(0);
         expect(result.toolCalls).toEqual([]);
         expect(logger.warn.mock.calls.filter(([event]) => 'governance_unrequested' === event)).toEqual([]);
      }
      finally {
         await driver.close();
         console.log('live log:', JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]));
      }
   }, LIVE_TIMEOUT_MS);
});
