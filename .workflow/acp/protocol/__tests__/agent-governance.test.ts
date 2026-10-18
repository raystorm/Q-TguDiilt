import { describe, it, expect, vi } from 'vitest';
import { DriverGovernanceUnsupportedError } from '../errors.js';
import { type LogEntry, createCx, createDriverSpy, makeAgent, newSessionArgs, readReport, editReport, allow, reject, requestsOf, detailsOf, eventsOf, runTurn, denials, textParam } from './agent.helpers.js';

// Group 10: Governed driver interface ---------------------------------------

describe('Group 10 — governed driver interface', () => {
   it('prompt awaits an async execute, then streams its text and stores the session id', async () => {
      let release!: (result: any) => void;
      const delayed = new Promise<any>(resolve => { release = resolve; });
      const driver  = createDriverSpy(() => delayed);
      const { agent, sessionStore } = makeAgent({ driver });
      const s    = await agent.newSession(newSessionArgs());
      const cx   = createCx();
      const turn = agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx);
      await vi.waitFor(() => expect(driver.seen).toHaveLength(1));
      expect(JSON.stringify(cx.calls)).not.toContain('late answer');
      release({ text: 'late answer', sessionId: 'drv-late', toolCalls: [] });
      await turn;
      expect(JSON.stringify(cx.calls)).toContain('late answer');
      expect(sessionStore.get(s.sessionId)?.driverSessionId).toBe('drv-late');
   });

   const unsupported = [
      { label: 'supportsToolCallGovernance false',
        base: { name: 'plain', supportsToolCallGovernance: false },
        shown: 'plain', logged: 'plain' },
      { label: 'supportsToolCallGovernance absent',
        base: { name: 'silent' },
        shown: 'silent', logged: 'silent' },
      { label: 'a legacy shape (sync execute, no name)',
        base: {},
        shown: 'an unnamed driver', logged: 'unnamed' },
   ];

   it.each(unsupported)('rejects a driver with $label before any work', async ({ base, shown, logged }) => {
      const executed: string[] = [];
      const driver = {
         ...base,
         execute: (command: string) => { executed.push(command); return { text: 'x', sessionId: 'y' }; },
      };
      const { agent, sessionStore, logger } = makeAgent({ driver });
      const s   = await agent.newSession(newSessionArgs());
      const cx  = createCx();
      const err = await agent
         .prompt({ sessionId: s.sessionId, ...textParam('SECRET_PROMPT_TEXT') }, cx)
         .then(() => undefined, (e: any) => e);
      expect(err).toBeInstanceOf(DriverGovernanceUnsupportedError);
      expect(err.message).toContain(shown);
      expect(err.message).toContain('cannot report tool calls');
      expect(err.message).toContain('supportsToolCallGovernance: true');
      expect(executed).toEqual([]);
      expect(cx.calls).toHaveLength(0);
      expect(sessionStore.hasActiveTurn(s.sessionId)).toBe(false);
      const errors = logger.entries.filter((e: LogEntry) => 'error' === e.level);
      expect(errors).toHaveLength(1);
      expect(errors[0].data.sessionId).toBe(s.sessionId);
      expect(errors[0].data.driver).toBe(logged);
      expect(JSON.stringify(errors[0].data)).not.toContain('SECRET_PROMPT_TEXT');
   });
});

describe('Group 11 — tool-call handler: supplied and answered', () => {
   it('[H] the handler is supplied on a first turn, a later turn and a resumed session', async () => {
      const { agent, driver } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('first') }, cx);
      await agent.prompt({ sessionId: s.sessionId, ...textParam('later') }, cx);
      await agent.loadSession({ sessionId: 'sess-prev', workflowId: 'wf-prev' } as any);
      await agent.prompt({ sessionId: 'sess-prev', ...textParam('resumed') }, cx);
      expect(driver.seen).toHaveLength(3);
      for (const call of driver.seen) { expect(typeof call.options.onToolCall).toBe('function'); }
   });

   it('[H] a rule-approved report runs without asking the user', async () => {
      const { fake, cx } = await runTurn([readReport], { rules: [{ kind: 'read', action: 'approve' }] });
      expect(fake.ran()).toEqual([readReport]);
      expect(requestsOf(cx)).toHaveLength(0);
      expect(detailsOf(cx)).toHaveLength(0);
   });

   it('[H] a rule-denied report does not run and the user is not asked', async () => {
      const { fake, cx } = await runTurn([editReport], { rules: [{ kind: 'edit', action: 'deny' }] });
      expect(fake.ran()).toEqual([]);
      expect(requestsOf(cx)).toHaveLength(0);
      expect(detailsOf(cx)).toHaveLength(0);
   });

   it('[H] ask: the detail is sent before the approval request, and allow runs the call', async () => {
      const { fake, cx } = await runTurn([editReport]);
      expect(fake.ran()).toEqual([editReport]);
      const detail   = cx.calls.findIndex(c => 'tool_call' === c.params?.update?.sessionUpdate);
      const approval = cx.calls.findIndex(c => 'session/request_permission' === c.method);
      expect(detail).toBeGreaterThanOrEqual(0);
      expect(approval).toBeGreaterThan(detail);
   });

   it.each(denials)('[H] ask, then %s: the call is denied and the turn completes', async (_name, makeCx) => {
      const cx = makeCx();
      const { fake } = await runTurn([editReport], { cx });
      expect(fake.ran()).toEqual([]);
   });

   it('[H] a failed detail update means no approval request is sent', async () => {
      const cx = createCx({ failDetail: true });
      await runTurn([editReport], { cx });
      expect(requestsOf(cx)).toHaveLength(0);
   });

   it('[H] a report missing what its kind needs is denied without asking', async () => {
      const { fake, cx } = await runTurn([{ kind: 'edit', title: 'Edit nothing' }], { defaultAction: 'approve' });
      expect(fake.ran()).toEqual([]);
      expect(requestsOf(cx)).toHaveLength(0);
      expect(detailsOf(cx)).toHaveLength(0);
   });

   it('[H] an allow is not remembered: the identical ask is asked again', async () => {
      const cx = createCx({ respond: (_params, index) => ({ outcome: 0 === index ? allow : reject }) });
      const { fake } = await runTurn([editReport, editReport, readReport], {
         cx, rules: [{ kind: 'read', action: 'approve' }],
      });
      expect(fake.ran()).toEqual([editReport, readReport]);
      expect(requestsOf(cx)).toHaveLength(2);
   });

   it('[H] concurrent asks stay separate', async () => {
      const gates: Array<(answer: unknown) => void> = [];
      const cx = createCx({ respond: () => new Promise(resolve => { gates.push(resolve); }) });
      const decided: string[] = [];
      const driver = createDriverSpy(async (_command: string, options: any) => {
         const [first, second] = await Promise.all([
            options.onToolCall({ ...editReport, title: 'first' }),
            options.onToolCall({ ...editReport, title: 'second' }),
         ]);
         decided.push(first, second);
         return { text: 'ok', sessionId: 'drv' };
      });
      const { agent } = makeAgent({ driver });
      const s    = await agent.newSession(newSessionArgs());
      const turn = agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx);
      await vi.waitFor(() => expect(gates).toHaveLength(2));
      gates[1]({ outcome: allow });   // the second ask is answered first
      gates[0]({ outcome: reject });
      await turn;
      expect(decided).toEqual(['deny', 'approve']);
   });

   it('asks carry the right session and do not share state across sessions', async () => {
      const answers: Record<string, string> = {};
      const driver = createDriverSpy(async (command: string, options: any) => {
         answers[command] = await options.onToolCall(editReport);
         return { text: 'ok', sessionId: `drv-${command}` };
      });
      const { agent } = makeAgent({ driver });
      const a   = await agent.newSession(newSessionArgs());
      const b   = await agent.newSession(newSessionArgs());
      const cxA = createCx({ permission: reject });
      const cxB = createCx({ permission: allow });
      await Promise.all([
         agent.prompt({ sessionId: a.sessionId, ...textParam('one') }, cxA),
         agent.prompt({ sessionId: b.sessionId, ...textParam('two') }, cxB),
      ]);
      expect(answers).toEqual({ one: 'deny', two: 'approve' });
      for (const [cx, s] of [[cxA, a], [cxB, b]] as const) {
         const scoped = [...detailsOf(cx), ...requestsOf(cx)];
         expect(scoped).toHaveLength(2);
         expect(scoped.every(c => s.sessionId === c.params.sessionId)).toBe(true);
      }
   });

   it('a turn with no tool calls returns its text and asks nothing', async () => {
      const { cx } = await runTurn([]);
      expect(JSON.stringify(cx.calls)).toContain('done');
      expect(requestsOf(cx)).toHaveLength(0);
      expect(detailsOf(cx)).toHaveLength(0);
   });
});

describe('Group 12 — governance evaluation error', () => {
   const failing = { evaluateToolCall: () => { throw new Error('evaluation blew up'); } };

   it('[H] falls back to ask through the normal flow, noting governance could not evaluate', async () => {
      const { fake, cx, logger } = await runTurn([editReport], { governance: failing });
      expect(fake.ran()).toEqual([editReport]);
      expect(JSON.stringify(detailsOf(cx))).toContain('could not evaluate');
      expect(eventsOf(logger, 'governance_decision')[0].data)
         .toMatchObject({ action: 'ask', reason: 'evaluation_error', kind: 'edit' });
   });

   it.each(denials)('[H] and when %s the call is denied', async (_name, makeCx) => {
      const { fake } = await runTurn([editReport], { cx: makeCx(), governance: failing });
      expect(fake.ran()).toEqual([]);
   });
});
