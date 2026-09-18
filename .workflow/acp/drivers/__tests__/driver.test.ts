import { describe, it, expect } from 'vitest';
import { validateExecuteArgs } from '../driver.js';

// Stub driver — implements only the interface, no Kiro dependencies
function createStubDriver(returnValue = { sessionId: null as string | null, text: 'stub' }) {
   return { execute: (command: string, options?: object) => returnValue };
}

describe('Driver interface contract', () => {
   it('execute(command) accepted without error', () => {
      const driver = createStubDriver();
      expect(() => driver.execute('cmd')).not.toThrow();
   });

   it('execute(command, {}) accepted without error', () => {
      const driver = createStubDriver();
      expect(() => driver.execute('cmd', {})).not.toThrow();
   });

   it('execute(command, { model }) accepted, model available', () => {
      let capturedOptions: Record<string, unknown> | undefined;
      const driver = {
         execute: (command: string, options?: Record<string, unknown>) => {
            capturedOptions = options;
            return {};
         }
      };
      driver.execute('cmd', { model: 'kiro-2' });
      expect(capturedOptions?.model).toBe('kiro-2');
   });

   it('execute returns a result', () => {
      const driver = createStubDriver();
      const result = driver.execute('cmd');
      expect(result).toBeTruthy();
   });

   it('stub driver satisfies interface without Kiro dependencies', () => {
      const driver = createStubDriver();
      expect(typeof driver.execute).toBe('function');
   });
});

describe('Input validation', () => {
   it('null command → validation error', () => {
      expect(() => validateExecuteArgs(null as unknown as string)).toThrow(/command/i);
   });

   it('undefined command → validation error', () => {
      expect(() => validateExecuteArgs(undefined as unknown as string)).toThrow(/command/i);
   });

   it('empty string command → validation error', () => {
      expect(() => validateExecuteArgs('')).toThrow(/command/i);
   });

   it('whitespace-only command → validation error', () => {
      expect(() => validateExecuteArgs('   ')).toThrow(/command/i);
   });

   it('options.model undefined → proceeds normally', () => {
      expect(() => validateExecuteArgs('cmd', { model: undefined })).not.toThrow();
   });

   it('options.model empty string → validation error', () => {
      expect(() => validateExecuteArgs('cmd', { model: '' })).toThrow(/model/i);
   });
});
