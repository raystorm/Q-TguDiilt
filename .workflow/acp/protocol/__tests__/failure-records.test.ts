import { describe, expect, it, vi } from 'vitest';
import { createAcpDriver } from '../../drivers/acp-driver-core/acp-driver.js';
import {
   DIAGNOSTICS_PATH, LAUNCH, createDiagnostics, fakeAgents, sent,
} from '../../drivers/acp-driver-core/__tests__/acp-driver.helpers.js';
import { NEVER } from '../../drivers/acp-driver-core/__tests__/fake-acp-agent.js';
import { SESSION } from '../../drivers/acp-driver-core/__tests__/failures.helpers.js';
import { createCx, createLogger, makeAgent, newSessionArgs, textParam } from './agent.helpers.js';

/** The protocol agent over a real driver core and a fake downstream agent. */
async function protocolOverFake() {
   const { agents, connect } = fakeAgents(1);
   const logger      = createLogger();
   const diagnostics = createDiagnostics();
   const driver      = createAcpDriver({ name: 'test', connect, launch: LAUNCH, logger, diagnostics });
   const made        = makeAgent({ driver, logger });
   const { sessionId } = await made.agent.newSession(newSessionArgs());
   const cx          = createCx();
   const prompt      = (text: string) => made.agent.prompt({ sessionId, ...textParam(text) }, cx);
   const events      = (name: string) => logger.entries.filter(e => name === e.event).map(e => e.data);
   return { downstream: agents[0], diagnostics, sessionId, prompt, events };
}

describe('a failure seen through the protocol agent', () => {
   it('[H] a failure after a completed turn joins through the IDE session and the pid', async () => {
      const t = await protocolOverFake();
      await t.prompt('one');
      t.downstream.respond('session/prompt', () => NEVER);
      const second = t.prompt('two').then(() => undefined, (err: Error) => err);
      await vi.waitFor(() => expect(sent(t.downstream, 'session/prompt')).toHaveLength(2));
      t.downstream.exit(1);
      await second;
      const [record] = t.diagnostics.records;
      expect(t.events('agent_session_linked'))
         .toEqual([{ sessionId: t.sessionId, agentSessionId: SESSION }]);
      expect(record.agentSessionId).toBe(SESSION);
      expect(t.events('agent_process_ended'))
         .toMatchObject([{ pid: record.pid, agentSessionId: SESSION }]);
   });

   it('the error the IDE gets ends with the line', async () => {
      const t = await protocolOverFake();
      t.downstream.respond('session/prompt', () => NEVER);
      const failure = t.prompt('go').then(() => undefined, (err: Error) => err);
      await vi.waitFor(() => expect(sent(t.downstream, 'session/prompt')).toHaveLength(1));
      t.downstream.exit(1);
      const error = await failure;
      expect(error?.message.split('\n').pop()).toBe(`full record: ${DIAGNOSTICS_PATH}`);
   });
});
