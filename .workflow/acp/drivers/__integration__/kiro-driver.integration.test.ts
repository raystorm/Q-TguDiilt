/**
 * Integration tests for the Kiro driver.
 *
 * These tests invoke the real Kiro CLI and require:
 *   - `kiro` binary installed and on PATH
 *   - Active Kiro authentication
 *
 * Run manually with:
 *   npm run test:integration
 *
 * These tests are excluded from the default `npm test` run.
 * They will fail if the binary is not found or not authenticated.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { createKiroDriver, Cli, CliResult } from '../kiro-driver.js';

function createRealCli(): Cli {
   return {
      run(args: string[]): CliResult {
         const output   = execSync(`kiro-cli ${args.map(a => `"${a}"`).join(' ')}`, {
            encoding: 'utf8',
         });
         const lines    = output.trim().split('\n').filter(Boolean);
         const finished = lines.map(l => JSON.parse(l)).find(e => 'runFinished' === e.type);
         return {
            finalText: finished?.data?.finalText ?? '',
            sessionId: finished?.data?.sessionId ?? '',
         };
      }
   };
}

describe('Kiro driver — integration', () => {
   it('executes a prompt and returns a non-empty text response', () => {
      const driver = createKiroDriver(createRealCli());
      const result = driver.execute('Say only the word PONG');
      expect(result.text.length).toBeGreaterThan(0);
   });

   it('returns a sessionId from the CLI', () => {
      const driver = createKiroDriver(createRealCli());
      const result = driver.execute('Say only the word PONG');
      expect(result.sessionId.length).toBeGreaterThan(0);
   });
});
