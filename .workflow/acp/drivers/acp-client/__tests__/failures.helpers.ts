import { vi } from 'vitest';
import { NEVER } from './fake-acp-agent.js';
import { createLogger, flush, makeDriver } from './acp-driver.helpers.js';

export const SESSION = 'agent-sess-1';

export const ALLOW  = { optionId: 'allow',  name: 'Allow',  kind: 'allow_once' };
export const REJECT = { optionId: 'reject', name: 'Reject', kind: 'reject_once' };

export const NOT_LOGGED_IN = 'You are not logged in, please log in with kiro-cli login';

export const failureOf = (turn: Promise<unknown>) => turn.then(() => undefined, (err: unknown) => err as Error);

export type Logger = ReturnType<typeof createLogger>;

/** The data of every info entry with this event name. */
export const entries = (logger: Logger, event: string) =>
   logger.info.mock.calls.filter(([name]) => event === name).map(([, data]) => data);

/** Everything the core logged, at every level, as one string. */
export const logged = (logger: Logger) =>
   JSON.stringify([logger.debug, logger.info, logger.warn, logger.error].map(fn => fn.mock.calls));

/** The agent prints `text` and exits with `code` while `initialize` is unanswered. */
export async function exitDuringInitialize(text: string, code = 1) {
   const made = makeDriver();
   const agent = made.agents[0];
   agent.respond('initialize', () => NEVER);
   const failure = failureOf(made.driver.execute('go'));
   await flush();
   agent.stderr(text);
   agent.exit(code);
   return { ...made, agent, error: await failure };
}

/** The agent answers this method with a JSON-RPC error that has this code. */
export const rpcError = (message: string, code: number) => () => { throw Object.assign(new Error(message), { code }); };

/** A connect that always fails with this error. */
export const failingConnect = (err: Error) => vi.fn().mockRejectedValue(err);
