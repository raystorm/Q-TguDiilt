#!/usr/bin/env node
/**
 * ACP Service Boundary entry point.
 *
 * Assembles the ACP SDK stdio transport, the translation agent and the driver
 * catalog the registry describes, then serves an ACP client (e.g. a JetBrains
 * IDE launching this as a subprocess via ~/.jetbrains/acp.json). The SDK owns
 * JSON-RPC framing, method dispatch, version negotiation, and unknown-method
 * handling; this file only wires our handlers to it.
 */
import { Readable, Writable } from 'node:stream';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agent, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { buildDriverCatalog, type DriverCatalog } from '../drivers/driver-catalog.js';
import { loadRegistryConfig, type RegistryConfig } from '../drivers/registry.js';
import { createDispatchResolver } from '../modelResolver/resolver.js';
import { createAgent } from './agent.js';
import { registryPath } from './registry-location.js';
import { createSessionStore } from './session-store.js';
import { createShutdownHandler } from './shutdown.js';
import { profilesPath } from './profiles-location.js';
import { loadProfileNames, type ProfileNames } from './workflow-command.js';
import { createGovernanceEngine } from '../governance/engine.js';
import { createDiagnosticLog } from '../shared/diagnostic-log.js';
import { createFileLogger, printErrorMessage } from '../shared/logger.js';

// Operational log lives with workflow runtime state, mirroring workflow.log.
// Cleanup at workflow completion is handled by the engine, not this process.
const workDir = join(process.cwd(), '.workflow', 'work');
const logger  = createFileLogger({ filePath: join(workDir, 'acp.log') });

// The diagnostic log sits beside it. A file that cannot be opened is logged once and never
// stops the service.
const diagnostics = createDiagnosticLog({ filePath: join(workDir, 'acp-diagnostic.log'), logger });

function newWorkflowId(): string {
   return `wf-acp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const sessionStore = createSessionStore({ newWorkflowId });

// Loaded at startup: a missing or malformed governance config throws here,
// before the server accepts a single request (fail closed).
const governance = createGovernanceEngine({
   configPath: fileURLToPath(new URL('../governance/config.yaml', import.meta.url)),
   logger,
});

// Loaded once at startup, like the governance config. A names file that is missing, cannot be
// read, or lists an alias twice stops the service here, before the registry is read.
const profilesFile = profilesPath();
let profileNames: ProfileNames;
try { profileNames = loadProfileNames(profilesFile); }
catch (err) {
   logger.error('profile_names_startup_failed', {
      filePath: profilesFile, problem: printErrorMessage(err),
   });
   throw err;
}

// Loaded once at startup, like the governance config. A missing or malformed registry, or one
// that yields no working driver, stops the service here, before it accepts a single request.
const registryFile = registryPath();
let config: RegistryConfig;
let catalog: DriverCatalog;
try {
   config  = loadRegistryConfig(registryFile);
   catalog = await buildDriverCatalog({ config, registryPath: registryFile, logger, diagnostics });
}
catch (err) {
   logger.error('registry_startup_failed', {
      filePath: registryFile, problem: printErrorMessage(err),
   });
   throw err;
}

// A `profiles:` key that is not an exact canonical name never matches a profile. The service
// still starts; the operator sees which keys to fix.
for (const key of Object.keys(config.profiles ?? {})) {
   if (!profileNames.canonical.includes(key)) { logger.warn('profile_key_unknown', { key }); }
}

// The resolver sees the registry as the catalog does: without the drivers that failed.
const resolver = createDispatchResolver({ config: catalog.resolverConfig, logger });

const service      = createAgent({
   catalog,
   resolver,
   sessionStore,
   logger,
   governance,
   profileNames,
   // Changeover files are read from the directory the service runs in, not from the log folder.
   workDir: process.cwd(),
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

const shutdown = createShutdownHandler({
   disconnect: () => service.onDisconnect(),
   exit:       code => process.exit(code),
});

// The end of the chat is the end of the connection: stdin ends, or a signal ends the service.
// Whichever comes first runs the disconnect, once.
// Windows: signal handling is best effort and untested for now.
process.stdin.on('end', shutdown);
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) { process.on(signal, shutdown); }
