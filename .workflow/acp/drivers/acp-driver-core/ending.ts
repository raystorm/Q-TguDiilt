import type { AgentHandle } from './types.js';

export const ENDING_TERM_DELAY_MS = 1000;
export const ENDING_KILL_DELAY_MS = 3000;
export const ENDING_EXIT_WAIT_MS  = 1000;

/** The last stage the ending sequence reached. */
export type EndStage = 'none' | 'stdin_closed' | 'sigterm' | 'sigkill';

const sequences = new WeakMap<AgentHandle, Promise<EndStage>>();

/** True if the agent exits within `ms`; leaves no timer behind either way. */
export function exitsWithin(handle: AgentHandle, ms: number): Promise<boolean> {
   return new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), ms);
      void handle.exited.then(() => { clearTimeout(timer); resolve(true); });
   });
}

async function runSequence(handle: AgentHandle): Promise<EndStage> {
   if (handle.hasExited()) { return 'none'; }
   handle.closeStdin();
   if (await exitsWithin(handle, ENDING_TERM_DELAY_MS)) { return 'stdin_closed'; }
   handle.killGroup('SIGTERM');
   if (await exitsWithin(handle, ENDING_KILL_DELAY_MS)) { return 'sigterm'; }
   handle.killGroup('SIGKILL');
   await exitsWithin(handle, ENDING_EXIT_WAIT_MS);
   return 'sigkill';
}

/**
 * Ends the agent: close stdin, SIGTERM the process group after
 * ENDING_TERM_DELAY_MS, SIGKILL it ENDING_KILL_DELAY_MS later, each step only
 * if the agent is still running. After SIGKILL it waits up to
 * ENDING_EXIT_WAIT_MS for the exit, then gives up; the caller can check
 * `handle.hasExited()`. Runs once per handle; every caller gets the same
 * outcome.
 */
export function endAgent(handle: AgentHandle): Promise<EndStage> {
   let sequence = sequences.get(handle);
   if (undefined === sequence) {
      sequence = runSequence(handle);
      sequences.set(handle, sequence);
   }
   return sequence;
}
