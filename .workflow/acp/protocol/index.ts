#!/usr/bin/env node
/**
 * ACP Service Boundary entry point.
 *
 * Assembles the ACP SDK stdio transport, the translation agent, and the real
 * Kiro driver, then serves an ACP client (e.g. a JetBrains IDE launching this
 * as a subprocess via ~/.jetbrains/acp.json). The SDK owns JSON-RPC framing,
 * method dispatch, version negotiation, and unknown-method handling; this file
 * only wires our handlers to it.
 */
import { Readable, Writable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { agent, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { createKiroDriver, Cli, CliResult } from '../drivers/kiro-driver.js';
import { createAgent } from './agent.js';
import { createSessionStore } from './session-store.js';
import { createFileLogger } from '../shared/logger.js';

// Operational log lives with workflow runtime state, mirroring workflow.log.
// Cleanup at workflow completion is handled by the engine, not this process.
const logger = createFileLogger({
   filePath: join(process.cwd(), '.workflow', 'work', 'acp.log'),
});

/** Real Kiro CLI adapter (mirrors the driver integration test). */
function createRealCli(): Cli {
   return {
      run(args: string[]): CliResult {
         const output   = execFileSync('kiro-cli', args, { encoding: 'utf8' });
         const lines    = output.trim().split('\n').filter(Boolean);
         const finished = lines.map(l => JSON.parse(l)).find(e => 'runFinished' === e.type);
         return {
            finalText: finished?.data?.finalText ?? '',
            sessionId: finished?.data?.sessionId ?? '',
         };
      },
   };
}

function newWorkflowId(): string {
   return `wf-acp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const driver       = createKiroDriver(createRealCli());
const sessionStore = createSessionStore({ newWorkflowId });
const service      = createAgent({
   driver,
   sessionStore,
   logger,
   protocolVersion: PROTOCOL_VERSION,
});

const output = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
const input  = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
const stream = ndJsonStream(output, input);

agent({ name: 'q-tguudiilt-acp' })
   .onRequest(methods.agent.initialize,   ctx => service.initialize(ctx.params as any))
   .onRequest(methods.agent.session.new,  ctx => service.newSession(ctx.params as any))
   .onRequest(methods.agent.session.load, ctx => service.loadSession(ctx.params as any))
   .onRequest(methods.agent.session.prompt, ctx => service.prompt(ctx.params as any, ctx.client as any))
   .onNotification(methods.agent.session.cancel, ctx => service.cancel(ctx.params as any))
   .connect(stream);

process.stdin.on('end', () => service.onDisconnect());
