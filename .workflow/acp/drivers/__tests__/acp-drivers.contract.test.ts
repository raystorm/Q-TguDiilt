import { describe, vi } from 'vitest';
import { createAcpDriver } from '../acp-driver-core/acp-driver.js';
import { spawnAgent } from '../acp-driver-core/connect.js';
import { createCopilotAcpDriver, createDriver as createCopilot } from '../copilot-driver-acp.js';
import { createKiroAcpDriver, createDriver as createKiro } from '../kiro-driver-acp.js';
import { createAcpHarness, type AcpHarnessOptions } from './acp-contract-harness.js';
import { describeGovernedDriverContract } from './governed-driver.contract.js';

vi.mock('../acp-driver-core/connect.js', async importOriginal => ({
   ...(await importOriginal<typeof import('../acp-driver-core/connect.js')>()),
   spawnAgent: vi.fn(),
}));

/** What Kiro's V3 server reports at initialize. */
const KIRO_V3 = {
   protocolVersion: 1, authMethods: [],
   agentCapabilities: { sessionCapabilities: { list: {} }, _meta: { kiro: { extensionMethods: ['_kiro/example'] } } },
};

describe('the real drivers pass the contract', () => {
   describeGovernedDriverContract('kiro', () => createAcpHarness({
      make:    (connect, logger) => createKiroAcpDriver({ connect, logger }),
      prepare: agent => agent.respond('initialize', () => KIRO_V3),
   }));

   describeGovernedDriverContract('copilot', () => createAcpHarness({
      make: (connect, logger) => createCopilotAcpDriver({ connect, logger }),
   }));

   // A third driver is a launch command and nothing else: no core change makes it pass.
   describeGovernedDriverContract('a third driver', () => createAcpHarness({
      make: (connect, logger) => createAcpDriver({
         name: 'toy', connect, launch: { command: 'toy-agent', args: [] },
         policy: { verifySession: () => undefined }, logger,
      }),
   }));
});

/** `createDriver` starts its agent with `spawnAgent`; the mock hands it the fake agents. */
const viaSpawnAgent = (create: typeof createKiro): AcpHarnessOptions['make'] =>
   (connect, logger) => {
      vi.mocked(spawnAgent).mockImplementation(connect);
      return create({ logger });
   };

describe('the registry entry points pass the contract', () => {
   describeGovernedDriverContract('kiro createDriver', () => createAcpHarness({
      make:    viaSpawnAgent(createKiro),
      prepare: agent => agent.respond('initialize', () => KIRO_V3),
   }));

   describeGovernedDriverContract('copilot createDriver', () => createAcpHarness({
      make: viaSpawnAgent(createCopilot),
   }));
});
