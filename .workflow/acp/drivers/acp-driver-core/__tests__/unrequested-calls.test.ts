import { describe, it, expect } from 'vitest';
import { loggedPath } from '../../../governance/engine.js';
import {
   SESSION, ALLOW, REJECT, type Decide, approve, deny, type Script, runTurn, unrequested,
} from './permissions.helpers.js';

describe('tool calls that run without a request', () => {
   const run = (script: (s: Script) => Promise<unknown>, decide: Decide = approve) => runTurn(script, decide);

   it.each(['edit', 'delete', 'move', 'execute', 'fetch', 'other'])(
      '[H] a %s call that runs with no request is logged once, and the turn is unchanged',
      async kind => {
         const { logger, result, reports } = await run(async ({ call, update }) => {
            await call({ toolCallId: 'c1', kind, status: 'pending', locations: [{ path: '/r/f.ts' }] });
            await update({ toolCallId: 'c1', status: 'in_progress' });
            await update({ toolCallId: 'c1', status: 'completed' });
         });
         expect(unrequested(logger)).toEqual([[
            'governance_unrequested',
            { agentSessionId: SESSION, toolCallId: 'c1', kind, paths: ['/r/f.ts'] },
         ]]);
         expect(result.toolCalls).toEqual([]);
         expect(reports).toEqual([]);
      },
   );

   it.each(['read', 'search', 'think'])('a %s call that runs with no request is never logged', async kind => {
      const { logger } = await run(async ({ call, update }) => {
         await call({ toolCallId: 'c1', kind, status: 'pending' });
         await update({ toolCallId: 'c1', status: 'completed' });
      });
      expect(unrequested(logger)).toEqual([]);
   });

   it('a call that went from pending to completed with no in_progress is still logged', async () => {
      const { logger } = await run(async ({ call, update }) => {
         await call({ toolCallId: 'c1', kind: 'execute', status: 'pending' });
         await update({ toolCallId: 'c1', status: 'completed' });
      });
      expect(unrequested(logger)).toHaveLength(1);
   });

   it.each([
      ['approved',  approve, [ALLOW, REJECT]],
      ['denied',    deny,    [ALLOW, REJECT]],
      ['cancelled', approve, []],
   ] as Array<[string, Decide, object[]]>)(
      'a call whose request was %s is never logged',
      async (_label, decide, options) => {
         const { logger } = await run(async ({ call, update, ask }) => {
            await call({ toolCallId: 'c1', kind: 'execute', status: 'pending', rawInput: { command: 'ls' } });
            await ask({ toolCallId: 'c1' }, options);
            await update({ toolCallId: 'c1', status: 'in_progress' });
            await update({ toolCallId: 'c1', status: 'completed' });
         }, decide);
         expect(unrequested(logger)).toEqual([]);
      },
   );

   it('an update for an id never announced still counts', async () => {
      const { logger } = await run(async ({ update }) => {
         await update({ toolCallId: 'u1', kind: 'execute', status: 'in_progress' });
      });
      expect(unrequested(logger))
         .toEqual([['governance_unrequested', { agentSessionId: SESSION, toolCallId: 'u1', kind: 'execute' }]]);
   });

   it('repeated updates give one entry, and two calls give two', async () => {
      const { logger } = await run(async ({ call, update }) => {
         await call({ toolCallId: 'c1', kind: 'execute' });
         await update({ toolCallId: 'c1', status: 'in_progress' });
         await update({ toolCallId: 'c1', status: 'in_progress' });
         await update({ toolCallId: 'c2', kind: 'edit', status: 'in_progress' });
         await update({ toolCallId: 'c2', status: 'completed' });
      });
      expect(unrequested(logger).map(([, entry]) => entry.toolCallId)).toEqual(['c1', 'c2']);
   });

   it('calls that never ran are not logged', async () => {
      const { logger } = await run(async ({ call, update }) => {
         await call({ toolCallId: 'c1', kind: 'execute', status: 'pending' });
         await update({ toolCallId: 'c1', status: 'failed' });
         await update({ toolCallId: 'c2', kind: 'edit', status: 'failed' });
      });
      expect(unrequested(logger)).toEqual([]);
   });

   it('[H] the entry carries the allowed fields and nothing else', async () => {
      const long = `/r/${'a'.repeat(600)}`;
      const { logger } = await run(async ({ call }) => {
         await call({
            toolCallId: 'c1', kind: 'edit', status: 'in_progress', title: 'CANARY-TITLE',
            rawInput: { command: 'CANARY-RAW' },
            locations: [{ path: long }],
            content: [{ type: 'diff', path: '/r/a.ts', oldText: 'CANARY-OLD', newText: 'CANARY-NEW' }],
         });
      });
      const [[, entry]] = unrequested(logger);
      expect(entry).toStrictEqual({
         agentSessionId: SESSION, toolCallId: 'c1', kind: 'edit', paths: [loggedPath(long), '/r/a.ts'],
      });
      expect(entry.paths[0].length).toBeLessThan(long.length);
      expect(JSON.stringify(entry)).not.toContain('CANARY');
   });

   it('the kind comes from the latest update, and earlier values are kept when omitted', async () => {
      const { logger } = await run(async ({ call, update }) => {
         await call({ toolCallId: 'c1', kind: 'execute', status: 'pending' });
         await update({ toolCallId: 'c1', status: 'in_progress' });
      });
      expect(unrequested(logger)[0][1].kind).toBe('execute');
   });
});
