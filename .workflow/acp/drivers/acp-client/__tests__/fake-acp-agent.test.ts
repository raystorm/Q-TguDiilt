import { describe, it, expect, afterEach, vi } from 'vitest';
import { client, methods, type InitializeRequest, type NewSessionRequest } from '@agentclientprotocol/sdk';
import { NEVER, createFakeAcpAgent } from './fake-acp-agent.js';

afterEach(() => { vi.useRealTimers(); });

/** Lets already-settled promises react, without timers. */
async function flush() {
   for (let i = 0; i < 20; i++) { await Promise.resolve(); }
}

function connectClient(agent: ReturnType<typeof createFakeAcpAgent>) {
   const updates: unknown[] = [];
   const connection = client({ name: 'test-client' })
      .onRequest(methods.client.session.requestPermission, () => ({ outcome: { outcome: 'cancelled' as const } }))
      .onNotification(methods.client.session.update, ({ params }) => { updates.push(params); })
      .connect(agent.handle.stream);
   return { connection: connection.agent, updates };
}

const setup:   InitializeRequest = { protocolVersion: 1, clientCapabilities: {} };
const newArgs: NewSessionRequest = { cwd: '/work', mcpServers: [] };

describe('fake ACP agent', () => {
   it('answers the setup by default and records every inbound message in order', async () => {
      const agent = createFakeAcpAgent();
      const { connection } = connectClient(agent);
      const init    = await connection.request(methods.agent.initialize, setup);
      const session = await connection.request(methods.agent.session.new, newArgs);
      const turn    = await connection.request(methods.agent.session.prompt, {
         sessionId: session.sessionId, prompt: [{ type: 'text', text: 'hi' }],
      });
      expect(init.protocolVersion).toBe(1);
      expect(session.sessionId).toBe('agent-sess-1');
      expect(turn.stopReason).toBe('end_turn');
      expect(agent.methods()).toEqual(['initialize', 'session/new', 'session/prompt']);
   });

   it('a scripted responder replaces the default', async () => {
      const agent = createFakeAcpAgent();
      agent.respond('session/new', () => ({ sessionId: 'custom' }));
      const { connection } = connectClient(agent);
      expect((await connection.request(methods.agent.session.new, newArgs)).sessionId).toBe('custom');
   });

   it('NEVER leaves a request unanswered', async () => {
      const agent = createFakeAcpAgent();
      agent.respond('initialize', () => NEVER);
      const { connection } = connectClient(agent);
      let settled = false;
      void connection.request(methods.agent.initialize, setup).then(() => { settled = true; }, () => { settled = true; });
      await flush();
      expect(agent.methods()).toEqual(['initialize']);
      expect(settled).toBe(false);
   });

   it('a responder that throws answers with an error', async () => {
      const agent = createFakeAcpAgent();
      agent.respond('session/new', () => { throw new Error('boom'); });
      const { connection } = connectClient(agent);
      await expect(connection.request(methods.agent.session.new, newArgs)).rejects.toBeDefined();
   });

   it('a responder that throws an error with a numeric code answers with that code', async () => {
      const agent = createFakeAcpAgent();
      agent.respond('session/new', () => { throw Object.assign(new Error('Authentication required'), { code: -32000 }); });
      const { connection } = connectClient(agent);
      await expect(connection.request(methods.agent.session.new, newArgs)).rejects.toMatchObject({ code: -32000 });
   });

   it('an unknown method gets a method-not-found error', async () => {
      const agent = createFakeAcpAgent();
      const { connection } = connectClient(agent);
      await expect(connection.request('_foo/bar', {})).rejects.toBeDefined();
   });

   it('agent notifications and requests reach the client, and its answer comes back', async () => {
      const agent = createFakeAcpAgent();
      const { updates } = connectClient(agent);
      await agent.notify('session/update', {
         sessionId: 's',
         update:    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'x' } },
      });
      await flush();
      expect(updates).toHaveLength(1);
      const response = await agent.request('session/request_permission', {
         sessionId: 's',
         toolCall:  { toolCallId: 't1' },
         options:   [{ optionId: 'a', name: 'Allow', kind: 'allow_once' }],
      });
      expect(response).toMatchObject({ result: { outcome: { outcome: 'cancelled' } } });
   });

   it('the handle records stdin close and kills against the fake clock, and replays stderr', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(5000);
      const agent = createFakeAcpAgent({ pid: 77 });
      const heard: string[] = [];
      agent.stderr('first');
      agent.handle.onStderr(text => heard.push(text));
      agent.stderr('second');
      agent.handle.closeStdin();
      agent.handle.killGroup('SIGTERM');
      agent.exit(1);
      agent.handle.killGroup('SIGKILL');
      expect(heard).toEqual(['first', 'second']);
      expect(agent.stdinClosed).toBe(true);
      expect(agent.kills).toEqual([
         { pid: 77, signal: 'SIGTERM', at: 5000, afterExit: false },
         { pid: 77, signal: 'SIGKILL', at: 5000, afterExit: true },
      ]);
      await expect(agent.handle.exited).resolves.toEqual({ code: 1, signal: null });
   });

   it('exit ends the stream the client reads', async () => {
      const agent = createFakeAcpAgent();
      const reader = agent.handle.stream.readable.getReader();
      expect(agent.handle.hasExited()).toBe(false);
      agent.exit(0);
      expect(agent.handle.hasExited()).toBe(true);
      expect((await reader.read()).done).toBe(true);
   });
});
