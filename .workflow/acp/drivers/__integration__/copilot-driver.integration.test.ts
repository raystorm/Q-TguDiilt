/**
 * Integration tests for the Copilot driver.
 *
 * These tests invoke the real Copilot CLI and require:
 *   - `copilot` binary installed and on PATH
 *   - Active Copilot authentication (`copilot login`)
 *
 * Run manually with:
 *   npm run test:integration
 *
 * These tests are excluded from the default `npm test` run.
 * They will fail if the binary is not found or not authenticated.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { createCopilotDriver } from '../copilot-driver.js';
import { Cli, CliResult } from '../kiro-driver.js';

function createRealCli(): Cli {
   return {
      run(args: string[]): CliResult {
         const output = execSync(`copilot ${args.map(a => `"${a}"`).join(' ')}`, {
            encoding: 'utf8',
         });
         const lines      = output.trim().split('\n').filter(Boolean);
         const parsed      = lines.map(l => JSON.parse(l));
         const msgEvent    = parsed.find(e => 'assistant.message' === e.type);
         const resultEvent = parsed.find(e => 'result' === e.type);
         return {
            finalText: msgEvent?.data?.content ?? '',
            sessionId: resultEvent?.sessionId ?? '',
         };
      }
   };
}

describe('Copilot driver — integration', () => {
   it('executes a prompt and returns a non-empty text response', () => {
      const driver = createCopilotDriver(createRealCli());
      const result = driver.execute('Say only the word PONG');
      expect(result.text.length).toBeGreaterThan(0);
   });

   it('returns a sessionId from the CLI', () => {
      const driver = createCopilotDriver(createRealCli());
      const result = driver.execute('Say only the word PONG');
      expect(result.sessionId.length).toBeGreaterThan(0);
   });
});
