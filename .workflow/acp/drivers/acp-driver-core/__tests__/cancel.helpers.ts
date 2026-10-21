import type { Driver, ExecuteOptions } from '../../governed-driver.js';
import { type FakeAgent, makeDriver } from './acp-driver.helpers.js';
import { ALLOW, REJECT, SESSION } from './failures.helpers.js';

/** The agent sends a chunk of message text. */
export const say = (agent: FakeAgent, text: string) => agent.notify('session/update', {
   sessionId: SESSION,
   update:    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
});

/** The agent asks permission for a tool call; resolves with the client's response. */
export const askFor = (agent: FakeAgent, toolCallId: string, id?: string) =>
   agent.request('session/request_permission', {
      sessionId: SESSION, toolCall: { toolCallId, title: toolCallId, kind: 'execute' }, options: [ALLOW, REJECT],
   }, id);

/**
 * Starts a turn whose prompt the agent holds, with a signal the test controls.
 * `finish` and `fail` answer the held prompt.
 */
export async function abortableTurn(options: ExecuteOptions = {}, count = 1, command = 'go') {
   const made       = makeDriver(count);
   const agent      = made.agents[0];
   const controller = new AbortController();
   let release!: (result: unknown) => void;
   let reject!:  (err: unknown) => void;
   agent.respond('session/prompt', () => new Promise((resolve, rej) => { release = resolve; reject = rej; }));
   const turn = made.driver.execute(command, { ...options, signal: controller.signal });
   await agent.arrived('session/prompt');
   return {
      ...made, agent, controller, turn,
      finish: (result: unknown) => release(result),
      fail:   (err: unknown) => reject(err),
   };
}

/** Ends the driver and lets every fake agent exit, so nothing is left running. */
export async function wrapUp({ driver, agents }: { driver: Driver; agents: FakeAgent[] }) {
   const closing = driver.close();
   agents.forEach(agent => agent.exit(0));
   await closing;
}
