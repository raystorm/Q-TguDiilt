import type { AnyMessage, AnyRequest, AnyResponse, Stream } from '@agentclientprotocol/sdk';
import type { AgentExit, AgentHandle, EndSignal } from '../types.js';

/** A responder returns this to leave a request unanswered. */
export const NEVER = Symbol('never');

/** Gets the request params; may return a promise. A throw answers with an error (its numeric `code`, if it has one). */
type Responder = (params: any, request: AnyRequest) => unknown;

export interface KillRecord {
   pid:       number;
   signal:    EndSignal;
   /** `Date.now()` at the call, so it follows the fake clock. */
   at:        number;
   afterExit: boolean;
}

const isRequest = (m: AnyMessage): m is AnyRequest => 'method' in m && 'id' in m;
const isReply   = (m: AnyMessage): m is AnyResponse => !('method' in m);

const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR   = -32603;

/**
 * In-memory ACP agent and its process handle. It speaks raw JSON-RPC over
 * the stream, so a test can hold, delay, fail or never answer any request,
 * send any notification or request, and read every message the client sent.
 */
export function createFakeAcpAgent({ pid = 4242 }: { pid?: number } = {}) {
   const toAgent  = new TransformStream<AnyMessage, AnyMessage>();
   const toClient = new TransformStream<AnyMessage, AnyMessage>();
   const writer   = toClient.writable.getWriter();
   const reader   = toAgent.readable.getReader();

   const received:  AnyMessage[] = [];
   const kills:     KillRecord[] = [];
   const responders = new Map<string, Responder>([
      ['initialize',     () => ({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] })],
      ['session/new',    () => ({ sessionId: 'agent-sess-1' })],
      ['session/prompt', () => ({ stopReason: 'end_turn' })],
   ]);
   const waiting = new Map<string | number | null, (response: AnyResponse) => void>();

   let nextId      = 1;
   let stdinCloses = 0;
   let exitInfo: AgentExit | undefined;
   let resolveExit!: (exit: AgentExit) => void;
   const exited = new Promise<AgentExit>(resolve => { resolveExit = resolve; });

   const heard:     string[] = [];
   const listeners: Array<(text: string) => void> = [];
   const watchers:  Array<(message: AnyMessage) => void> = [];

   const send = (message: object) => writer.write(message as AnyMessage).catch(() => {});

   async function answer(request: AnyRequest) {
      const responder = responders.get(request.method);
      if (undefined === responder) {
         await send({
            jsonrpc: '2.0', id: request.id,
            error: { code: METHOD_NOT_FOUND, message: `method not found: ${request.method}` },
         });
         return;
      }
      try {
         const result = await responder(request.params, request);
         if (NEVER === result) { return; }
         await send({ jsonrpc: '2.0', id: request.id, result });
      }
      catch (err) {
         const message = err instanceof Error ? err.message : String(err);
         const code    = 'number' === typeof (err as { code?: unknown } | null)?.code
            ? (err as { code: number }).code : INTERNAL_ERROR;
         await send({ jsonrpc: '2.0', id: request.id, error: { code, message } });
      }
   }

   void (async () => {
      for (;;) {
         const { done, value } = await reader.read();
         if (done) { return; }
         received.push(value);
         watchers.forEach(watch => watch(value));
         if (isRequest(value)) { void answer(value); }
         else if (isReply(value)) { waiting.get(value.id)?.(value); waiting.delete(value.id); }
      }
   })();

   const stream: Stream = { writable: toAgent.writable, readable: toClient.readable };

   const handle: AgentHandle = {
      pid,
      stream,
      exited,
      onStderr: listener => { listeners.push(listener); heard.forEach(text => listener(text)); },
      closeStdin: () => { stdinCloses += 1; },
      hasExited:  () => undefined !== exitInfo,
      killGroup: signal => {
         kills.push({ pid, signal, at: Date.now(), afterExit: undefined !== exitInfo });
      },
   };

   return {
      handle,
      received,
      kills,
      get stdinCloses() { return stdinCloses; },
      get stdinClosed() { return 0 < stdinCloses; },
      /** Method names of everything the client sent, in order. */
      methods: () => received.filter(m => 'method' in m).map(m => (m as AnyRequest).method),
      /** Resolves once the client has sent this method (at once if it already has). */
      arrived: (method: string) => new Promise<void>(resolve => {
         const is = (m: AnyMessage) => method === (m as AnyRequest).method;
         if (received.some(is)) { resolve(); return; }
         watchers.push(m => { if (is(m)) { resolve(); } });
      }),
      /** Sends a message to the client exactly as given. */
      raw: (message: object) => send(message),
      /** The agent's stdout ends while the process keeps running. */
      endOutput: () => { void writer.close().catch(() => {}); },
      respond: (method: string, responder: Responder) => { responders.set(method, responder); },
      notify:  (method: string, params: unknown) => send({ jsonrpc: '2.0', method, params }),
      /** Sends a request to the client; resolves with its response. */
      request: (method: string, params: unknown, id: string | number = `agent-${nextId++}`) => {
         const reply = new Promise<AnyResponse>(resolve => { waiting.set(id, resolve); });
         void send({ jsonrpc: '2.0', id, method, params });
         return reply;
      },
      stderr: (text: string) => { heard.push(text); listeners.forEach(listener => listener(text)); },
      /** The process ends: `exited` resolves and the client's stream ends. */
      exit: (code: number | null, signal: string | null = null) => {
         if (undefined !== exitInfo) { return; }
         exitInfo = { code, signal };
         resolveExit(exitInfo);
         void writer.close().catch(() => {});
      },
   };
}
