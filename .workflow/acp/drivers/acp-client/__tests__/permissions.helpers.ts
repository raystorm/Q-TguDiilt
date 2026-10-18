import type { GovernanceConfig } from '../../../governance/types.js';
import type { ToolCallDecision, ToolCallReport } from '../../governed-driver.js';
import { flush, makeDriver, type FakeAgent } from './acp-driver.helpers.js';

export const SESSION = 'agent-sess-1';

export const ALLOW  = { optionId: 'allow',  name: 'Allow',  kind: 'allow_once' };
export const REJECT = { optionId: 'reject', name: 'Reject', kind: 'reject_once' };

export const CANCELLED = { outcome: 'cancelled' };
export const picked    = (optionId: string) => ({ outcome: 'selected', optionId });

/** Governance with nothing configured: everything a report allows is approved. */
export const APPROVE_BY_DEFAULT: GovernanceConfig = { rules: [], default: 'approve' };

export type Decide = (report: ToolCallReport) => Promise<ToolCallDecision>;
export const approve: Decide = async () => 'approve';
export const deny:    Decide = async () => 'deny';

/** What the agent does during one prompt. */
export interface Script {
   agent:   FakeAgent;
   /** The reports the handler has been asked about so far. */
   reports: ToolCallReport[];
   /** Sends a `tool_call` notification. */
   call:    (fields: object) => Promise<void>;
   /** Sends a `tool_call_update` notification. */
   update:  (fields: object) => Promise<void>;
   /** Sends a permission request; resolves with the client's response. */
   ask:     (toolCall: object, options?: object[]) => Promise<any>;
}

export function scriptFor(agent: FakeAgent, reports: ToolCallReport[]): Script {
   const notify = (update: object) => agent.notify('session/update', { sessionId: SESSION, update });
   return {
      agent,
      reports,
      call:   fields => notify({ sessionUpdate: 'tool_call', title: '', ...fields }),
      update: fields => notify({ sessionUpdate: 'tool_call_update', ...fields }),
      ask:    (toolCall, options = [ALLOW, REJECT]) =>
         agent.request('session/request_permission', { sessionId: SESSION, toolCall, options }),
   };
}

/**
 * Runs one turn in which the agent does `script`. `decide` answers every request
 * the handler is asked about (null: no handler at all). Returns what the
 * handler saw and whatever the script returned.
 */
export async function runTurn(script: (s: Script) => Promise<unknown>, decide: Decide | null = approve) {
   const { driver, agents, logger } = makeDriver();
   const agent   = agents[0];
   const reports: ToolCallReport[] = [];
   let scripted: any;
   agent.respond('session/prompt', async () => {
      scripted = await script(scriptFor(agent, reports));
      await flush();
      return { stopReason: 'end_turn' };
   });
   const onToolCall = null === decide
      ? undefined
      : (report: ToolCallReport) => { reports.push(report); return decide(report); };
   const result = await driver.execute('go', undefined === onToolCall ? {} : { onToolCall });
   return { result, reports, scripted, logger, agent };
}

export const unrequested = (logger: ReturnType<typeof makeDriver>['logger']) =>
   logger.warn.mock.calls.filter(([event]) => 'governance_unrequested' === event);
