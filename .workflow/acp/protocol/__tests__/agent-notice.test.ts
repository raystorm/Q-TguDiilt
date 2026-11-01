import { describe, it, expect } from 'vitest';
import { TurnInProgressError } from '../errors.js';
import {
   type Cx, createCx, createDriverSpy, createHeldDriver, makeAgent, newSessionArgs,
   oneDriverCatalog, startTurn, textParam,
} from './agent.helpers.js';

const NOTICE = 'NOTICE-MARKER the preferred driver cannot be used';
const RESULT = 'RESULT-MARKER';

type Agent = ReturnType<typeof makeAgent>['agent'];

const messages = (cx: Cx) => cx.calls.filter(call =>
   'session/update' === call.method && 'agent_message_chunk' === call.params.update.sessionUpdate);

const textsOf   = (cx: Cx) => messages(cx).map(call => call.params.update.content.text as string);
const noticesIn = (cx: Cx) => textsOf(cx).filter(text => text.includes(NOTICE)).length;

/** An agent over one driver; the catalog has a notice when one is given. */
function agentWith(notice?: string, driver = createDriverSpy({ text: RESULT, sessionId: 'drv-1' }))
{ return makeAgent({ driver, catalog: oneDriverCatalog(driver, notice) }); }

async function replyOn(agent: Agent, sessionId: string): Promise<Cx>
{
   const cx = createCx();
   await agent.prompt({ sessionId, ...textParam('go') }, cx);
   return cx;
}

async function firstReply(agent: Agent): Promise<Cx>
{ return replyOn(agent, (await agent.newSession(newSessionArgs())).sessionId); }

describe('the notice in the first reply', () => {
   it('the first reply of a new session starts with the notice, then the usual updates', async () => {
      const texts = textsOf(await firstReply(agentWith(NOTICE).agent));
      const plain = textsOf(await firstReply(agentWith().agent));
      expect(texts[0]).toContain(NOTICE);
      expect(texts.slice(1)).toEqual(plain);
   });

   it('without a notice the reply is the result only', async () => {
      const texts = textsOf(await firstReply(agentWith().agent));
      expect(texts).toEqual([RESULT]);
   });

   it('after a turn ends normally the notice is never sent again', async () => {
      const { agent } = agentWith(NOTICE);
      const { sessionId } = await agent.newSession(newSessionArgs());
      expect(noticesIn(await replyOn(agent, sessionId))).toBe(1);
      expect(noticesIn(await replyOn(agent, sessionId))).toBe(0);
      expect(noticesIn(await replyOn(agent, sessionId))).toBe(0);
   });

   it('every session gets it once', async () => {
      const { agent } = agentWith(NOTICE);
      expect(noticesIn(await firstReply(agent))).toBe(1);
      expect(noticesIn(await firstReply(agent))).toBe(1);
   });

   it('a reopened chat gets it too, once', async () => {
      const { agent } = agentWith(NOTICE);
      await agent.loadSession({ sessionId: 'sess-prev', workflowId: 'wf-prev' });
      expect(textsOf(await replyOn(agent, 'sess-prev'))[0]).toContain(NOTICE);
      expect(noticesIn(await replyOn(agent, 'sess-prev'))).toBe(0);
   });

   it('a cancelled first turn does not count: the next turn carries it again', async () => {
      const held = createHeldDriver();
      const { agent } = agentWith(NOTICE, held.driver);
      const { sessionId } = await agent.newSession(newSessionArgs());
      const first = createCx();
      const turn  = agent.prompt({ sessionId, ...textParam('go') }, first);
      await held.started(0);
      await agent.cancel({ sessionId });
      held.release(0, { cancelled: true, text: '', sessionId: '', toolCalls: [] });
      await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
      expect(noticesIn(first)).toBe(1);
      const second = createCx();
      const next   = agent.prompt({ sessionId, ...textParam('again') }, second);
      await held.started(1);
      held.release(1);
      await next;
      expect(noticesIn(second)).toBe(1);
   });

   it('a prompt rejected before its turn starts sends nothing and does not use the notice', async () => {
      const held = createHeldDriver();
      const { agent } = agentWith(NOTICE, held.driver);
      const { sessionId } = await agent.newSession(newSessionArgs());
      const [empty, ghost, busy, first] = [createCx(), createCx(), createCx(), createCx()];
      await expect(agent.prompt({ sessionId, ...textParam('') }, empty)).rejects.toThrow();
      await expect(agent.prompt({ sessionId: 'ghost', ...textParam('q') }, ghost)).rejects.toThrow();
      const turn = agent.prompt({ sessionId, ...textParam('go') }, first);
      await held.started(0);
      await expect(agent.prompt({ sessionId, ...textParam('more') }, busy))
         .rejects.toBeInstanceOf(TurnInProgressError);
      held.release(0);
      await turn;
      expect([empty.calls, ghost.calls, busy.calls]).toEqual([[], [], []]);
      expect(noticesIn(first)).toBe(1);
   });

   it('cancelled, failed, abnormal ends, then normal: sent on each but not after', async () => {
      let n = 0;
      const ENDS = ['output_limit', 'request_limit', 'refused'];
      const driver = createDriverSpy(() => {
         const call = n++;
         if (1 === call) { throw new Error('boom'); }
         if (0 === call) { return { cancelled: true, text: '', sessionId: '', toolCalls: [] }; }
         const end = ENDS[call - 2];
         return {
            text: RESULT, sessionId: 'drv-1', toolCalls: [], ...(undefined === end ? {} : { end }),
         };
      });
      const { agent } = agentWith(NOTICE, driver);
      const { sessionId } = await agent.newSession(newSessionArgs());
      const sent: number[] = [];
      for (let turn = 0; turn < 7; turn++) {
         const cx = createCx();
         await agent.prompt({ sessionId, ...textParam('go') }, cx).catch(() => undefined);
         sent.push(noticesIn(cx));
      }
      expect(sent).toEqual([1, 1, 1, 1, 1, 1, 0]);
   });

   it('two sessions in flight at once each get it once, on their own session', async () => {
      const held = createHeldDriver();
      const { agent } = agentWith(NOTICE, held.driver);
      const [cxA, cxB] = [createCx(), createCx()];
      const a = await startTurn(agent, cxA);
      await held.started(0);
      const b = await startTurn(agent, cxB);
      await held.started(1);
      const targets = (cx: Cx) => messages(cx)
         .filter(call => call.params.update.content.text.includes(NOTICE))
         .map(call => call.params.sessionId);
      expect(targets(cxA)).toEqual([a.sessionId]);
      expect(targets(cxB)).toEqual([b.sessionId]);
      held.release(0);
      held.release(1);
      await Promise.all([a.turn, b.turn]);
   });
});
