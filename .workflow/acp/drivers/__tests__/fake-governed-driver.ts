import {
   Driver,
   ToolCallOutcome,
   ToolCallReport,
   gateToolCall,
   validateExecuteArgs,
} from '../governed-driver.js';

/**
 * Fake governed driver for the contract suite. For each scripted report it
 * asks gateToolCall, and "runs" the call (records it) only on 'approve'.
 */
export function createFakeGovernedDriver() {
   let scripted: ToolCallReport[] = [];
   const ranReports: ToolCallReport[] = [];
   const events: string[] = [];

   const driver: Driver = {
      name:                       'fake',
      supportsToolCallGovernance: true,
      async execute(command, options = {}) {
         validateExecuteArgs(command, options);
         const toolCalls: ToolCallOutcome[] = [];
         const reports = scripted;
         scripted = [];
         for (const report of reports) {
            events.push(`gate:${report.title}`);
            const decision = await gateToolCall(options, report);
            toolCalls.push({ report, decision });
            if ('approve' === decision) {
               events.push(`run:${report.title}`);
               ranReports.push(report);
            }
         }
         return { text: 'done', sessionId: 'fake-sess', toolCalls };
      },
   };

   return {
      driver,
      events,
      script: (reports: ToolCallReport[]) => { scripted = reports; },
      ran:    () => [...ranReports],
   };
}
