/**
 * The Copilot driver: the shared ACP driver core, launched as `copilot --acp --stdio`.
 * Everything that is specific to Copilot is in this file: the launch command line
 * and the two settings that make it run tools without asking. The core has no Copilot code.
 */
import type { Logger } from '../shared/logger.js';
import { createAcpDriver } from './acp-driver-core/acp-driver.js';
import { spawnAgent } from './acp-driver-core/connect.js';
import type { Connect, UnsafeSetting } from './acp-driver-core/types.js';
import type { Driver } from './governed-driver.js';

/** The Copilot CLI executable, found on PATH. */
export const COPILOT_COMMAND = 'copilot';

/**
 * ACP over stdio and nothing else. Never a flag that pre-approves tool calls
 * (`--allow-all`, `--allow-tool`, `--yolo`) or limits them (`--available-tools`,
 * `--excluded-tools`): the agent must ask, so that governance sees every call.
 */
export const COPILOT_ARGS: readonly string[] = ['--acp', '--stdio'];

const SESSION_MODES = 'https://agentclientprotocol.com/protocol/session-modes';

/**
 * The settings under which Copilot runs tools without asking this service. A
 * session that starts with one on is refused; one switched on later is warned
 * about. `autopilot` is a session mode, named by URL or bare.
 */
const UNSAFE_SETTINGS: readonly UnsafeSetting[] = [
   { name: 'allow_all', optionId: 'allow_all', values: ['on'] },
   { name: 'autopilot', optionId: 'mode',      values: [`${SESSION_MODES}#autopilot`, 'autopilot'] },
];

/** What the Copilot driver needs from its caller: where to log, and optionally how to start the process. */
export interface CopilotDriverDeps {
   /** Starts the `copilot` process. A real child process unless a test passes a fake. */
   connect?: Connect;
   logger:  Logger;
}

/** A governed driver over `copilot` as an ACP server. Its name is `copilot`. */
export function createCopilotAcpDriver({ connect = spawnAgent, logger }: CopilotDriverDeps): Driver {
   return createAcpDriver({
      name:           'copilot',
      connect,
      launch:         { command: COPILOT_COMMAND, args: COPILOT_ARGS },
      unsafeSettings: UNSAFE_SETTINGS,
      logger,
   });
}

/** The registry's entry point: the Copilot driver, built from the logger alone. */
export function createDriver({ logger }: { logger: Logger }): Driver
{ return createCopilotAcpDriver({ logger }); }
