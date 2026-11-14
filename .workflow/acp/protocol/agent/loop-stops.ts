/**
 * Why the automated changeover process stops, what a prompt and its loop share, and the chat
 * lines the loop shows. No I/O.
 */
import type { BlockStopReason } from '../completion-block.js';
import { HANDOFF_PATH, MESSAGE_PATH } from '../workflow-command.js';

/**
 * Why the automated changeover process stopped. The first four come from the completion block;
 * `status_not_confirmed` means the status file did not say what the step needs. A side trip moves
 * only by a send, so a handoff in it stops with `handoff_in_trip`.
 */
export type LoopStop =
   | BlockStopReason | 'handoff_not_written' | 'message_not_written' | 'handoff_in_trip'
   | 'status_not_confirmed' | 'abnormal_end' | 'failed' | 'cancelled';

/**
 * What a prompt and its loop share: whether the service sent a command, whether a send failed,
 * how many profile changes the loop made, and why it stopped (`failed` until it says otherwise).
 */
export interface LoopState {
   moved: boolean; deliveryFailed: boolean; profileHop: number; stop: LoopStop; word?: string;
}

/** A chat line of its own: it never joins the text before or after it. */
export const paragraph = (text: string) => `\n\n${text}\n\n`;

/** The line that announces a command the service sends. */
export const changeoverLine = (command: string) => paragraph(`Changeover: sending \`${command}\``);

const ENTER_COMMAND = 'Enter the command you want, for example `@handoff to=<Profile>`.';

/**
 * The chat line that says why the loop stopped, or undefined when the stop has none. The word
 * (an unknown profile) is shown as the agent wrote it, capped at 64 characters. A failure or an
 * abnormal end shows a line only when the service sent a command in this prompt: an ordinary
 * prompt keeps its own end line.
 */
export function stopLine(reason: LoopStop, word: string | undefined, moved: boolean): string | undefined
{
   switch (reason) {
      case 'several_suggestions':
         return 'Several next steps are suggested above. Enter the one you want, '
            + 'for example `@handoff to=<Profile>`.';
      case 'no_target':
         return `The agent's next step names no profile to hand off to. ${ENTER_COMMAND}`;
      case 'unknown_profile': {
         const shown = (word ?? '').slice(0, 64).replace(/\r\n|\r|\n/g, ' ');
         return `"${shown}" is not a known profile. ${ENTER_COMMAND}`;
      }
      case 'handoff_not_written':
         return 'The handoff file was not written for this turn, or it names a different profile '
            + `(${HANDOFF_PATH}).`;
      case 'message_not_written':
         return 'The message file was not written for this turn, or it names a different profile '
            + `(${MESSAGE_PATH}).`;
      case 'handoff_in_trip':
         return 'A side trip moves only by a send. Enter the command you want, '
            + 'for example `@send to=<Profile>`.';
      case 'abnormal_end':
      case 'failed':
         return moved ? 'Automatic changeover stopped.' : undefined;
      default:
         return undefined;
   }
}
