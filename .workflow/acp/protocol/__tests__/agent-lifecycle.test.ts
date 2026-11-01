import { describe, it, expect } from 'vitest';
import { PROTOCOL_VERSION, createCx, createDriverSpy, makeAgent, newSessionArgs, textParam } from './agent.helpers.js';

// Group 1: Lifecycle -------------------------------------------------------

describe('Group 1 — connection & session lifecycle', () => {
   it('initialize returns the supported protocol version', async () => {
      const { agent } = makeAgent();
      const res = await agent.initialize({ protocolVersion: PROTOCOL_VERSION });
      expect(res.protocolVersion).toBe(PROTOCOL_VERSION);
   });

   it('newSession before initialize is rejected', async () => {
      const { agent } = makeAgent({ init: false });
      await expect(agent.newSession(newSessionArgs())).rejects.toThrow(/initialize/i);
   });

   it('prompt before initialize is rejected and does not call execute', async () => {
      const { agent, driver } = makeAgent({ init: false });
      const cx = createCx();
      await expect(
         agent.prompt({ sessionId: 'sess-x', ...textParam('q') }, cx),
      ).rejects.toThrow(/initialize/i);
      expect(driver.seen).toHaveLength(0);
   });

   it('session/new returns a sessionId and maps it to a workflowId', async () => {
      const { agent, sessionStore } = makeAgent();
      const res = await agent.newSession(newSessionArgs());
      expect(typeof res.sessionId).toBe('string');
      expect(sessionStore.get(res.sessionId)?.workflowId).toBeTruthy();
   });

   it('distinct sessions map to distinct workflows', async () => {
      const { agent, sessionStore } = makeAgent();
      const a = await agent.newSession(newSessionArgs());
      const b = await agent.newSession(newSessionArgs());
      const wa = sessionStore.get(a.sessionId)?.workflowId;
      const wb = sessionStore.get(b.sessionId)?.workflowId;
      expect(wa).not.toBe(wb);
   });

   it('session/load resumes a mapping for continuity', async () => {
      const { agent, sessionStore } = makeAgent();
      await agent.loadSession({ sessionId: 'sess-prev', workflowId: 'wf-prev' } as any);
      expect(sessionStore.get('sess-prev')?.workflowId).toBe('wf-prev');
   });

   it('disconnect releases all session mappings (no leaks)', async () => {
      const { agent, sessionStore } = makeAgent();
      const a = await agent.newSession(newSessionArgs());
      await agent.onDisconnect();
      expect(sessionStore.get(a.sessionId)).toBeUndefined();
   });
});

// Group 2: Translation seam ------------------------------------------------

describe('Group 2 — ACP <-> driver translation seam', () => {
   it('one prompt turn triggers exactly one execute call', async () => {
      const { agent, driver } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('do the thing') }, cx);
      expect(driver.seen).toHaveLength(1);
   });

   it('prompt text becomes the execute command', async () => {
      const { agent, driver } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('summarize repo') }, cx);
      expect(driver.seen[0].command).toContain('summarize repo');
   });

   it('driver text is returned as final response content', async () => {
      const driver    = createDriverSpy({ text: 'the answer', sessionId: 'drv-1' });
      const { agent } = makeAgent({ driver });
      const s   = await agent.newSession(newSessionArgs());
      const cx  = createCx();
      const res = await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx);
      const finalText = JSON.stringify(res).concat(JSON.stringify(cx.calls));
      expect(finalText).toContain('the answer');
   });

   it('driver sessionId is stored for continuity', async () => {
      const driver = createDriverSpy({ text: 'x', sessionId: 'continued-123' });
      const { agent, sessionStore } = makeAgent({ driver });
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx);
      expect(sessionStore.get(s.sessionId)?.driverSessionId).toBe('continued-123');
   });

   it('a resumed turn passes the stored driver sessionId as options.sessionId', async () => {
      const driver = createDriverSpy({ text: 'x', sessionId: 'drv-2' });
      const { agent } = makeAgent({ driver });
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('first') }, cx);
      await agent.prompt({ sessionId: s.sessionId, ...textParam('second') }, cx);
      expect(driver.seen[1].options.sessionId).toBe('drv-2');
   });

   it('omitted optionals stay undefined (never empty strings)', async () => {
      const { agent, driver } = makeAgent();
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx);
      expect(driver.seen[0].options.sessionId).toBeUndefined();
   });
});

// Group 3: Streaming update-before-final -----------------------------------

describe('Group 3 — streaming', () => {
   it('[H] a turn with no text and no tool calls sends no update', async () => {
      const driver = createDriverSpy({ text: '', sessionId: 'drv-1', toolCalls: [] });
      const { agent } = makeAgent({ driver });
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      const res = await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx);
      expect(cx.calls).toEqual([]);
      expect(res.stopReason).toBe('end_turn');
   });

   it('a mid-turn error is surfaced as a thrown error (no hang)', async () => {
      const driver = createDriverSpy(() => { throw new Error('boom'); });
      const { agent } = makeAgent({ driver });
      const s  = await agent.newSession(newSessionArgs());
      const cx = createCx();
      // The ACP stopReason enum has no 'error' value; failures surface as a
      // thrown error, which the SDK turns into a JSON-RPC error response.
      await expect(
         agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, cx),
      ).rejects.toThrow(/boom/);
   });
});
