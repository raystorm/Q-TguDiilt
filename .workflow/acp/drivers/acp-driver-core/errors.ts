import { RequestError } from '@agentclientprotocol/sdk';
import { ProviderAuthError } from '../../protocol/errors.js';
import { defineError } from '../../shared/errors.js';
import { redact } from '../../shared/redact.js';
import { TAIL_HEADER, withTail } from './stderr-tail.js';
import type { AgentExit } from './types.js';

/** The agent does not offer the model the dispatcher resolved for this driver. */
export const ModelUnavailableError = defineError(
   'ModelUnavailableError',
   (model: string) => ({
      message: `the agent does not offer the model "${model}"; ` +
         'check that the model name in the driver registry matches the agent',
   }),
);

/** A setup step did not answer in time, so the agent was ended. */
export const AgentSetupTimeoutError = defineError(
   'AgentSetupTimeoutError',
   (step: string, timeoutMs: number) => ({
      message: `the agent did not answer ${step} within ${timeoutMs / 1000} s; ` +
         'check that it starts and that you are logged in',
   }),
);
export type AgentSetupTimeoutError = InstanceType<typeof AgentSetupTimeoutError>;

/** The agent did not answer a cancel in time, so it was ended. */
export const AgentCancelTimeoutError = defineError(
   'AgentCancelTimeoutError',
   (timeoutMs: number) => ({
      message: `the agent did not answer the cancel within ${timeoutMs / 1000} s; it was ended`,
   }),
);

/** The command that starts the agent does not exist. */
export const AgentNotFoundError = defineError(
   'AgentNotFoundError',
   (command: string) => ({
      message: `cannot start "${command}": the command was not found; install it or fix PATH`,
   }),
);
export type AgentNotFoundError = InstanceType<typeof AgentNotFoundError>;

/** The agent could not be started for another reason. */
export const AgentLaunchError = defineError(
   'AgentLaunchError',
   (command: string, reason: string) => ({ message: `cannot start "${command}": ${redact(reason)}` }),
);
export type AgentLaunchError = InstanceType<typeof AgentLaunchError>;

/** The agent exited when nobody asked it to. `tail` is its redacted last output. */
export const AgentExitedError = defineError(
   'AgentExitedError',
   (exit: AgentExit, tail: string) => {
      const how = null !== exit.code ? `exit code ${exit.code}` : `signal ${exit.signal}`;
      return { message: withTail(`the agent exited unexpectedly (${how})`, tail) };
   },
);
export type AgentExitedError = InstanceType<typeof AgentExitedError>;

/** The agent answered a request with an error. */
export const AgentRequestError = defineError(
   'AgentRequestError',
   (method: string, reason: string, tail: string) => ({
      message: withTail(`the agent failed on ${method}: ${redact(reason)}`, tail),
   }),
);
export type AgentRequestError = InstanceType<typeof AgentRequestError>;

/** The agent answered in a way the protocol does not allow. */
export const AgentProtocolError = defineError(
   'AgentProtocolError',
   (summary: string, tail: string) => ({ message: withTail(summary, tail) }),
);
export type AgentProtocolError = InstanceType<typeof AgentProtocolError>;

/** The driver refused the agent after looking at what it reports. The message is the driver's own. */
export const AgentRefusedError = defineError(
   'AgentRefusedError',
   (reason: string) => ({ message: reason }),
);
export type AgentRefusedError = InstanceType<typeof AgentRefusedError>;

type ProviderAuth = InstanceType<typeof ProviderAuthError>;

/** The JSON-RPC code ACP gives to "authentication required". */
const AUTH_REQUIRED_CODE = -32000;

/** What Kiro prints when it has no login. */
const NOT_LOGGED_IN = /not logged in/i;

const messageOf = (err: unknown) => err instanceof Error ? err.message : String(err);

/** The agent needs a login, which only its own login command can give. The core never logs in. */
function loginRequired(tail: string): ProviderAuth {
   return new ProviderAuthError(withTail(
      'the agent is not logged in; log in with the agent\'s own login command, then try again', tail));
}

/** What a failure to start the agent is. */
export function launchFailure(
   command: string, err: unknown,
): AgentSetupTimeoutError | AgentNotFoundError | AgentLaunchError {
   if (err instanceof AgentSetupTimeoutError) { return err; }
   if ('ENOENT' === (err as { code?: unknown } | null)?.code) { return new AgentNotFoundError(command); }
   return new AgentLaunchError(command, messageOf(err));
}

/** What an exit nobody asked for is: a missing login, or an exit. */
export function exitFailure(exit: AgentExit, tail: string): AgentExitedError | ProviderAuth {
   return NOT_LOGGED_IN.test(tail) ? loginRequired(tail) : new AgentExitedError(exit, tail);
}

/** What an error answer is: authentication required, or a failed request. */
export function requestFailure(method: string, err: unknown, tail: string): AgentRequestError | ProviderAuth {
   if (err instanceof RequestError && AUTH_REQUIRED_CODE === err.code) { return loginRequired(tail); }
   return new AgentRequestError(method, messageOf(err), tail);
}

/** What kind of failure a record is. Each kind agrees with the error the user gets. */
export const AGENT_FAILURE_KIND = {
   exited:           'exited',
   protocol:         'protocol',
   requestError:     'requestError',
   authRequired:     'authRequired',
   setupTimeout:     'setupTimeout',
   notStarted:       'notStarted',
   refused:          'refused',
   modelUnavailable: 'modelUnavailable',
   handlerFailed:    'handlerFailed',
   cancelTimeout:    'cancelTimeout',
} as const;
export type AgentFailureKind = typeof AGENT_FAILURE_KIND[keyof typeof AGENT_FAILURE_KIND];

const KIND_OF: Array<[abstract new (...args: any[]) => Error, AgentFailureKind]> = [
   [AgentExitedError,        AGENT_FAILURE_KIND.exited],
   [AgentProtocolError,      AGENT_FAILURE_KIND.protocol],
   [AgentRequestError,       AGENT_FAILURE_KIND.requestError],
   [ProviderAuthError,       AGENT_FAILURE_KIND.authRequired],
   [AgentSetupTimeoutError,  AGENT_FAILURE_KIND.setupTimeout],
   [AgentNotFoundError,      AGENT_FAILURE_KIND.notStarted],
   [AgentLaunchError,        AGENT_FAILURE_KIND.notStarted],
   [AgentRefusedError,       AGENT_FAILURE_KIND.refused],
   [ModelUnavailableError,   AGENT_FAILURE_KIND.modelUnavailable],
   [AgentCancelTimeoutError, AGENT_FAILURE_KIND.cancelTimeout],
];

/** The kind of a failure, by its error class; undefined for any other error. */
export function failureKind(err: unknown): AgentFailureKind | undefined {
   return KIND_OF.find(([type]) => err instanceof type)?.[1];
}

/** The part of an error message before the agent's output: what a record calls its message. */
export function summaryOf(message: string): string {
   const at = message.indexOf(`\n${TAIL_HEADER}\n`);
   return -1 === at ? message : message.slice(0, at);
}

/** The errors whose message ends with the line that names the diagnostic log. */
const WITH_RECORD_LINE = [
   AgentExitedError, AgentRequestError, AgentProtocolError, ProviderAuthError,
   AgentSetupTimeoutError, AgentNotFoundError, AgentLaunchError,
];

/** Ends the message with `full record: <path>`, for the errors that have it. */
export function withRecordLine(err: unknown, path: string): void {
   if (err instanceof Error && WITH_RECORD_LINE.some(type => err instanceof type)) {
      err.message = `${err.message}\nfull record: ${path}`;
   }
}
