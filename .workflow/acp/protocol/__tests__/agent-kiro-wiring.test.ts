import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { fakeAgents } from '../../drivers/acp-client/__tests__/acp-driver.helpers.js';
import { scriptFor } from '../../drivers/acp-client/__tests__/permissions.helpers.js';
import { createKiroAcpDriver } from '../../drivers/kiro-driver-acp.js';
import { createGovernanceEngine } from '../../governance/engine.js';
import {
   allow, createCx, createLogger, deferred, makeAgent, newSessionArgs, requestsOf, textParam,
} from './agent.helpers.js';

const ACP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** What Kiro's V3 server reports at initialize. */
const V3 = {
   protocolVersion: 1, authMethods: [],
   agentCapabilities: { sessionCapabilities: { list: {} }, _meta: { kiro: { extensionMethods: ['_kiro/example'] } } },
};

/** The options Kiro offers with every permission request (recorded, kiro-cli 2.22.0). */
const KIRO_OPTIONS = [
   { optionId: 'accept',        name: 'Allow',        kind: 'allow_once' },
   { optionId: 'always-accept', name: 'Always allow', kind: 'allow_always' },
   { optionId: 'reject',        name: 'Deny',         kind: 'reject_once' },
   { optionId: 'always-reject', name: 'Always deny',  kind: 'reject_always' },
];

const outcomesSent = (agent: { received: any[] }) =>
   agent.received.filter(message => !('method' in message)).map(message => message.result?.outcome);

describe('governance in front of the Kiro driver', () => {
   it('[H] the shipped config approves, denies and asks as ruled, and nothing is allowed before the IDE answers', async () => {
      const { agents, connect } = fakeAgents(1);
      const agent = agents[0];
      agent.respond('initialize', () => V3);
      const logger     = createLogger();
      const governance = createGovernanceEngine({ configPath: join(ACP_ROOT, 'governance', 'config.yaml'), logger });
      const driver     = createKiroAcpDriver({ connect, logger });
      const ide        = deferred<{ outcome: typeof allow }>();
      const cx         = createCx({ respond: () => ide.promise });

      const script = scriptFor(agent, []);
      agent.respond('session/prompt', async () => {
         for (const [id, command] of [['c1', 'ls -la'], ['c2', 'git checkout main'], ['c3', 'touch x']]) {
            await script.call({ toolCallId: id, kind: 'execute', title: command, status: 'pending', rawInput: { command } });
            await script.ask({ toolCallId: id, title: command }, KIRO_OPTIONS);
         }
         return { stopReason: 'end_turn' };
      });

      const made = makeAgent({ driver, logger, governance });
      const s    = await made.agent.newSession(newSessionArgs());
      const turn = made.agent.prompt({ sessionId: s.sessionId, ...textParam('go') }, cx);

      await vi.waitFor(() => expect(requestsOf(cx)).toHaveLength(1));
      expect(outcomesSent(agent)).toEqual([
         { outcome: 'selected', optionId: 'accept' },
         { outcome: 'selected', optionId: 'reject' },
      ]);

      ide.resolve({ outcome: allow });
      await turn;
      expect(outcomesSent(agent)).toEqual([
         { outcome: 'selected', optionId: 'accept' },
         { outcome: 'selected', optionId: 'reject' },
         { outcome: 'selected', optionId: 'accept' },
      ]);
      expect(requestsOf(cx)).toHaveLength(1);
      const closing = driver.close();
      agent.exit(0);
      await closing;
   });
});

describe('the entry point wiring', () => {
   const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      if ('node_modules' === entry.name || '__tests__' === entry.name) { return []; }
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { return sources(path); }
      return /\.(ts|mjs)$/.test(entry.name) ? [path] : [];
   });

   it('[H] the placeholder driver is gone from every source file', () => {
      const placeholder = ['un', 'wired'].join('');
      const sentence    = ['no governed driver is ', 'wired yet'].join('');
      for (const file of sources(ACP_ROOT)) {
         const text = readFileSync(file, 'utf8');
         expect(text, file).not.toContain(placeholder);
         expect(text, file).not.toContain(sentence);
      }
   });

   it('no driver is chosen by name in the entry point', () => {
      const text = readFileSync(join(ACP_ROOT, 'protocol', 'index.ts'), 'utf8');
      const imports = [...text.matchAll(/from '(\.\.\/drivers\/[^']+)'/g)].map(match => match[1]);
      expect(imports).toEqual(['../drivers/kiro-driver-acp.js']);
      expect(text).not.toMatch(/registry/i);
   });
});
