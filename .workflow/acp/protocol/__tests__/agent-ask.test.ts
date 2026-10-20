import { describe, it, expect } from 'vitest';
import {
   createCx, makeAgent, newSessionArgs, type Cx, requestsOf, detailsOf, runTurn, textParam,
} from './agent.helpers.js';

// Group 4: Ask — detail before approval -----------------------------------

describe('Group 4 — ask: detail before approval', () => {
   it('sends a detail session/update before the request_permission', async () => {
      const { agent } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.ask(
         { sessionId: s.sessionId },
         { command: 'rm -rf build', paths: ['/repo/build'], diff: '- old\n+ new' },
         cx,
      );
      const detailIdx  = cx.calls.findIndex(c => 'session/update'             === c.method);
      const approveIdx = cx.calls.findIndex(c => 'session/request_permission' === c.method);
      expect(detailIdx).toBeGreaterThanOrEqual(0);
      expect(approveIdx).toBeGreaterThan(detailIdx);
   });

   it('the detail message carries the full specifics', async () => {
      const { agent } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.ask(
         { sessionId: s.sessionId },
         { command: 'apply patch', paths: ['/repo/a.ts'], diff: '- a\n+ b' },
         cx,
      );
      const detail = cx.calls.find(c => 'session/update' === c.method);
      const blob   = JSON.stringify(detail?.params);
      expect(blob).toContain('apply patch');
      expect(blob).toContain('/repo/a.ts');
      expect(blob).toContain('+ b');
   });

   it('approval is correlated by session id', async () => {
      const { agent } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.ask({ sessionId: s.sessionId }, { command: 'x', paths: [] }, cx);
      const approve = cx.calls.find(c => 'session/request_permission' === c.method);
      expect(approve?.params.sessionId).toBe(s.sessionId);
   });

   it('denial reports a not-approved outcome; session stays usable', async () => {
      const { agent } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx({ permission: { outcome: 'selected', optionId: 'reject' } });
      const decision = await agent.ask({ sessionId: s.sessionId }, { command: 'x', paths: [] }, cx);
      expect(decision.approved).toBe(false);
      // session still present and can run another turn
      const cx2 = createCx();
      const res = await agent.prompt({ sessionId: s.sessionId, ...textParam('again') }, cx2);
      expect(res.stopReason).toBe('end_turn');
   });

   it('a cancelled ask fails safe as not-approved', async () => {
      const { agent } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx({ permission: { outcome: 'cancelled' } });
      const decision = await agent.ask({ sessionId: s.sessionId }, { command: 'x', paths: [] }, cx);
      expect(decision.approved).toBe(false);
   });
});

describe('Group 13 — ask payload', () => {
   const detailOf = (cx: Cx) => detailsOf(cx)[0].params.update.rawInput;

   it('execute: the detail carries the full command', async () => {
      const command = 'rm -rf build && ls';
      const { cx } = await runTurn([{ kind: 'execute', title: 'Run', command }]);
      expect(detailOf(cx).command).toBe(command);
   });

   it('[H] an edit: paths, the whole diff and the raw request all reach the detail', async () => {
      const diff     = 'x'.repeat(100_000);
      const rawInput = { path: '/repo/a.ts', patch: diff };
      const { cx } = await runTurn([{ kind: 'edit', title: 'Edit', paths: ['/repo/a.ts'], diff, rawInput }]);
      expect(detailOf(cx).paths).toEqual(['/repo/a.ts']);
      expect(detailOf(cx).diff).toBe(diff);
      expect(detailOf(cx).rawInput).toEqual(rawInput);
   });

   it('the title never becomes the command', async () => {
      const { cx } = await runTurn([{ kind: 'fetch', title: 'rm -rf /' }]);
      expect(detailOf(cx).command).toBeUndefined();
      expect(detailsOf(cx)[0].params.update.title).toBe('Requested action');
      expect(detailOf(cx).agentTitle).toBe('rm -rf /');
   });

   it('a report with only kind and title still asks, showing both', async () => {
      const { cx } = await runTurn([{ kind: 'other', title: 'Switch mode' }]);
      expect(requestsOf(cx)).toHaveLength(1);
      expect(detailOf(cx)).toMatchObject({ kind: 'other', agentTitle: 'Switch mode' });
   });
});
