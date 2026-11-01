/**
 * Tool-call cards: how a turn's tool calls are shown in the chat. One instance per turn,
 * dropped when the turn ends, so no state crosses turns or chats. It maps the agent's call id
 * to the card id, builds the ACP `tool_call` (first sight of an id) or `tool_call_update`, and
 * remembers each card's last agent title and outcome, so the outcome survives a later retitle.
 * A card shows only what identifies the call (kind, title, status, paths, the command), never a
 * diff, other raw input or content.
 */
import type { ToolCallReport, TurnUpdate } from '../drivers/governed-driver.js';
import type { AskDetails } from '../shared/types.js';

/** How governance finished with a call; the title of its card ends with the phrase. */
export const OUTCOME = {
   approved:  'approved by governance',
   denied:    'denied by governance',
   allowed:   'allowed by you',
   rejected:  'rejected by you',
   cancelled: 'cancelled',
   errored:   'Approval process errored: request denied',
} as const;

export type Outcome = keyof typeof OUTCOME;

/** The outcomes that also mark the card failed. */
const FAILED: ReadonlySet<Outcome> = new Set<Outcome>(['denied', 'rejected', 'errored']);

/** The title text of a card the agent gave no title. */
const NO_TITLE = 'Tool call';

/** The title of an ask's card of its own when the specifics hold no command. */
const ASK_TITLE = 'Requested action';

type CallUpdate = Extract<TurnUpdate, { type: 'tool_call' }>;

/** What an ask sends before its request: the update that carries the specifics, and its card. */
export interface AskCard {
   update:      unknown;
   toolCallId?: string;
}

const titled = (title: string | undefined, outcome: Outcome) =>
   `${title ?? NO_TITLE} - ${OUTCOME[outcome]}`;

/** An ask's card of its own: the specifics on a pending card. Without an id when none is given. */
export function ownCard(specifics: AskDetails, toolCallId?: string) {
   return {
      sessionUpdate: 'tool_call',
      ...(undefined !== toolCallId ? { toolCallId } : {}),
      status:        'pending',
      title:         specifics.command ?? ASK_TITLE,
      rawInput:      specifics,
   };
}

export function createCards(turn: number) {
   /** Per agent call id; being in the map means the card was sent. */
   const known = new Map<string, { title?: string; outcome?: Outcome }>();
   let ownSeq = 0;
   const idOf = (id: string) => `t${turn}:${id}`;

   /** Builds the update for a driver update; only what the driver update carried is set. */
   function render(update: CallUpdate) {
      const first = !known.has(update.id);
      const entry = known.get(update.id) ?? {};
      known.set(update.id, entry);

      const fields: Record<string, unknown> = {};
      if (undefined !== update.kind) { fields.kind = update.kind; }
      if (undefined !== update.title) {
         entry.title  = update.title;
         fields.title = undefined === entry.outcome
            ? update.title : titled(update.title, entry.outcome);
      }
      if (undefined !== update.status) {
         fields.status = 'running' === update.status ? 'in_progress' : update.status;
      }
      if (undefined !== update.paths)   { fields.locations = update.paths.map(path => ({ path })); }
      if (undefined !== update.command) { fields.rawInput = { command: update.command }; }

      const base = { toolCallId: idOf(update.id), ...fields };
      return first
         ? { sessionUpdate: 'tool_call', ...base, title: fields.title ?? NO_TITLE }
         : { sessionUpdate: 'tool_call_update', ...base };
   }

   return {
      idOf,
      render,

      /** The card for a report whose id was never sent; nothing when it was. */
      announce(id: string, report: ToolCallReport) {
         if (known.has(id)) { return undefined; }
         return render({
            type: 'tool_call', id, kind: report.kind, title: report.title,
            ...(undefined !== report.paths   ? { paths: report.paths }     : {}),
            ...(undefined !== report.command ? { command: report.command } : {}),
         });
      },

      /** The one outcome update of a call: the new title, and the failure status when it failed. */
      outcome(id: string, outcome: Outcome) {
         const entry = known.get(id) ?? {};
         known.set(id, entry);
         entry.outcome = outcome;
         return {
            sessionUpdate: 'tool_call_update',
            toolCallId:    idOf(id),
            title:         titled(entry.title, outcome),
            ...(FAILED.has(outcome) ? { status: 'failed' } : {}),
         };
      },

      /**
       * What an ask sends: the specifics as an update on the call's card, or, for a call with
       * no id, a card of its own with an id the service makes.
       */
      askCard(id: string | undefined, specifics: AskDetails): AskCard {
         if (undefined !== id) {
            const toolCallId = idOf(id);
            return {
               update: { sessionUpdate: 'tool_call_update', toolCallId, rawInput: specifics },
               toolCallId,
            };
         }
         const toolCallId = `t${turn}.ask${++ownSeq}`;
         return { update: ownCard(specifics, toolCallId), toolCallId };
      },
   };
}

export type Cards = ReturnType<typeof createCards>;
