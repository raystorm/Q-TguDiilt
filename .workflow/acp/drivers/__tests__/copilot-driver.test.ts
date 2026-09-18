import { describe, it, expect } from 'vitest';
import { createCopilotDriver } from '../copilot-driver.js';
import { createKiroDriver } from '../kiro-driver.js';

function createCliDouble({ exitCode = 0, finalText = 'result', sessionId = 'sess-123' } = {}) {
   return {
      run: (args: string[]) => {
         if (0 !== exitCode) {
            const err = new Error(`CLI exited with code ${exitCode}`);
            (err as NodeJS.ErrnoException).code = String(exitCode);
            throw err;
         }
         return { finalText, sessionId };
      }
   };
}

describe('Copilot driver — happy path', () => {
   it('execute returns { text, sessionId }', () => {
      const driver = createCopilotDriver(createCliDouble());
      const result = driver.execute('do something');
      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('sessionId');
   });

   it('returns sessionId from CLI response', () => {
      const driver = createCopilotDriver(createCliDouble({ sessionId: 'sess-abc' }));
      const result = driver.execute('cmd');
      expect(result.sessionId).toBe('sess-abc');
   });

   it('passes model option to CLI', () => {
      let capturedArgs: string[] | undefined;
      const cli = { run: (args: string[]) => { capturedArgs = args; return { finalText: '', sessionId: 's' }; } };
      const driver = createCopilotDriver(cli);
      driver.execute('cmd', { model: 'gpt-4o' });
      expect(capturedArgs).toContain('--model');
      expect(capturedArgs).toContain('gpt-4o');
   });

   it('passes sessionId as resume flag to CLI', () => {
      let capturedArgs: string[] | undefined;
      const cli = { run: (args: string[]) => { capturedArgs = args; return { finalText: '', sessionId: 's' }; } };
      const driver = createCopilotDriver(cli);
      driver.execute('cmd', { sessionId: 'sess-xyz' });
      expect(capturedArgs).toContain('--session-id');
      expect(capturedArgs).toContain('sess-xyz');
   });

   it('prepends context to input when provided', () => {
      let capturedArgs: string[] | undefined;
      const cli = { run: (args: string[]) => { capturedArgs = args; return { finalText: '', sessionId: 's' }; } };
      const driver = createCopilotDriver(cli);
      driver.execute('do task', { context: 'context content' });
      expect(capturedArgs).toContain('context content\n\ndo task');
   });

   it('omits context from input when not provided', () => {
      let capturedArgs: string[] | undefined;
      const cli = { run: (args: string[]) => { capturedArgs = args; return { finalText: '', sessionId: 's' }; } };
      const driver = createCopilotDriver(cli);
      driver.execute('do task');
      expect(capturedArgs).toContain('do task');
      expect(capturedArgs).not.toContain('context content\n\ndo task');
   });

   it('model undefined → no error', () => {
      const driver = createCopilotDriver(createCliDouble());
      expect(() => driver.execute('cmd', { model: undefined })).not.toThrow();
   });
});

describe('Copilot driver — error paths', () => {
   it('CLI throws → error propagates', () => {
      const driver = createCopilotDriver(createCliDouble({ exitCode: 1 }));
      expect(() => driver.execute('cmd')).toThrow(/CLI exited/i);
   });

   it('null command → validation error matching /command/i', () => {
      const driver = createCopilotDriver(createCliDouble());
      expect(() => driver.execute(null as unknown as string)).toThrow(/command/i);
   });

   it('undefined command → validation error matching /command/i', () => {
      const driver = createCopilotDriver(createCliDouble());
      expect(() => driver.execute(undefined as unknown as string)).toThrow(/command/i);
   });

   it('empty command → validation error matching /command/i', () => {
      const driver = createCopilotDriver(createCliDouble());
      expect(() => driver.execute('')).toThrow(/command/i);
   });

   it('whitespace-only command → validation error matching /command/i', () => {
      const driver = createCopilotDriver(createCliDouble());
      expect(() => driver.execute('   ')).toThrow(/command/i);
   });

   it('empty string model → validation error matching /model/i', () => {
      const driver = createCopilotDriver(createCliDouble());
      expect(() => driver.execute('cmd', { model: '' })).toThrow(/model/i);
   });
});

describe('Interface neutrality', () => {
   it('Copilot driver satisfies same interface as Kiro driver', () => {
      const copilot = createCopilotDriver(createCliDouble());
      const kiro    = createKiroDriver(createCliDouble());
      expect(typeof copilot.execute).toBe('function');
      expect(typeof kiro.execute).toBe('function');
   });

   it('independently testable via CLI double', () => {
      const driver = createCopilotDriver(createCliDouble({ finalText: 'mocked' }));
      const result = driver.execute('cmd');
      expect(result.text).toBe('mocked');
   });
});
