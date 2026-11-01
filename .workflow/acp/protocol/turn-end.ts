/**
 * How a turn that did not complete is shown: the chat line, the IDE stop reason and the log
 * event for each of the driver's abnormal ends.
 */
import type { StopReason } from '@agentclientprotocol/sdk';
import type { TurnEnd } from '../drivers/governed-driver.js';

export const ABNORMAL_END_EVENT = 'turn_ended_abnormally';

export type AbnormalEnd = Exclude<TurnEnd, 'completed'>;

export const END_LINE: Record<AbnormalEnd, string> = {
   output_limit:  'The agent stopped because it reached its output limit; '
                  + 'the reply may be cut off.',
   request_limit: 'The agent stopped because it reached its limit on requests in one turn; '
                  + 'the work may be unfinished.',
   refused:       'The agent refused to continue this turn.',
};

export const END_STOP_REASON: Record<AbnormalEnd, StopReason> = {
   output_limit:  'max_tokens',
   request_limit: 'max_turn_requests',
   refused:       'refusal',
};

/** The abnormal end a result carries. Absent and `completed` are a normal end. */
export function abnormalEnd(end: TurnEnd | undefined): AbnormalEnd | undefined {
   return undefined !== end && Object.hasOwn(END_LINE, end) ? end as AbnormalEnd : undefined;
}
