import { describe, it, expect } from 'vitest';
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

describe('Kiro driver — happy path', () => {
   it('executes command, returns { sessionId, text }', () => {
      const driver = createKiroDriver(createCliDouble());
      const result = driver.execute('do something');
      expect(result).toHaveProperty('sessionId');
      expect(result).toHaveProperty('text');
   });

   it('returns sessionId from CLI response', () => {
      const driver = createKiroDriver(createCliDouble({ sessionId: 'sess-abc' }));
      const result = driver.execute('cmd');
      expect(result.sessionId).toBe('sess-abc');
   });

   it('passes model option to CLI', () => {
      let capturedArgs: string[] | undefined;
      const cli = { run: (args: string[]) => { capturedArgs = args; return { finalText: '', sessionId: 's' }; } };
      const driver = createKiroDriver(cli);
      driver.execute('cmd', { model: 'kiro-2' });
      expect(capturedArgs).toContain('--model');
      expect(capturedArgs).toContain('kiro-2');
   });

   it('passes sessionId option as --resume-id to CLI', () => {
      let capturedArgs: string[] | undefined;
      const cli = { run: (args: string[]) => { capturedArgs = args; return { finalText: '', sessionId: 's' }; } };
      const driver = createKiroDriver(cli);
      driver.execute('cmd', { sessionId: 'sess-xyz' });
      expect(capturedArgs).toContain('--resume-id');
      expect(capturedArgs).toContain('sess-xyz');
   });

   it('prepends context to command input when provided', () => {
      let capturedArgs: string[] | undefined;
      const cli = { run: (args: string[]) => { capturedArgs = args; return { finalText: '', sessionId: 's' }; } };
      const driver = createKiroDriver(cli);
      driver.execute('do task', { context: 'context content' });
      const input = capturedArgs![capturedArgs!.length - 1];
      expect(input).toContain('context content');
      expect(input).toContain('do task');
   });

   it('omits context from input when not provided', () => {
      let capturedArgs: string[] | undefined;
      const cli = { run: (args: string[]) => { capturedArgs = args; return { finalText: '', sessionId: 's' }; } };
      const driver = createKiroDriver(cli);
      driver.execute('do task');
      const input = capturedArgs![capturedArgs!.length - 1];
      expect(input).toBe('do task');
   });
});

describe('Kiro driver — error paths', () => {
   it('CLI non-zero exit → throws error', () => {
      const driver = createKiroDriver(createCliDouble({ exitCode: 1 }));
      expect(() => driver.execute('cmd')).toThrow(/CLI exited/i);
   });

   it('null command → validation error', () => {
      const driver = createKiroDriver(createCliDouble());
      expect(() => driver.execute(null as unknown as string)).toThrow(/command/i);
   });

   it('empty command → validation error', () => {
      const driver = createKiroDriver(createCliDouble());
      expect(() => driver.execute('')).toThrow(/command/i);
   });
});

describe('Independent testability', () => {
   it('Kiro driver testable with CLI replaced by test double', () => {
      const driver = createKiroDriver(createCliDouble({ finalText: 'mocked' }));
      const result = driver.execute('cmd');
      expect(result.text).toBe('mocked');
   });
});
