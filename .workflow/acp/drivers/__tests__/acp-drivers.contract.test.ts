import { describe } from 'vitest';
import { createAcpDriver } from '../acp-driver-core/acp-driver.js';
import { createCopilotAcpDriver } from '../copilot-driver-acp.js';
import { createKiroAcpDriver } from '../kiro-driver-acp.js';
import { createAcpHarness } from './acp-contract-harness.js';
import { describeGovernedDriverContract } from './governed-driver.contract.js';

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
