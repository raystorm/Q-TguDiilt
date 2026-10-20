import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { fakeAgents } from '../../drivers/acp-client/__tests__/acp-driver.helpers.js';
import { scriptFor } from '../../drivers/acp-client/__tests__/permissions.helpers.js';
import { createCopilotAcpDriver } from '../../drivers/copilot-driver-acp.js';
import { createGovernanceEngine } from '../../governance/engine.js';
import {
   allow, createCx, createLogger, deferred, makeAgent, newSessionArgs, requestsOf, textParam,
} from './agent.helpers.js';

const ACP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The options Copilot offers with every permission request (recorded, copilot 1.0.95). */
const COPILOT_OPTIONS = [
   { optionId: 'allow_once',   name: 'Allow',        kind: 'allow_once' },
   { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
   { optionId: 'reject_once',  name: 'Reject',       kind: 'reject_once' },
];

const outcomesSent = (agent: { received: any[] }) =>
   agent.received.filter(message => !('method' in message)).map(message => message.result?.outcome);

describe('governance in front of the Copilot driver', () => {
   it('[H] the shipped config approves, denies and asks as ruled, '
      + 'and nothing is allowed before the IDE answers', async () => {
      const { agents, connect } = fakeAgents(1);
      const agent = agents[0];
      const logger     = createLogger();
      const governance = createGovernanceEngine({ configPath: join(ACP_ROOT, 'governance', 'config.yaml'), logger });
      const driver     = createCopilotAcpDriver({ connect, logger });
      const ide        = deferred<{ outcome: typeof allow }>();
      const cx         = createCx({ respond: () => ide.promise });

      const script = scriptFor(agent, []);
      agent.respond('session/prompt', async () => {
         for (const [id, command] of [['c1', 'ls -la'], ['c2', 'git checkout main'], ['c3', 'touch x']]) {
            // Copilot's title is a description, not the command; the command is in the request's rawInput.
            await script.call({
               toolCallId: id, kind: 'execute', title: 'Run a shell command', status: 'pending', rawInput: { command },
            });
            await script.ask({
               toolCallId: id, kind: 'execute', status: 'pending', title: 'Run a shell command',
               rawInput: { command, commands: [command] },
            }, COPILOT_OPTIONS);
         }
         return { stopReason: 'end_turn' };
      });

      const made = makeAgent({ driver, logger, governance });
      const s    = await made.agent.newSession(newSessionArgs());
      const turn = made.agent.prompt({ sessionId: s.sessionId, ...textParam('go') }, cx);

      await vi.waitFor(() => expect(requestsOf(cx)).toHaveLength(1));
      expect(outcomesSent(agent)).toEqual([
         { outcome: 'selected', optionId: 'allow_once' },
         { outcome: 'selected', optionId: 'reject_once' },
      ]);

      ide.resolve({ outcome: allow });
      await turn;
      expect(outcomesSent(agent)).toEqual([
         { outcome: 'selected', optionId: 'allow_once' },
         { outcome: 'selected', optionId: 'reject_once' },
         { outcome: 'selected', optionId: 'allow_once' },
      ]);
      expect(requestsOf(cx)).toHaveLength(1);
      const closing = driver.close();
      agent.exit(0);
      await closing;
   });
});
