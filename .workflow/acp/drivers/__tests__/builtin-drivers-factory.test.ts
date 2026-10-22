import { describe, it, expect, vi } from 'vitest';
import { createLogger } from '../../protocol/__tests__/agent.helpers.js';
import { spawnAgent } from '../acp-driver-core/connect.js';
import { createDriver as createCopilot } from '../copilot-driver-acp.js';
import { declaresToolCallGovernance } from '../governed-driver.js';
import { createDriver as createKiro } from '../kiro-driver-acp.js';

vi.mock('../acp-driver-core/connect.js', async importOriginal => ({
   ...(await importOriginal<typeof import('../acp-driver-core/connect.js')>()),
   spawnAgent: vi.fn(),
}));

describe.each([['kiro', createKiro], ['copilot', createCopilot]])('%s createDriver', (name, create) => {
   it('builds a governed driver named for its registry key without starting a process', () => {
      const driver = create({ logger: createLogger() });
      expect(driver.name).toBe(name);
      expect(declaresToolCallGovernance(driver)).toBe(true);
      expect(spawnAgent).not.toHaveBeenCalled();
   });
});
