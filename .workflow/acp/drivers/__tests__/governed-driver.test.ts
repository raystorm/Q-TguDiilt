import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
   Driver,
   DriverResult,
   ExecuteOptions,
   ToolCallDecision,
   ToolCallKind,
   ToolCallOutcome,
   ToolCallReport,
   declaresToolCallGovernance,
   validateExecuteArgs,
} from '../governed-driver.js';
import { createFakeGovernedDriver } from './fake-governed-driver.js';
import { describeGovernedDriverContract } from './governed-driver.contract.js';

describeGovernedDriverContract('fake', createFakeGovernedDriver);

describe('governed-driver module', () => {
   it('is self-contained: no legacy driver or ACP SDK imports', () => {
      const source = readFileSync(
         fileURLToPath(new URL('../governed-driver.ts', import.meta.url)), 'utf8');
      expect(source).not.toMatch(/['"]\.\/(driver|kiro-driver|copilot-driver)(\.js)?['"]/);
      expect(source).not.toMatch(/@agentclientprotocol\/sdk/);
   });

   it('exports the contract types (tsc is the gate)', () => {
      const kind:     ToolCallKind     = 'other';
      const decision: ToolCallDecision = 'approve';
      const report:   ToolCallReport   = { kind, title: 't' };
      const outcome:  ToolCallOutcome  = { report, decision };
      const options:  ExecuteOptions   = { onToolCall: async () => decision };
      const result:   DriverResult     = { text: '', sessionId: '', toolCalls: [outcome] };
      const driver:   Driver           = {
         name: 'x', supportsToolCallGovernance: false, execute: async () => result,
      };
      // @ts-expect-error name is required
      const noName: Driver = { supportsToolCallGovernance: true, execute: async () => result };
      // @ts-expect-error supportsToolCallGovernance is required
      const noFlag: Driver = { name: 'x', execute: async () => result };
      expect([options, driver, noName, noFlag]).toHaveLength(4);
   });

   it('execute returns a Promise resolving to a DriverResult', async () => {
      const { driver } = createFakeGovernedDriver();
      const pending = driver.execute('cmd');
      expect(pending).toBeInstanceOf(Promise);
      await expect(pending).resolves.toEqual({
         text: 'done', sessionId: 'fake-sess', toolCalls: [],
      });
   });

   it('supportsToolCallGovernance is an explicit boolean', () => {
      const { driver } = createFakeGovernedDriver();
      expect(typeof driver.supportsToolCallGovernance).toBe('boolean');
   });

   it('declaresToolCallGovernance is true only for an explicit true', () => {
      expect(declaresToolCallGovernance({ supportsToolCallGovernance: true })).toBe(true);
      for (const value of [
         { supportsToolCallGovernance: false }, { supportsToolCallGovernance: 'true' },
         { supportsToolCallGovernance: 1 }, {}, { execute: () => ({}) }, null, undefined,
      ]) {
         expect(declaresToolCallGovernance(value)).toBe(false);
      }
   });
});

describe('cancellation additions', () => {
   it('are additive and optional (tsc is the gate)', () => {
      const options:   ExecuteOptions = { signal: new AbortController().signal };
      const bare:      ExecuteOptions = {};
      const cancelled: DriverResult   = { text: '', sessionId: '', toolCalls: [], cancelled: true };
      const plain:     Driver         = { name: 'x', supportsToolCallGovernance: true, execute: async () => cancelled };
      const closable:  Driver         = { ...plain, close: async () => {} };
      // @ts-expect-error signal must be an AbortSignal
      const badSignal: ExecuteOptions = { signal: 'abort' };
      // @ts-expect-error a decision is still only approve or deny
      const badDecision: ToolCallDecision = 'cancel';
      expect([options, bare, plain, closable, badSignal, badDecision]).toHaveLength(6);
   });

   it('[H] a normal result carries no cancelled key', async () => {
      const { driver } = createFakeGovernedDriver();
      const result = await driver.execute('cmd', { signal: new AbortController().signal });
      expect(result).toStrictEqual({ text: 'done', sessionId: 'fake-sess', toolCalls: [] });
      expect(Object.keys(result)).not.toContain('cancelled');
   });
});

describe('fake governed driver', () => {
   it('script applies to the next execute started', async () => {
      const h = createFakeGovernedDriver();
      h.script([{ kind: 'read', title: 'a' }]);
      const first = h.driver.execute('one', { onToolCall: async () => 'approve' });
      h.script([{ kind: 'edit', title: 'b' }]);
      const second = h.driver.execute('two', { onToolCall: async () => 'approve' });
      await Promise.all([first, second]);
      expect(h.ran().map(r => r.title)).toEqual(['a', 'b']);
   });

   it('offers close, which releases the downstream agent once', async () => {
      const h = createFakeGovernedDriver();
      expect(typeof h.driver.close).toBe('function');
      await h.driver.close?.();
      await h.driver.close?.();
      expect(h.released()).toBe(1);
   });

   it('records the gate before the run for each approved call', async () => {
      const h = createFakeGovernedDriver();
      const answers: ToolCallDecision[] = ['approve', 'deny'];
      h.script([{ kind: 'read', title: 'a' }, { kind: 'edit', title: 'b' }]);
      await h.driver.execute('cmd', { onToolCall: async () => answers.shift() as ToolCallDecision });
      expect(h.events).toEqual(['gate:a', 'run:a', 'gate:b']);
   });
});

describe('validateExecuteArgs mirrors the legacy rules', () => {
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
