#!/usr/bin/env node
/**
 * ACP Service Boundary entry point.
 *
 * Assembles the ACP SDK stdio transport, the translation agent, and a
 * placeholder driver, then serves an ACP client (e.g. a JetBrains IDE launching this
 * as a subprocess via ~/.jetbrains/acp.json). The SDK owns JSON-RPC framing,
 * method dispatch, version negotiation, and unknown-method handling; this file
 * only wires our handlers to it.
 */
import { Readable, Writable } from 'node:stream';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agent, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type { Driver } from '../drivers/governed-driver.js';
import { createAgent } from './agent.js';
import { createSessionStore } from './session-store.js';
import { createGovernanceEngine } from '../governance/engine.js';
import { createFileLogger } from '../shared/logger.js';

// Operational log lives with workflow runtime state, mirroring workflow.log.
// Cleanup at workflow completion is handled by the engine, not this process.
const logger = createFileLogger({
   filePath: join(process.cwd(), '.workflow', 'work', 'acp.log'),
});

function newWorkflowId(): string {
   return `wf-acp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// TODO: replace with a real governed driver; driver choice is not configurable yet.
const driver: Driver = {
   name:                       'unwired',
   supportsToolCallGovernance: false,
   execute: async () => { throw new Error('no governed driver is wired yet'); },
};

const sessionStore = createSessionStore({ newWorkflowId });

// Loaded at startup: a missing or malformed governance config throws here,
// before the server accepts a single request (fail closed).
const governance = createGovernanceEngine({
   configPath: fileURLToPath(new URL('../governance/config.yaml', import.meta.url)),
   logger,
});

const service      = createAgent({
   driver,
   sessionStore,
   logger,
   governance,
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

process.stdin.on('end', () => { void service.onDisconnect(); });
