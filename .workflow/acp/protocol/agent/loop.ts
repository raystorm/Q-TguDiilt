/**
 * The automated changeover process: after every turn that ended normally, the step the workflow
 * calls for, until a stop.
 */
import { Driver } from '../../drivers/governed-driver.js';
import { join } from 'node:path';
import { Logger } from '../../shared/logger.js';
import type { StopReason } from '@agentclientprotocol/sdk';
import { UpdateSink } from '../update-sink.js';
import { parseCompletionBlock } from '../completion-block.js';
import { checkHandoff } from '../handoff-check.js';
import { StatusCheck, StatusCommand, checkStatus } from '../status-check.js';
import { LoopState, LoopStop, changeoverLine, paragraph, stopLine } from './loop-stops.js';
import {
   HANDOFF_PATH, MESSAGE_PATH, ProfileNames, STATUS_DIR, detectHandoff, detectSend,
} from '../workflow-command.js';
import { SessionRecord } from '../session-store.js';
import type { ClientContext } from './index.js';
import type { Activation } from './activation.js';
import { SideTrip, backLine, returnPrompt, sideTripLine } from './side-trip.js';
import { textUpdate } from './turn.js';
import type { TurnRunner } from './turn.js';

/** What the boundary needs to run the automated changeover process of a prompt. */
export function createLoop(
   { logger, profileNames, workDir, runTurn, applyActivation, governedDriver, sideTrip }: {
      logger: Logger; profileNames: ProfileNames; workDir: string; runTurn: TurnRunner;
      applyActivation: Activation['applyActivation']; governedDriver: Activation['governedDriver'];
      sideTrip: SideTrip;
   },
) {
   /**
    * The automated changeover process. Runs the user's command, then, after every turn that ended
    * normally, the step the workflow calls for. The last command was a handoff, typed or sent: the
    * handoff file is checked and `@start` runs in a fresh session. The last command was a send,
    * typed or sent: the message file is checked and `@receive` runs in a fresh session; from the
    * main thread the running session is parked, which opens a side trip, and inside the trip the
    * sender's session is released. Otherwise the completion block of the turn's text names the next
    * step: when the profile's status file confirms it, `@handoff to=<profile>` or `@send
    * to=<profile>` runs in the same session, or the loop stops. A side trip moves only by a send.
    * A turn in it that suggests nothing ends it when the profile's status file says it is complete:
    * the running session is released, the parked one is restored and sent the return prompt. A
    * prompt that holds both a handoff and a send stops. A cancel, an abnormal end or a failed
    * delivery stops the loop too. The signal is read after every wait. The trip is open while the
    * record's parked slot is set; the loop keeps no other state. Returns the ACP stop reason of the
    * last turn that ran, or `cancelled`.
    */
   async function runLoop(loop: {
      sessionId: string; record: SessionRecord; driver: Driver; command: string; startedAt: number;
      signal: AbortSignal; sink: UpdateSink; cx: ClientContext; state: LoopState;
   }): Promise<{ stopReason: StopReason }> {
      const { sessionId, record, signal, sink, cx, state } = loop;
      let { driver, command, startedAt } = loop;
      // Whether the last command was a handoff or a send, typed or sent, and the profile the service
      // sent it to. A prompt that holds both words is neither: it stops after its turn.
      const both = detectHandoff(command) && detectSend(command);
      let after: 'handoff' | 'send' | undefined = detectHandoff(command) ? 'handoff'
         : detectSend(command) ? 'send' : undefined;
      let sentTo: string | undefined;
      // The command about to go out, for the log; `counts` when it is a new profile change, `label`
      // the chat line that follows it.
      let sent: {
         trigger: 'handoff' | 'start' | 'send' | 'receive' | 'return'; from?: string; to?: string;
         counts: boolean; label?: string;
      };

      /** Ends the loop: shows the line for `reason`, if it has one. */
      const stop = async (reason: LoopStop, stopReason: StopReason, word?: string) => {
         state.stop = reason;
         state.word = word;
         const line = stopLine(reason, word, state.moved);
         if (undefined !== line) { await sink.send(textUpdate(paragraph(line))); }
         return { stopReason };
      };

      /**
       * Reads the status file of the running profile for `check` and logs the outcome. The prose only
       * triggers the read; the file decides. A session with no profile has no file to match.
       */
      const confirms = (check: StatusCommand, expected: string): boolean => {
         const status: StatusCheck = undefined === record.profile
            ? { outcome: 'missing' }
            : checkStatus({
               dir: join(workDir, STATUS_DIR), profile: record.profile, startedAt, names: profileNames,
               command: check, expected,
            });
         if (undefined !== status.failureCode) {
            logger.warn('status_read_failed', { sessionId, code: status.failureCode });
         }
         logger.info('status_check', {
            sessionId, ...(undefined === record.profile ? {} : { profile: record.profile }),
            check, outcome: status.outcome,
         });
         return 'confirmed' === status.outcome;
      };

      for (;;) {
         const turn = await runTurn({ sessionId, record, driver, command, signal, sink, cx });
         if ('cancelled' === turn.stopReason) { return stop('cancelled', 'cancelled'); }
         if ('end_turn' !== turn.stopReason) { return stop('abnormal_end', turn.stopReason); }
         await sink.flush();
         if (signal.aborted) { return stop('cancelled', 'cancelled'); }
         if (state.deliveryFailed) { return stop('failed', 'end_turn'); }

         if (both) { return stop('several_suggestions', 'end_turn'); }
         // A side trip is open while the main thread's session is parked.
         const trip = undefined !== record.parked;
         if (trip && 'handoff' === after) { return stop('handoff_in_trip', 'end_turn'); }

         if ('handoff' === after) {
            const file    = join(workDir, HANDOFF_PATH);
            const checked = checkHandoff({ file, startedAt, names: profileNames, expected: sentTo });
            if (!checked.ok) {
               return undefined === checked.word
                  ? stop('handoff_not_written', 'end_turn')
                  : stop('unknown_profile', 'end_turn', checked.word);
            }
            const from = record.profile;
            if (!await applyActivation(record, '@start', { fresh: true })) {
               return stop('handoff_not_written', 'end_turn');
            }
            if (signal.aborted) { return stop('cancelled', 'cancelled'); }
            driver  = governedDriver(sessionId, record);
            // A start after a handoff the user typed is that handoff's profile change.
            sent    = { trigger: 'start', from, to: record.profile, counts: undefined === sentTo };
            command = '@start';
            after   = undefined;
            sentTo  = undefined;
         }
         else if ('send' === after) {
            const file    = join(workDir, MESSAGE_PATH);
            const checked = checkHandoff({ file, startedAt, names: profileNames, expected: sentTo });
            if (!checked.ok) {
               return undefined === checked.word
                  ? stop('message_not_written', 'end_turn')
                  : stop('unknown_profile', 'end_turn', checked.word);
            }
            const from = record.profile;
            // From the main thread the running session is parked; inside the trip it is released.
            const options = trip ? { fresh: true } : { fresh: true, park: true };
            if (!await applyActivation(record, '@receive', options)) {
               return stop('message_not_written', 'end_turn');
            }
            if (signal.aborted) { return stop('cancelled', 'cancelled'); }
            driver  = governedDriver(sessionId, record);
            // A receive after a send the user typed is that send's profile change.
            sent    = {
               trigger: 'receive', from, to: record.profile, counts: undefined === sentTo,
               label:   undefined === record.profile ? undefined : sideTripLine(record.profile),
            };
            command = '@receive';
            after   = undefined;
            sentTo  = undefined;
         }
         else {
            const block = parseCompletionBlock(turn.text, profileNames);
            // In a side trip a turn with no suggestion is the end; every other stop is a stop as ever.
            const ends = trip && 'stop' === block.kind && 'no_suggestion' === block.reason;
            if ('stop' === block.kind && !ends) { return stop(block.reason, 'end_turn', block.word); }
            if ('continue' === block.kind && trip) { return stop('handoff_in_trip', 'end_turn'); }

            if ('stop' === block.kind) {
               if (!confirms('end', record.profile ?? '')) { return stop('status_not_confirmed', 'end_turn'); }
               const last = record.profile as string;
               await sideTrip.end(record);
               driver  = governedDriver(sessionId, record);
               sent    = {
                  trigger: 'return', from: last, to: record.profile, counts: true,
                  label:   undefined === record.profile ? undefined : backLine(record.profile),
               };
               command = returnPrompt(last);
            }
            else if ('send' === block.kind) {
               if (!confirms('send', block.target)) { return stop('status_not_confirmed', 'end_turn'); }
               sent    = { trigger: 'send', from: record.profile, to: block.target, counts: true };
               command = `@send to=${block.target}`;
               after   = 'send';
               sentTo  = block.target;
            }
            else {
               if (!confirms('handoff', block.target)) { return stop('status_not_confirmed', 'end_turn'); }
               sent    = { trigger: 'handoff', from: record.profile, to: block.target, counts: true };
               command = `@handoff to=${block.target}`;
               after   = 'handoff';
               sentTo  = block.target;
            }
         }
         if (!await sink.send(textUpdate(changeoverLine(command)))) { return stop('failed', 'end_turn'); }
         if (undefined !== sent.label && !await sink.send(textUpdate(paragraph(sent.label)))) {
            return stop('failed', 'end_turn');
         }
         if (signal.aborted) { return stop('cancelled', 'cancelled'); }
         state.moved = true;
         if (sent.counts) { state.profileHop += 1; }
         logger.info('changeover_sent', {
            sessionId, ...(undefined === sent.from ? {} : { from: sent.from }),
            to: sent.to, trigger: sent.trigger, profileHop: state.profileHop,
         });
         startedAt = Date.now();
      }
   }

   return runLoop;
}
