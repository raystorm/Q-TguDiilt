/**
 * Update sink: one per prompt. Every `session/update` the service sends in a prompt goes
 * through it. Sends leave in the order they were queued and each waits for the one before
 * to settle, so nothing the service writes can overtake an agent update. A failed send is
 * logged once (the failure kind only, never the error text) and drops every send after it;
 * the turn carries on.
 */
import { Logger } from '../shared/logger.js';
import { boundaryErrorKind } from './errors.js';

export const UPDATE_FAILED_EVENT = 'update_delivery_failed';

/** A place in the sink's order, taken before the update that fills it exists. */
export interface UpdateSlot {
   /** Sends in this slot's place. Resolves false when nothing was delivered. */
   send(update: unknown): Promise<boolean>;
   /** Lets the sends queued behind the slot go. Safe to call more than once. */
   release(): void;
}

export interface UpdateSink {
   /** Queues one update. Resolves true when it was delivered, false when it was not. */
   send(update: unknown): Promise<boolean>;
   /** Takes the next place in the order; later sends wait until it is released. */
   reserve(): UpdateSlot;
   /** Resolves when everything queued so far is delivered or dropped. Never rejects. */
   flush(): Promise<void>;
   /** Sends after this are ignored. */
   close(): void;
}

export interface UpdateSinkOptions {
   deliver:   (update: unknown) => Promise<void> | void;
   logger:    Logger;
   sessionId: string;
}

export function createUpdateSink({ deliver, logger, sessionId }: UpdateSinkOptions): UpdateSink {
   let tail: Promise<void> = Promise.resolve();
   let failed = false;
   let closed = false;

   /** Never rejects. The first failure is logged; every attempt after it is dropped. */
   async function attempt(update: unknown): Promise<boolean> {
      if (failed || closed) { return false; }
      try { await deliver(update); return true; }
      catch (err) {
         failed = true;
         logger.warn(UPDATE_FAILED_EVENT, {
            sessionId, failureKind: boundaryErrorKind(err) ?? 'internal',
         });
         return false;
      }
   }

   return {
      send(update) {
         const result = tail.then(() => attempt(update));
         tail = result.then(() => undefined);
         return result;
      },
      reserve() {
         let open!: () => void;
         let own = tail;
         // Later sends wait for the release, then for whatever the slot itself sent.
         tail = new Promise<void>(resolve => { open = resolve; }).then(() => own);
         return {
            send(update) {
               const result = own.then(() => attempt(update));
               own = result.then(() => undefined);
               return result;
            },
            release: () => open(),
         };
      },
      flush: () => tail,
      close() { closed = true; },
   };
}
