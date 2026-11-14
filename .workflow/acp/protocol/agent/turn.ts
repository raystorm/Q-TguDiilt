/**
 * One turn of a session: the notice, one `execute` of the driver, the text it streams and the tool
 * calls it reports. Everything a turn sends goes through the prompt's sink.
 */
import { Driver, DriverResult, ExecuteOptions } from '../../drivers/governed-driver.js';
import { Logger } from '../../shared/logger.js';
import type { StopReason } from '@agentclientprotocol/sdk';
import { boundaryErrorKind } from '../errors.js';
import { ABNORMAL_END_EVENT, END_LINE, END_STOP_REASON, abnormalEnd } from '../turn-end.js';
import { createCards } from '../cards.js';
import { UpdateSink } from '../update-sink.js';
import { SessionRecord } from '../session-store.js';
import type { ClientContext } from './index.js';
import type { ToolCalls } from './tool-calls.js';

/** An `agent_message_chunk` update carrying `text`. */
export const textUpdate = (text: string) => ({
   sessionUpdate: 'agent_message_chunk',
   content:       { type: 'text', text },
});

/** What the boundary needs to run one turn. The counter of turns lives here. */
export function createTurnRunner(
   { logger, handleToolCall, denyAfterTurn }:
      { logger: Logger } & Pick<ToolCalls, 'handleToolCall' | 'denyAfterTurn'>,
) {
   let turnSeq = 0;

   /**
    * Keeps the driver's session id for the IDE session. A new or changed id is
    * logged once, as the join between the two ids.
    */
   function linkDriverSession(record: SessionRecord, sessionId: string, driverSessionId: string): void {
      const changed = driverSessionId !== record.driverSessionId;
      record.driverSessionId = driverSessionId;
      if (changed && '' !== driverSessionId) {
         logger.info('agent_session_linked', { sessionId, agentSessionId: driverSessionId });
      }
   }

   /**
    * One turn: the notice, one `execute`, and the text the driver did not stream. Everything
    * it sends goes through the prompt's sink. Returns the ACP stop reason and the agent's text
    * of the turn, in order (not the notice, not the end line). Once the driver has returned or
    * thrown, what it still reports through this turn's callbacks is ignored.
    */
   async function runTurn(turn: {
      sessionId: string; record: SessionRecord; driver: Driver; command: string;
      signal: AbortSignal; sink: UpdateSink; cx: ClientContext;
   }): Promise<{ stopReason: StopReason; text: string }> {
      const { sessionId, record, driver, command, signal, sink, cx } = turn;
      // Card state lives for this turn only.
      const cards = createCards(++turnSeq);
      // Until a turn of this session ends normally, its turns lead with the notice.
      if (undefined !== record.notice) { void sink.send(textUpdate(record.notice)); }

      let sawText = false;
      let said    = '';
      let live    = true;
      const options: ExecuteOptions = {
         signal,
         model:      record.model,
         onToolCall: report => live
            ? handleToolCall(sessionId, report, cx, signal, sink, cards)
            : denyAfterTurn(sessionId),
         onUpdate:   update => {
            if (!live) { return; }
            if ('text' !== update.type) { void sink.send(cards.render(update)); return; }
            sawText = true;
            said   += update.text;
            void sink.send(textUpdate(update.text));
         },
      };
      if (record.driverSessionId) { options.sessionId = record.driverSessionId; }

      // A driver that did not stream sends its text now, once; streamed text is never repeated.
      const sendUnstreamed = (text: string) => {
         if (!sawText && '' !== text) { void sink.send(textUpdate(text)); }
      };

      let result: DriverResult;
      try { result = await driver.execute(command, options); }
      catch (err) {
         if (!signal.aborted) { throw err; }
         // A failure after a cancel is part of the cancel: log the kind only.
         logger.info('turn_cancelled', {
            sessionId, failureKind: boundaryErrorKind(err) ?? 'internal',
         });
         return { stopReason: 'cancelled' as const, text: said };
      }
      finally { live = false; }

      const text = sawText ? said : result.text;

      // An abnormal end is logged whether or not the turn was cancelled; a cancel wins.
      const abnormal = abnormalEnd(result.end);
      if (undefined !== abnormal) { logger.info(ABNORMAL_END_EVENT, { sessionId, end: abnormal }); }

      if (result.cancelled || signal.aborted) {
         if ('' !== result.sessionId) { linkDriverSession(record, sessionId, result.sessionId); }
         sendUnstreamed(result.text);
         logger.info('turn_cancelled', { sessionId });
         return { stopReason: 'cancelled' as const, text };
      }

      linkDriverSession(record, sessionId, result.sessionId);
      sendUnstreamed(result.text);
      // The line follows the turn's text. An abnormal end is not a normal end: the notice stays.
      if (undefined !== abnormal) {
         void sink.send(textUpdate(END_LINE[abnormal]));
         return { stopReason: END_STOP_REASON[abnormal], text };
      }
      record.notice = undefined;
      return { stopReason: 'end_turn' as const, text };
   }

   return runTurn;
}

export type TurnRunner = ReturnType<typeof createTurnRunner>;
