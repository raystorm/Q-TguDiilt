import { describe, it, expect, vi } from 'vitest';
import { createFakeGovernedDriver } from '../../drivers/__tests__/fake-governed-driver.js';
import { ProviderQuotaError } from '../errors.js';
import {
   type LogEntry, createCx, createDriverSpy, type Deferred, deferred, flush, createHeldDriver, startTurn,
   makeAgent, newSessionArgs, editReport, allow, reject, requestsOf, detailsOf, eventsOf, textParam,
} from './agent.helpers.js';

describe('Group 16 — cancel: result of a cancelled turn', () => {
   const cancelledResult = (extra: object = {}) =>
      ({ cancelled: true, text: 'partial', sessionId: 'drv-c', toolCalls: [], ...extra });

   it('[H] a cancelled result streams the partial text, returns cancelled and keeps the session usable', async () => {
      const driver = createDriverSpy(cancelledResult());
      const { agent, sessionStore } = makeAgent({ driver });
      const s   = await agent.newSession(newSessionArgs());
      const cx  = createCx();
      const res = await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx);
      expect(res).toEqual({ stopReason: 'cancelled' });
      expect(JSON.stringify(cx.calls)).toContain('partial');
      expect(sessionStore.hasActiveTurn(s.sessionId)).toBe(false);
      await agent.prompt({ sessionId: s.sessionId, ...textParam('again') }, createCx());
      expect(driver.seen).toHaveLength(2);
   });

   it('a cancelled result with no text streams nothing extra and raises no error', async () => {
      const driver = createDriverSpy(cancelledResult({ text: '' }));
      const { agent, logger } = makeAgent({ driver });
      const s   = await agent.newSession(newSessionArgs());
      const cx  = createCx();
      const res = await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx);
      const chunks = cx.calls.filter(c => 'agent_message_chunk' === c.params?.update?.sessionUpdate);
      expect(res).toEqual({ stopReason: 'cancelled' });
      expect(chunks).toHaveLength(0);
      expect(logger.entries.filter((e: LogEntry) => 'error' === e.level)).toEqual([]);
   });

   it('[H] a non-empty driver session id on a cancelled result is stored', async () => {
      const { agent, sessionStore } = makeAgent({ driver: createDriverSpy(cancelledResult()) });
      const s = await agent.newSession(newSessionArgs());
      await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, createCx());
      expect(sessionStore.get(s.sessionId)?.driverSessionId).toBe('drv-c');
   });

   it('[H] an empty driver session id keeps the previous one', async () => {
      let n = 0;
      const driver = createDriverSpy(() => 0 === n++
         ? { text: 'x', sessionId: 'drv-1', toolCalls: [] }
         : cancelledResult({ sessionId: '' }));
      const { agent, sessionStore } = makeAgent({ driver });
      const s = await agent.newSession(newSessionArgs());
      await agent.prompt({ sessionId: s.sessionId, ...textParam('first') }, createCx());
      await agent.prompt({ sessionId: s.sessionId, ...textParam('second') }, createCx());
      expect(sessionStore.get(s.sessionId)?.driverSessionId).toBe('drv-1');
   });

   it('[H] an empty id on a first cancelled turn stays undefined, so the next turn passes none', async () => {
      let n = 0;
      const driver = createDriverSpy(() => 0 === n++
         ? cancelledResult({ sessionId: '' })
         : { text: 'ok', sessionId: 'drv-n', toolCalls: [] });
      const { agent, sessionStore } = makeAgent({ driver });
      const s = await agent.newSession(newSessionArgs());
      await agent.prompt({ sessionId: s.sessionId, ...textParam('first') }, createCx());
      expect(sessionStore.get(s.sessionId)?.driverSessionId).toBeUndefined();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('second') }, createCx());
      expect(driver.seen[1].options.sessionId).toBeUndefined();
   });

   it('[H] the next turn after a cancel passes the stored id and ends normally', async () => {
      let n = 0;
      const driver = createDriverSpy(() => 0 === n++
         ? cancelledResult()
         : { text: 'ok', sessionId: 'drv-n', toolCalls: [] });
      const { agent } = makeAgent({ driver });
      const s = await agent.newSession(newSessionArgs());
      await agent.prompt({ sessionId: s.sessionId, ...textParam('first') }, createCx());
      const res = await agent.prompt({ sessionId: s.sessionId, ...textParam('second') }, createCx());
      expect(driver.seen[1].options.sessionId).toBe('drv-c');
      expect(res).toEqual({ stopReason: 'end_turn' });
   });

   it.each([
      ['a generic error', () => new Error('SECRET-ERR'),              'internal'],
      ['a quota error',   () => new ProviderQuotaError('SECRET-ERR'), 'provider_quota'],
   ])('[H] %s after the abort settles cancelled and logs only its kind', async (_name, makeError, kind) => {
      const held = createHeldDriver();
      const { agent, sessionStore, logger } = makeAgent({ driver: held.driver });
      const { sessionId, turn }             = await startTurn(agent);
      await held.started(0);
      await agent.cancel({ sessionId });
      held.fail(0, makeError());
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(sessionStore.hasActiveTurn(sessionId)).toBe(false);
      expect(eventsOf(logger, 'turn_cancelled')[0].data).toMatchObject({ sessionId, failureKind: kind });
      expect(eventsOf(logger, 'prompt_failed')).toHaveLength(0);
      expect(JSON.stringify(logger.entries)).not.toContain('SECRET');
   });

   it('without an abort the same throw still surfaces as an error', async () => {
      const err    = new ProviderQuotaError('rate limited');
      const driver = createDriverSpy(() => { throw err; });
      const { agent, logger } = makeAgent({ driver });
      const s = await agent.newSession(newSessionArgs());
      await expect(agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, createCx())).rejects.toBe(err);
      expect(eventsOf(logger, 'turn_cancelled')).toHaveLength(0);
   });

   it('[H] a normal result after an abort is still cancelled', async () => {
      const held = createHeldDriver();
      const { agent, sessionStore } = makeAgent({ driver: held.driver });
      const { sessionId, turn }     = await startTurn(agent);
      await held.started(0);
      await agent.cancel({ sessionId });
      held.release(0);
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(sessionStore.hasActiveTurn(sessionId)).toBe(false);
   });
});

describe('Group 17 — cancel with asks', () => {
   /** A cx whose approval request stays open until the test answers it. */
   function createOpenAskCx()
   {
      const asked  = deferred();
      const answer = deferred<unknown>();
      const cx     = createCx({ respond: () => { asked.resolve(); return answer.promise; } });
      return { cx, asked, answer };
   }

   it.each([
      ['the IDE answers cancelled', { outcome: 'cancelled' }],
      ['the user rejects',          reject],
      ['the user allows',           allow],
   ])('[H] cancel with an ask open, then %s: the call never runs', async (_name, inner) => {
      const fake = createFakeGovernedDriver();
      fake.script([editReport]);
      const { cx, asked, answer } = createOpenAskCx();
      const { agent, logger }     = makeAgent({ driver: fake.driver });
      const { sessionId, turn }   = await startTurn(agent, cx);
      await asked.promise;
      await agent.cancel({ sessionId });
      answer.resolve({ outcome: inner });
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      await flush();
      expect(fake.ran()).toEqual([]);
      const outcomes = eventsOf(logger, 'governance_outcome');
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].data).toMatchObject({ action: 'deny', reason: 'cancelled' });
   });

   it.each([
      ['the request fails',     (a: Deferred<unknown>) => a.reject(new Error('SECRET-ERR')), 'ask_failed'],
      ['the IDE sends nothing', (a: Deferred<unknown>) => a.resolve(undefined),              'invalid_answer'],
   ])('[H] cancel with an ask open, then %s: logged as cancelled with its cause', async (_name, settle, cause) => {
      const fake = createFakeGovernedDriver();
      fake.script([editReport]);
      const { cx, asked, answer } = createOpenAskCx();
      const { agent, logger }     = makeAgent({ driver: fake.driver });
      const { sessionId, turn }   = await startTurn(agent, cx);
      await asked.promise;
      await agent.cancel({ sessionId });
      settle(answer);
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      await flush();
      expect(fake.ran()).toEqual([]);
      const outcomes = eventsOf(logger, 'governance_outcome');
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].level).toBe('info');
      expect(outcomes[0].data)
         .toMatchObject({ action: 'deny', answeredBy: 'cancel', reason: 'cancelled', cause });
      expect(JSON.stringify(logger.entries)).not.toContain('SECRET');
   });

   it('[H] an ask nobody answers does not hold the cancel; a late answer changes nothing', async () => {
      const fake = createFakeGovernedDriver();
      fake.script([editReport]);
      const { cx, asked, answer }   = createOpenAskCx();
      const { agent, sessionStore } = makeAgent({ driver: fake.driver });
      const { sessionId, turn }     = await startTurn(agent, cx);
      await asked.promise;
      await agent.cancel({ sessionId });
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(sessionStore.hasActiveTurn(sessionId)).toBe(false);
      answer.resolve({ outcome: allow });
      await flush();
      expect(fake.ran()).toEqual([]);
   });

   it('cancel with no ask pending settles cancelled without prompting the user', async () => {
      const held = createHeldDriver();
      const cx   = createCx();
      const { agent }           = makeAgent({ driver: held.driver });
      const { sessionId, turn } = await startTurn(agent, cx);
      await held.started(0);
      await agent.cancel({ sessionId });
      held.release(0);
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(requestsOf(cx)).toHaveLength(0);
      expect(detailsOf(cx)).toHaveLength(0);
   });

   it('[H] a report that arrives after the cancel is refused without evaluation or asking', async () => {
      const started = deferred();
      const gate    = deferred();
      let answered: unknown;
      const driver = createDriverSpy(async (_command: string, options: any) => {
         started.resolve();
         await gate.promise;
         answered = await options.onToolCall(editReport);
         return { text: 'ok', sessionId: 'drv', toolCalls: [] };
      });
      const governance = { evaluateToolCall: vi.fn() };
      const cx = createCx();
      const { agent, logger }   = makeAgent({ driver, governance });
      const { sessionId, turn } = await startTurn(agent, cx);
      await started.promise;
      await agent.cancel({ sessionId });
      gate.resolve();
      await turn;
      expect(answered).toBe('deny');
      expect(governance.evaluateToolCall).not.toHaveBeenCalled();
      expect(detailsOf(cx)).toHaveLength(0);
      expect(requestsOf(cx)).toHaveLength(0);
      expect(eventsOf(logger, 'governance_outcome')[0].data)
         .toMatchObject({ sessionId, action: 'deny', reason: 'cancelled', answeredBy: 'cancel' });
   });

   it('[H] an Allow that arrives after the cancel reaches the driver as a deny', async () => {
      let answered: unknown;
      const driver = createDriverSpy(async (_command: string, options: any) => {
         answered = await options.onToolCall(editReport);
         return { text: 'ok', sessionId: 'drv', toolCalls: [] };
      });
      const { cx, asked, answer } = createOpenAskCx();
      const { agent, logger }     = makeAgent({ driver });
      const { sessionId, turn }   = await startTurn(agent, cx);
      await asked.promise;
      await agent.cancel({ sessionId });
      answer.resolve({ outcome: allow });
      await turn;
      expect(answered).toBe('deny');
      expect(eventsOf(logger, 'governance_outcome')[0].data)
         .toMatchObject({ action: 'deny', reason: 'cancelled', answeredBy: 'user' });
   });
});
