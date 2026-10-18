import { vi } from 'vitest';
import { createAcpDriver } from '../acp-driver.js';
import type { AcpPolicy, LaunchSpec } from '../types.js';
import { createFakeAcpAgent } from './fake-acp-agent.js';

export type FakeAgent = ReturnType<typeof createFakeAcpAgent>;

export const LAUNCH = { command: 'agent-cli', args: ['acp', '--flag'] };

export function createLogger() {
   return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Fake agents, and a connect that hands them out in order, after `delayConnect(index)` if given. */
export function fakeAgents(count = 1, delayConnect?: (index: number) => Promise<void> | undefined) {
   const agents: FakeAgent[] = Array.from({ length: count }, (_, i) => createFakeAcpAgent({ pid: 4000 + i }));
   let next = 0;
   const connect = vi.fn(async (_spec: LaunchSpec) => {
      const index = next++;
      await delayConnect?.(index);
      return agents[index].handle;
   });
   return { agents, connect };
}

/** A core driver over fake agents. */
export function makeDriver(
   count = 1, delayConnect?: (index: number) => Promise<void> | undefined, policy?: AcpPolicy,
) {
   const { agents, connect } = fakeAgents(count, delayConnect);
   const logger = createLogger();
   const driver = createAcpDriver({ name: 'test', connect, launch: LAUNCH, policy, logger });
   return { driver, agents, connect, logger };
}

/** Params of every message the client sent with this method. */
export const sent = (agent: FakeAgent, method: string): any[] =>
   agent.received.filter((m: any) => method === m.method).map((m: any) => m.params);

export function deferred<T = void>() {
   let resolve!: (value: T) => void;
   const promise = new Promise<T>(res => { resolve = res; });
   return { promise, resolve };
}

/** Lets already-settled promises react, without timers. */
export async function flush() {
   for (let i = 0; i < 20; i++) { await Promise.resolve(); }
}
