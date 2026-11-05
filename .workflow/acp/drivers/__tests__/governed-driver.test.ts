import { describe, it, expect } from 'vitest';
import {
   Driver,
   DriverResult,
   ExecuteOptions,
   ToolCallDecision,
   ToolCallKind,
   ToolCallOutcome,
   ToolCallReport,
   TurnUpdate,
   declaresToolCallGovernance,
   validateExecuteArgs,
} from '../governed-driver.js';
import { SessionCollapseError } from '../../protocol/errors.js';
import { call, createFakeGovernedDriver, end, gate, say, update } from './fake-governed-driver.js';
import {
   STREAMING_CHECKS,
   describeGovernedDriverContract,
   type GovernedDriverHarness,
} from './governed-driver.contract.js';

describeGovernedDriverContract('fake', createFakeGovernedDriver, { streams: true });
// A driver that never calls onUpdate passes the suite when the streaming checks are off.
describeGovernedDriverContract('plain', () => createFakeGovernedDriver('plain', { streams: false }));

describe('governed-driver module', () => {
   it('exports the contract types (tsc is the gate)', () => {
      const kind:     ToolCallKind     = 'other';
      const decision: ToolCallDecision = 'approve';
      const report:   ToolCallReport   = { kind, title: 't' };
      const outcome:  ToolCallOutcome  = { report, decision };
      const options:  ExecuteOptions   = { onToolCall: async () => decision };
      const result:   DriverResult     = { text: '', sessionId: '', toolCalls: [outcome] };
      const driver:   Driver           = {
         name: 'x', supportsToolCallGovernance: false, execute: async () => result, close: async () => {},
         release: async (sessionId: string) => {},
      };
      // @ts-expect-error name is required
      const noName: Driver = {
         supportsToolCallGovernance: true, execute: async () => result,
         close: async () => {}, release: async () => {},
      };
      // @ts-expect-error supportsToolCallGovernance is required
      const noFlag: Driver = {
         name: 'x', execute: async () => result, close: async () => {}, release: async () => {},
      };
      // @ts-expect-error close is required
      const noClose: Driver = {
         name: 'x', supportsToolCallGovernance: true, execute: async () => result,
         release: async () => {},
      };
      // @ts-expect-error close must return a promise
      const syncClose: Driver = { ...driver, close: () => {} };
      // @ts-expect-error release is required
      const noRelease: Driver = {
         name: 'x', supportsToolCallGovernance: true, execute: async () => result,
         close: async () => {},
      };
      // @ts-expect-error release must return a promise
      const syncRelease: Driver = { ...driver, release: () => {} };
      // @ts-expect-error release takes the session id as a string
      const numberRelease: Driver = { ...driver, release: async (sessionId: number) => {} };
      expect([
         options, driver, noName, noFlag, noClose, syncClose,
         noRelease, syncRelease, numberRelease,
      ]).toHaveLength(9);
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
      const plain:     Driver         = {
         name: 'x', supportsToolCallGovernance: true, execute: async () => cancelled, close: async () => {},
         release: async () => {},
      };
      // @ts-expect-error signal must be an AbortSignal
      const badSignal: ExecuteOptions = { signal: 'abort' };
      // @ts-expect-error a decision is still only approve or deny
      const badDecision: ToolCallDecision = 'cancel';
      expect([options, bare, plain, badSignal, badDecision]).toHaveLength(5);
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
      await h.driver.execute('cmd');
      await h.driver.close();
      await h.driver.close();
      expect(h.released()).toBe(1);
   });

   it('opens its own session for each turn without a session id; the first is fake-sess', async () => {
      const h = createFakeGovernedDriver();
      const first  = await h.driver.execute('one');
      const second = await h.driver.execute('two');
      expect(first.sessionId).toBe('fake-sess');
      expect(second.sessionId).not.toBe(first.sessionId);
      expect(second.sessionId).not.toBe('');
   });

   it('a turn on a session it opened returns that session; any other id gives fake-sess', async () => {
      const h = createFakeGovernedDriver();
      await h.driver.execute('one');
      const second = await h.driver.execute('two');
      const again  = await h.driver.execute('again', { sessionId: second.sessionId });
      const other  = await h.driver.execute('other', { sessionId: 'unknown' });
      expect(again.sessionId).toBe(second.sessionId);
      expect(other.sessionId).toBe('fake-sess');
   });

   it('[H] counts each released session once, by release or close, in any order', async () => {
      const h = createFakeGovernedDriver();
      const a = await h.driver.execute('one');
      const b = await h.driver.execute('two');
      await h.driver.release(a.sessionId);
      await h.driver.release(a.sessionId);
      expect(h.released()).toBe(1);
      await h.driver.close();
      await h.driver.release(b.sessionId);
      await h.driver.close();
      expect(h.released()).toBe(2);
   });

   it('release of an unknown id or the empty id resolves and changes nothing', async () => {
      const h = createFakeGovernedDriver();
      const a = await h.driver.execute('one');
      await expect(h.driver.release('nope')).resolves.toBeUndefined();
      await expect(h.driver.release('')).resolves.toBeUndefined();
      expect(h.released()).toBe(0);
      const again = await h.driver.execute('again', { sessionId: a.sessionId });
      expect(again.sessionId).toBe(a.sessionId);
   });

   it('a turn on a released session rejects with a session collapse; the others still run', async () => {
      const h = createFakeGovernedDriver();
      const a = await h.driver.execute('one');
      const b = await h.driver.execute('two');
      await h.driver.release(a.sessionId);
      await expect(h.driver.execute('again', { sessionId: a.sessionId }))
         .rejects.toBeInstanceOf(SessionCollapseError);
      const other = await h.driver.execute('again', { sessionId: b.sessionId });
      expect(other.sessionId).toBe(b.sessionId);
   });

   it('records the gate before the run for each approved call', async () => {
      const h = createFakeGovernedDriver();
      const answers: ToolCallDecision[] = ['approve', 'deny'];
      h.script([{ kind: 'read', title: 'a' }, { kind: 'edit', title: 'b' }]);
      await h.driver.execute('cmd', { onToolCall: async () => answers.shift() as ToolCallDecision });
      expect(h.events).toEqual(['gate:a', 'run:a', 'gate:b']);
   });
});

describe('validateExecuteArgs', () => {
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

describe('streaming additions', () => {
   it('are additive and optional (tsc is the gate)', () => {
      const text:    TurnUpdate     = { type: 'text', text: 'a' };
      const bare:    TurnUpdate     = { type: 'tool_call', id: 'c1' };
      const full:    TurnUpdate     = {
         type: 'tool_call', id: 'c1', kind: 'edit', title: 't', status: 'running',
         command: 'ls', paths: ['/a'],
      };
      const options: ExecuteOptions = { onUpdate: () => {} };
      const result:  DriverResult   = { text: '', sessionId: '', toolCalls: [], end: 'refused' };
      const report:  ToolCallReport = { id: 'c1', kind: 'read', title: 't' };
      // @ts-expect-error a tool_call update needs an id
      const noId: TurnUpdate = { type: 'tool_call' };
      // @ts-expect-error a status is one of four
      const badStatus: TurnUpdate = { type: 'tool_call', id: 'c1', status: 'in_progress' };
      // @ts-expect-error cancelled is not an end
      const badEnd: DriverResult = { text: '', sessionId: '', toolCalls: [], end: 'cancelled' };
      expect([text, bare, full, options, result, report, noId, badStatus, badEnd]).toHaveLength(9);
   });
});

describe('fake governed driver streaming', () => {
   const asked = { id: 'c1', kind: 'execute', title: 'Run', command: 'ls' } as const;
   const script = [say('a'), call({ ...asked }), gate({ ...asked }), say('b')];
   const labelOf = (u: TurnUpdate) => 'text' === u.type ? `text:${u.text}` : `call:${u.id}`;

   it('[H] streams its script in order and gates after the call is announced', async () => {
      const h = createFakeGovernedDriver();
      const seen: string[] = [];
      let gated: ToolCallReport | undefined;
      h.script(script);
      const result = await h.driver.execute('cmd', {
         onUpdate:   u => { seen.push(labelOf(u)); },
         onToolCall: async report => {
            gated = report;
            seen.push(`gate:${report.id}`);
            return 'approve';
         },
      });
      expect(seen).toEqual(['text:a', 'call:c1', 'gate:c1', 'text:b']);
      expect(result.text).toBe('ab');
      expect(gated?.id).toBe('c1');
   });

   it('in fallback mode stays silent and returns the same text', async () => {
      const h = createFakeGovernedDriver('fake', { streams: false });
      const updates: TurnUpdate[] = [];
      h.script(script);
      const result = await h.driver.execute('cmd', {
         onUpdate:   u => { updates.push(u); },
         onToolCall: async () => 'approve',
      });
      expect(updates).toEqual([]);
      expect(result.text).toBe('ab');
   });

   it('an update step carries only the fields it names', async () => {
      const h = createFakeGovernedDriver();
      const updates: TurnUpdate[] = [];
      h.script([update({ id: 'c1', status: 'completed' })]);
      await h.driver.execute('cmd', { onUpdate: u => { updates.push(u); } });
      expect(updates).toStrictEqual([{ type: 'tool_call', id: 'c1', status: 'completed' }]);
   });

   it('an end step sets the end; without one the result has no end key', async () => {
      const h = createFakeGovernedDriver();
      h.script([say('cut'), end('output_limit')]);
      expect(await h.driver.execute('cmd')).toStrictEqual(
         { text: 'cut', sessionId: 'fake-sess', toolCalls: [], end: 'output_limit' });
      h.script([say('x')]);
      expect(Object.keys(await h.driver.execute('cmd'))).not.toContain('end');
   });
});

describe('the streaming checks can fail', () => {
   const broken = (change: (inner: Driver) => Driver) => (): GovernedDriverHarness => {
      const h = createFakeGovernedDriver('broken');
      return { ...h, driver: change(h.driver) };
   };
   const lateUpdate = broken(inner => ({
      ...inner,
      async execute(command, options) {
         const result = await inner.execute(command, options);
         setTimeout(() => {
            // The check must see the late update, so a callback that throws is not the end of it.
            try { options?.onUpdate?.({ type: 'text', text: 'late' }); } catch { /* ignored */ }
         }, 0);
         return result;
      },
   }));
   const wrongText = broken(inner => ({
      ...inner,
      async execute(command, options) {
         const result = await inner.execute(command, options);
         return { ...result, text: `${result.text}!` };
      },
   }));

   it('the fake passes every check', async () => {
      for (const check of STREAMING_CHECKS) { await check.run(createFakeGovernedDriver); }
   });

   it.each([
      ['never calls onUpdate',            () => createFakeGovernedDriver('quiet', { streams: false })],
      ['calls onUpdate after settling',   lateUpdate],
      ['returns text unlike its updates', wrongText],
   ])('[H] a driver that %s fails a check', async (_label, create) => {
      const outcomes = STREAMING_CHECKS.map(
         check => check.run(create).then(() => false, () => true));
      expect(await Promise.all(outcomes)).toContain(true);
   });
});
