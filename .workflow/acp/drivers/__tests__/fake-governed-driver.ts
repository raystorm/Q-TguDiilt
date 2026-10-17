import {
   Driver,
   ToolCallOutcome,
   ToolCallReport,
   gateToolCall,
   validateExecuteArgs,
} from '../governed-driver.js';

const CANCELLED = Symbol('cancelled');

/** Settles with CANCELLED when the signal aborts; never settles without one. */
function whenAborted(signal?: AbortSignal): Promise<typeof CANCELLED> {
   return new Promise(resolve => {
      if (undefined === signal) { return; }
      if (signal.aborted) { resolve(CANCELLED); return; }
      signal.addEventListener('abort', () => resolve(CANCELLED), { once: true });
   });
}

/**
 * Fake governed driver for the contract suite. For each scripted report it
 * asks gateToolCall, and "runs" the call (records it) only on 'approve'.
 * It honors the abort signal: it stops asking, discards late answers, and
 * settles cancelled.
 */
export function createFakeGovernedDriver() {
   let scripted: ToolCallReport[] = [];
   const ranReports: ToolCallReport[] = [];
   const events: string[] = [];
   let releases = 0;
   let closing: Promise<void> | undefined;

   const driver: Driver = {
      name:                       'fake',
      supportsToolCallGovernance: true,
      async execute(command, options = {}) {
         validateExecuteArgs(command, options);
         const { signal } = options;
         const toolCalls: ToolCallOutcome[] = [];
         const reports = scripted;
         scripted = [];
         const cancelled = (sessionId: string) => ({ text: '', sessionId, toolCalls, cancelled: true });
         if (signal?.aborted) { return cancelled(''); }
         const aborted = whenAborted(signal);
         try {
            for (const report of reports) {
               events.push(`gate:${report.title}`);
               const decision = await Promise.race([gateToolCall(options, report), aborted]);
               // An answer that arrives after the abort is discarded.
               if (CANCELLED === decision || signal?.aborted) { return cancelled('fake-sess'); }
               toolCalls.push({ report, decision });
               if ('approve' === decision) {
                  events.push(`run:${report.title}`);
                  ranReports.push(report);
               }
            }
         }
         catch (err) {
            if (signal?.aborted) { return cancelled('fake-sess'); }
            throw err;
         }
         if (signal?.aborted) { return cancelled('fake-sess'); }
         return { text: 'done', sessionId: 'fake-sess', toolCalls };
      },
      close() {
         if (undefined === closing) { closing = (async () => { releases += 1; })(); }
         return closing;
      },
   };

   return {
      driver,
      events,
      script:   (reports: ToolCallReport[]) => { scripted = reports; },
      ran:      () => [...ranReports],
      released: () => releases,
   };
}