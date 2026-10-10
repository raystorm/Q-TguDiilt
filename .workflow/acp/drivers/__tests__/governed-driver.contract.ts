import { describe, it, expect } from 'vitest';
import type { Driver, ToolCallDecision, ToolCallReport } from '../governed-driver.js';

export interface GovernedDriverHarness {
   driver: Driver;
   script(reports: ToolCallReport[]): void;
   ran():  ToolCallReport[];
}

const REPORT_KEYS = ['kind', 'title', 'command', 'paths', 'diff', 'rawInput'];

const read: ToolCallReport = { kind: 'read', title: 'Read a.ts', paths: ['/repo/a.ts'] };
const edit: ToolCallReport = {
   kind: 'edit', title: 'Edit a.ts', paths: ['/repo/a.ts'], diff: '- a\n+ b',
};
const exec: ToolCallReport = {
   kind: 'execute', title: 'Run build', command: 'npm run build',
   rawInput: { command: 'npm run build' },
};

const decisions = (outcomes: { decision: ToolCallDecision }[]) =>
   outcomes.map(o => o.decision);

/** Reusable contract: any governed Driver (the fake today, real drivers later). */
export function describeGovernedDriverContract(
   label: string,
   createHarness: () => GovernedDriverHarness,
) {
   describe(`governed driver contract — ${label}`, () => {
      it('onToolCall is passed per call and invoked before the call runs', async () => {
         const h = createHarness();
         const ranAtInvoke: number[] = [];
         h.script([read, edit]);
         await h.driver.execute('cmd', {
            onToolCall: async () => { ranAtInvoke.push(h.ran().length); return 'approve'; },
         });
         expect(ranAtInvoke).toEqual([0, 1]);
      });

      it('reports carry kind and title, plus details when applicable, with no ACP types', async () => {
         const h = createHarness();
         const seen: ToolCallReport[] = [];
         h.script([exec, edit]);
         await h.driver.execute('cmd', {
            onToolCall: async report => { seen.push(report); return 'approve'; },
         });
         expect(seen).toEqual([exec, edit]);
         for (const report of seen) {
            expect(typeof report.kind).toBe('string');
            expect(typeof report.title).toBe('string');
            expect(Object.keys(report).every(k => REPORT_KEYS.includes(k))).toBe(true);
         }
      });

      it('approve: the call runs and execute resolves normally', async () => {
         const h = createHarness();
         h.script([edit]);
         const result = await h.driver.execute('cmd', { onToolCall: async () => 'approve' });
         expect(h.ran()).toEqual([edit]);
         expect(result.toolCalls).toEqual([{ report: edit, decision: 'approve' }]);
      });

      it('deny: the call does not run and the result has a deny outcome', async () => {
         const h = createHarness();
         h.script([edit]);
         const result = await h.driver.execute('cmd', { onToolCall: async () => 'deny' });
         expect(h.ran()).toEqual([]);
         expect(result.toolCalls).toEqual([{ report: edit, decision: 'deny' }]);
      });

      it('approve then deny: only the first runs, outcomes are [approve, deny]', async () => {
         const h = createHarness();
         const answers: ToolCallDecision[] = ['approve', 'deny'];
         h.script([read, edit]);
         const result = await h.driver.execute('cmd', {
            onToolCall: async () => answers.shift() as ToolCallDecision,
         });
         expect(h.ran()).toEqual([read]);
         expect(decisions(result.toolCalls)).toEqual(['approve', 'deny']);
      });

      it('no onToolCall: every call is denied and none runs', async () => {
         const h = createHarness();
         h.script([read, edit, exec]);
         const result = await h.driver.execute('cmd');
         expect(h.ran()).toEqual([]);
         expect(decisions(result.toolCalls)).toEqual(['deny', 'deny', 'deny']);
      });

      it('a handler that throws: the call does not run and execute rejects', async () => {
         const h = createHarness();
         h.script([edit]);
         await expect(h.driver.execute('cmd', {
            onToolCall: () => { throw new Error('handler failed'); },
         })).rejects.toThrow('handler failed');
         expect(h.ran()).toEqual([]);
      });

      it('a handler that rejects: the call does not run and execute rejects', async () => {
         const h = createHarness();
         h.script([edit]);
         await expect(h.driver.execute('cmd', {
            onToolCall: () => Promise.reject(new Error('handler rejected')),
         })).rejects.toThrow('handler rejected');
         expect(h.ran()).toEqual([]);
      });

      it.each(['allow', 'APPROVE', '', undefined, null, true])(
         'a handler resolving %j is denied',
         async value => {
            const h = createHarness();
            h.script([edit]);
            const result = await h.driver.execute('cmd', {
               onToolCall: async () => value as unknown as ToolCallDecision,
            });
            expect(h.ran()).toEqual([]);
            expect(decisions(result.toolCalls)).toEqual(['deny']);
         },
      );
   });
}
