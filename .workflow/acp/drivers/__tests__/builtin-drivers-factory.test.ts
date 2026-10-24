import { beforeEach, describe, it, expect, vi } from 'vitest';
import { createLogger } from '../../protocol/__tests__/agent.helpers.js';
import { createDiagnostics } from '../acp-driver-core/__tests__/acp-driver.helpers.js';
import { failureOf } from '../acp-driver-core/__tests__/failures.helpers.js';
import { spawnAgent } from '../acp-driver-core/connect.js';
import { AGENT_FAILURE_KIND, AgentNotFoundError } from '../acp-driver-core/errors.js';
import { createDriver as createCopilot } from '../copilot-driver-acp.js';
import { declaresToolCallGovernance } from '../governed-driver.js';
import { createDriver as createKiro } from '../kiro-driver-acp.js';

vi.mock('../acp-driver-core/connect.js', async importOriginal => ({
   ...(await importOriginal<typeof import('../acp-driver-core/connect.js')>()),
   spawnAgent: vi.fn(),
}));

beforeEach(() => { vi.mocked(spawnAgent).mockReset(); });

describe.each([['kiro', createKiro], ['copilot', createCopilot]])('%s createDriver', (name, create) => {
   it('builds a governed driver named for its registry key without starting a process', () => {
      const driver = create({ logger: createLogger(), diagnostics: createDiagnostics() });
      expect(driver.name).toBe(name);
      expect(declaresToolCallGovernance(driver)).toBe(true);
      expect(spawnAgent).not.toHaveBeenCalled();
   });

   it('[H] passes the diagnostics to the core: a launch failure is recorded under its name',
      async () => {
         const missing = Object.assign(new Error('spawn agent-cli ENOENT'), { code: 'ENOENT' });
         vi.mocked(spawnAgent).mockRejectedValue(missing);
         const diagnostics = createDiagnostics();
         const driver      = create({ logger: createLogger(), diagnostics });
         const error       = await failureOf(driver.execute('go'));
         expect(error).toBeInstanceOf(AgentNotFoundError);
         expect(diagnostics.records).toHaveLength(1);
         expect(diagnostics.records[0])
            .toMatchObject({ kind: AGENT_FAILURE_KIND.notStarted, driver: name });
         expect(error?.message).toContain(`full record: ${diagnostics.path}`);
      });
});
