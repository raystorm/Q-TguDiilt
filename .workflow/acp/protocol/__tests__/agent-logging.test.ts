import { describe, it, expect } from 'vitest';
import type { ToolCallReport } from '../../drivers/governed-driver.js';
import { ProviderAuthError } from '../errors.js';
import {
   type LogEntry, createCx, createDriverSpy, makeAgent, newSessionArgs, readReport, editReport,
   eventsOf, runTurn, denials, textParam,
} from './agent.helpers.js';

// Group 9: Operational logging & no secrets --------------------------------

describe('Group 9 — operational logging', () => {
   it('logs session mapping with workflowId on connect', async () => {
      const { agent, logger } = makeAgent();
      const s   = await agent.newSession(newSessionArgs());
      const map = logger.entries.find((e: LogEntry) => 'session_mapped' === e.event);
      expect(map).toBeTruthy();
      expect(map?.data.sessionId).toBe(s.sessionId);
      expect(map?.data.workflowId).toBeTruthy();
   });

   it('logs disconnect', async () => {
      const { agent, logger } = makeAgent();
      await agent.newSession(newSessionArgs());
      await agent.onDisconnect();
      expect(logger.entries.some((e: LogEntry) => 'disconnect' === e.event)).toBe(true);
   });

   it('errors are logged with context', async () => {
      const driver = createDriverSpy(() => { throw new ProviderAuthError('secret-token-xyz in message') });
      const { agent, logger } = makeAgent({ driver });
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx).catch(() => {});
      const errEntry = logger.entries.find((e: LogEntry) => 'error' === e.level);
      expect(errEntry).toBeTruthy();
   });

   it('never logs raw prompt text as a secret channel', async () => {
      const { agent, logger } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('SUPER_SECRET_PROMPT_BODY') }, cx);
      const leaked = logger.entries.some((e: LogEntry) => JSON.stringify(e.data).includes('SUPER_SECRET_PROMPT_BODY'));
      expect(leaked).toBe(false);
   });
});

describe('Group 14 — governance logging', () => {
   it('[H] an ask logs one decision entry and one outcome entry sharing ids', async () => {
      const { logger, sessionId } = await runTurn([editReport]);
      const decisions = eventsOf(logger, 'governance_decision');
      const outcomes  = eventsOf(logger, 'governance_outcome');
      expect(decisions).toHaveLength(1);
      expect(outcomes).toHaveLength(1);
      expect(decisions[0].data).toMatchObject({ action: 'ask', kind: 'edit', sessionId });
      expect(outcomes[0].data).toMatchObject({
         action: 'approve', answeredBy: 'user', sessionId, callId: decisions[0].data.callId,
      });
   });

   it('a rule-decided report logs a decision entry and no outcome entry', async () => {
      const { logger } = await runTurn([readReport], { rules: [{ kind: 'read', action: 'approve' }] });
      expect(eventsOf(logger, 'governance_decision')).toHaveLength(1);
      expect(eventsOf(logger, 'governance_outcome')).toHaveLength(0);
   });

   it('each report gets its own callId', async () => {
      const { logger } = await runTurn([readReport, readReport], { rules: [{ kind: 'read', action: 'approve' }] });
      const ids = eventsOf(logger, 'governance_decision').map(e => e.data.callId);
      expect(new Set(ids).size).toBe(2);
   });

   it.each(denials)('[H] ask, then %s: the outcome entry records it', async (_name, makeCx, expected) => {
      const { logger } = await runTurn([editReport], { cx: makeCx() });
      const outcomes = eventsOf(logger, 'governance_outcome');
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].data).toMatchObject(expected);
   });

   it('[H] secrets in the diff, raw request, title or IDE errors stay out of every entry', async () => {
      const report: ToolCallReport = {
         kind: 'edit', title: 'SECRET-TITLE', paths: ['/repo/a.ts'], diff: 'SECRET-DIFF',
         rawInput: { token: 'SECRET-RAW' },
      };
      for (const [, makeCx] of denials) {
         const { logger } = await runTurn([report], { cx: makeCx() });
         expect(JSON.stringify(logger.entries)).not.toContain('SECRET');
      }
   });
});
