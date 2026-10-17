import { defineError } from '../../shared/errors.js';

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
