/**
 * The Kiro driver: the shared ACP-client core, launched as Kiro's V3 ACP
 * server. Everything that is specific to Kiro is in this file: the launch
 * command line and the check that the server is V3. The core has no Kiro code.
 */
import type { InitializeResponse } from '@agentclientprotocol/sdk';
import type { Logger } from '../shared/logger.js';
import { createAcpDriver } from './acp-client/acp-driver.js';
import { spawnAgent } from './acp-client/connect.js';
import type { AcpPolicy, Connect } from './acp-client/types.js';
import type { Driver } from './governed-driver.js';

/** The Kiro CLI executable, found on PATH. */
export const KIRO_COMMAND = 'kiro-cli';

/**
 * V3 server, and the CLI's own login, so that the agent never asks this client for
 * a token. Never a flag that pre-approves tool calls (`--trust-all-tools`,
 * `--trust-tools`): the agent must ask, so that governance sees every call.
 */
export const KIRO_ARGS: readonly string[] = ['acp', '--agent-engine=v3', '--auth-method=cli'];

/** Tested with this version. Not a requirement. */
const KIRO_TESTED_VERSION = '2.22.0';

const V3_REQUIRED =
   'kiro-cli did not report the V3 ACP server, which this service requires. ' +
   `Update kiro-cli to a version that supports "${KIRO_COMMAND} ${KIRO_ARGS.join(' ')}" ` +
   `(tested with ${KIRO_TESTED_VERSION}), then try again.`;

/**
 * Kiro's V3 server lists its extension methods and a session list capability in the
 * `initialize` answer; the legacy server has neither. The version numbers are no
 * help: both generations report protocol version 1.
 */
export function verifyKiroV3(response: InitializeResponse): string | undefined {
   const capabilities = response.agentCapabilities;
   const kiro         = capabilities?._meta?.kiro as { extensionMethods?: unknown } | null | undefined;
   const list         = capabilities?.sessionCapabilities?.list;
   const hasMethods   = Array.isArray(kiro?.extensionMethods);
   const hasList      = 'object' === typeof list && null !== list;
   return hasMethods && hasList ? undefined : V3_REQUIRED;
}

/** What this driver checks on the agent: that it is the V3 server, before any session is created. */
export const kiroPolicy: AcpPolicy = { verifyInitialize: verifyKiroV3 };

/** What the Kiro driver needs from its caller: where to log, and optionally how to start the process. */
export interface KiroDriverDeps {
   /** Starts the `kiro-cli` process. A real child process unless a test passes a fake. */
   connect?: Connect;
   logger:  Logger;
}

/** A governed driver over `kiro-cli` as Kiro's V3 ACP server. Its name is `kiro`. */
export function createKiroAcpDriver({ connect = spawnAgent, logger }: KiroDriverDeps): Driver {
   return createAcpDriver({
      name:   'kiro',
      connect,
      launch: { command: KIRO_COMMAND, args: KIRO_ARGS },
      policy: kiroPolicy,
      logger,
   });
}
