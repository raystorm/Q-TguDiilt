import { describe, it, expect } from 'vitest';
import { evaluateToolCall } from '../../../governance/engine.js';
import type { ToolCallReport } from '../../governed-driver.js';
import { createToolCallTable } from '../permissions.js';
import { flush, makeDriver } from './acp-driver.helpers.js';
import { SESSION, APPROVE_BY_DEFAULT, scriptFor, runTurn } from './permissions.helpers.js';

describe('permission reports: correlation', () => {
   it('[H] a request is matched to its call by exact id', async () => {
      const { reports } = await runTurn(async ({ call, ask }) => {
         await call({ toolCallId: 'X', kind: 'execute', rawInput: { command: 'ls -la' } });
         await ask({ toolCallId: 'X' });
      });
      expect(reports).toMatchObject([{ kind: 'execute', command: 'ls -la' }]);
   });

   it.each(['CALL_1', 'call_1 ', 'call_10', 'call_', ''])(
      '[H] a request whose id is %j is not matched to call_1',
      async other => {
         const { reports } = await runTurn(async ({ call, ask }) => {
            await call({
               toolCallId: 'call_1', kind: 'read', rawInput: { command: 'cat secret' },
               locations: [{ path: '/r/secret' }],
            });
            await ask({ toolCallId: other, title: 'asked' });
         });
         expect(reports).toStrictEqual([{ kind: 'other', title: 'asked' }]);
      },
   );

   it('[H] equal titles do not correlate different ids', async () => {
      const { reports } = await runTurn(async ({ call, ask }) => {
         await call({ toolCallId: 'A', kind: 'read', title: 'build' });
         await ask({ toolCallId: 'B', title: 'build', rawInput: { command: 'rm -rf .' } });
      });
      expect(reports[0].kind).toBe('other');
      expect(reports[0].command).toBe('rm -rf .');
   });

   it('[H] a reused static id does not inherit an earlier call\'s data', async () => {
      const { reports } = await runTurn(async ({ call, update, ask }) => {
         await call({ toolCallId: 'shell-permission', kind: 'read', locations: [{ path: '/r/a.ts' }] });
         await ask({ toolCallId: 'shell-permission' });
         await update({ toolCallId: 'shell-permission', status: 'completed' });
         await ask({ toolCallId: 'shell-permission', rawInput: { command: 'rm -rf .' } });
      });
      expect(reports[1]).toStrictEqual({
         kind: 'other', title: '', command: 'rm -rf .', rawInput: { command: 'rm -rf .' },
      });
   });

   it('[H] nothing from one turn correlates into the next', async () => {
      const { driver, agents } = makeDriver();
      const reports: ToolCallReport[] = [];
      let turn = 0;
      agents[0].respond('session/prompt', async () => {
         const script = scriptFor(agents[0], reports);
         turn += 1;
         if (1 === turn) { await script.call({ toolCallId: 'T', kind: 'read' }); }
         else            { await script.ask({ toolCallId: 'T' }); }
         await flush();
         return { stopReason: 'end_turn' };
      });
      const onToolCall = async (report: ToolCallReport) => { reports.push(report); return 'approve' as const; };
      const first = await driver.execute('one', { onToolCall });
      await driver.execute('two', { sessionId: first.sessionId, onToolCall });
      expect(reports).toStrictEqual([{ kind: 'other', title: '' }]);
   });

   it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
      '[H] the agent-chosen id %s cannot corrupt the correlation',
      async id => {
         const { reports } = await runTurn(async ({ call, ask }) => {
            await call({ toolCallId: id, kind: 'execute', rawInput: { command: 'ls' } });
            await call({ toolCallId: 'other', kind: 'read' });
            await ask({ toolCallId: id });
            await ask({ toolCallId: 'other' });
         });
         expect(reports.map(report => report.kind)).toEqual(['execute', 'read']);
         expect(Object.keys(Object.prototype)).toEqual([]);
         expect(({} as any).kind).toBeUndefined();
      },
   );

   it('a call announced just before its request is matched, even sent back to back', async () => {
      const { reports } = await runTurn(async ({ agent, ask }) => {
         void agent.notify('session/update', {
            sessionId: SESSION,
            update: {
               sessionUpdate: 'tool_call', toolCallId: 'B', title: '', kind: 'execute', rawInput: { command: 'ls' },
            },
         });
         await ask({ toolCallId: 'B' });
      });
      expect(reports).toMatchObject([{ kind: 'execute', command: 'ls' }]);
   });

   it('later stream updates fill in earlier ones', async () => {
      const { reports } = await runTurn(async ({ call, update, ask }) => {
         await call({ toolCallId: 'm', kind: 'execute' });
         await update({ toolCallId: 'm', rawInput: { command: 'ls' }, locations: [{ path: '/r/a.ts' }] });
         await ask({ toolCallId: 'm' });
      });
      expect(reports).toMatchObject([{ kind: 'execute', command: 'ls', paths: ['/r/a.ts'] }]);
   });

   it('a change that arrives after the report was made does not change it', async () => {
      let before: ToolCallReport | undefined;
      const { reports } = await runTurn(async ({ call, update, ask, reports: seen }) => {
         await call({ toolCallId: 'X', kind: 'execute', rawInput: { command: 'ls' } });
         await ask({ toolCallId: 'X' });
         before = structuredClone(seen[0]);
         await update({ toolCallId: 'X', kind: 'delete', rawInput: { command: 'rm -rf .' } });
      });
      expect(reports[0]).toEqual(before);
      expect(reports[0]).toMatchObject({ kind: 'execute', command: 'ls' });
   });

   it('holds nothing after clear, however many calls the turn had', () => {
      const table = createToolCallTable();
      for (let i = 0; i < 10000; i++) {
         table.note({ toolCallId: `c${i}`, kind: 'execute', status: 'in_progress' }, true);
         if (0 === i % 2) { table.report({ toolCallId: `c${i}` }); }
      }
      expect(table.size).toBeGreaterThan(10000);
      table.clear();
      expect(table.size).toBe(0);
   });
});

describe('permission reports: content', () => {
   it('[H] a request with only an id, status and title has kind other and nothing else', async () => {
      const { reports } = await runTurn(async ({ ask }) => {
         await ask({ toolCallId: 'k1', status: 'pending', title: 'Run shell command' });
      });
      expect(reports).toStrictEqual([{ kind: 'other', title: 'Run shell command' }]);
   });

   it('[H] the title is never used as the command', async () => {
      const { reports } = await runTurn(async ({ ask }) => {
         await ask({ toolCallId: 't', kind: 'execute', title: 'ls -la', rawInput: {} });
      });
      expect(reports[0]).not.toHaveProperty('command');
      expect(evaluateToolCall(APPROVE_BY_DEFAULT, reports[0])).toMatchObject({ action: 'deny' });
   });

   it('an execute request that carries its own command reports it', async () => {
      const { reports } = await runTurn(async ({ ask }) => {
         await ask({ toolCallId: 't', kind: 'execute', rawInput: { command: 'ls' } });
      });
      expect(reports[0]).toMatchObject({ kind: 'execute', command: 'ls' });
   });

   it.each([
      ['read', 'read'], ['edit', 'edit'], ['delete', 'delete'], ['move', 'move'], ['search', 'search'],
      ['execute', 'execute'], ['fetch', 'fetch'], ['think', 'think'], ['other', 'other'],
      ['switch_mode', 'other'], ['future_kind', 'other'], ['EXECUTE', 'other'], ['', 'other'],
      [undefined, 'other'], [7, 'other'],
   ] as Array<[unknown, string]>)('[H] a call of kind %j is reported as %s', async (kind, mapped) => {
      const { reports } = await runTurn(async ({ call, ask }) => {
         await call({ toolCallId: 'k', ...(undefined === kind ? {} : { kind }) });
         await ask({ toolCallId: 'k' });
      });
      expect(reports[0].kind).toBe(mapped);
   });

   it('paths come from locations and diff blocks, each once, as given', async () => {
      const { reports } = await runTurn(async ({ call, ask }) => {
         await call({
            toolCallId: 'p', kind: 'edit',
            locations: [{ path: '/r/a.ts' }, { path: '/r/./b.ts' }],
            content: [
               { type: 'diff', path: '/r/./b.ts', oldText: 'x', newText: 'y' },
               { type: 'diff', path: '/r/c.ts', newText: 'z' },
            ],
         });
         await ask({ toolCallId: 'p' });
      });
      expect(reports[0].paths).toEqual(['/r/a.ts', '/r/./b.ts', '/r/c.ts']);
   });

   it('bad location entries are skipped', async () => {
      const { reports } = await runTurn(async ({ call, ask }) => {
         await call({
            toolCallId: 'p', kind: 'edit',
            locations: [{}, { path: '' }, { path: 42 }, { path: '   ' }, { path: '/r/ok.ts' }],
         });
         await ask({ toolCallId: 'p' });
      });
      expect(reports[0].paths).toEqual(['/r/ok.ts']);
   });

   it('an edit with no usable path reports no paths, and governance denies it even under default approve', async () => {
      const { reports } = await runTurn(async ({ call, ask }) => {
         await call({ toolCallId: 'e', kind: 'edit', locations: [{ path: '' }, {}] });
         await ask({ toolCallId: 'e' });
      });
      expect(reports[0]).not.toHaveProperty('paths');
      expect(evaluateToolCall(APPROVE_BY_DEFAULT, reports[0]))
         .toMatchObject({ action: 'deny', reason: 'missing_paths' });
   });

   it('the diff text is passed on, and only on a call that has a diff block', async () => {
      const { reports } = await runTurn(async ({ call, ask }) => {
         await call({
            toolCallId: 'd', kind: 'edit',
            content: [{ type: 'diff', path: '/r/a.ts', oldText: 'OLD-TEXT', newText: 'NEW-TEXT' }],
         });
         await ask({ toolCallId: 'd' });
         await ask({ toolCallId: 'x', kind: 'execute', rawInput: { command: 'ls' } });
      });
      expect(reports[0].diff).toContain('OLD-TEXT');
      expect(reports[0].diff).toContain('NEW-TEXT');
      expect(reports[1]).not.toHaveProperty('diff');
   });

   it.each([
      ['two spaces',         'ls  -la'],
      ['a newline',          'ls\n rm -rf .'],
      ['a tab',              'ls\t-la'],
      ['a comment marker',   'ls #; rm -rf .'],
      ['non-ASCII and bidi', 'echo \u00e9\u202e'],
      ['200 KB',             'x'.repeat(200 * 1024)],
   ])('[H] a command with %s is passed on character for character', async (_label, command) => {
      const { reports } = await runTurn(async ({ ask }) => {
         await ask({ toolCallId: 'c', kind: 'execute', rawInput: { command } });
      });
      expect(reports[0].command).toBe(command);
   });

   it.each([[42], [['ls']], [{ cmd: 'ls' }], [''], ['   '], [null]])(
      '[H] a command that is %j is missing, and governance denies',
      async value => {
         const { reports } = await runTurn(async ({ ask }) => {
            await ask({ toolCallId: 'c', kind: 'execute', rawInput: { command: value } });
         });
         expect(reports[0]).not.toHaveProperty('command');
         expect(evaluateToolCall(APPROVE_BY_DEFAULT, reports[0]))
            .toMatchObject({ action: 'deny', reason: 'missing_command' });
      },
   );

   it.each([['a string', 'ls'], ['null', null], ['an array', ['ls']]])(
      '[H] raw input that is %s carries no command',
      async (_label, rawInput) => {
         const { reports } = await runTurn(async ({ ask }) => {
            await ask({ toolCallId: 'c', kind: 'execute', rawInput });
         });
         expect(reports[0]).not.toHaveProperty('command');
      },
   );

   it.each([
      [{ command: 'ls', commands: ['ls'] },             'ls'],
      [{ command: 'ls', commands: ['ls', 'rm -rf .'] }, undefined],
      [{ commands: ['ls'] },                            undefined],
      [{ command: 'rm -rf .', commands: ['ls'] },       undefined],
      [{ command: 'ls', commands: 'ls' },               undefined],
      [{ command: 'ls', commands: null },               undefined],
   ])('[H] raw input %j gives the command %j', async (rawInput, expected) => {
      const { reports } = await runTurn(async ({ ask }) => {
         await ask({ toolCallId: 'c', kind: 'execute', rawInput });
      });
      expect(reports[0].command).toBe(expected);
   });

   it('the raw input is forwarded as received and the report has no other keys', async () => {
      const rawInput = { command: 'ls', env: { A: '1' }, list: [1, 2, { b: null }] };
      const { reports } = await runTurn(async ({ ask }) => {
         await ask({ toolCallId: 'c', kind: 'execute', title: 't', rawInput });
      });
      expect(reports[0].rawInput).toEqual(rawInput);
      expect(Object.keys(reports[0]).every(key =>
         ['kind', 'title', 'command', 'paths', 'diff', 'rawInput'].includes(key))).toBe(true);
   });
});
