/**
 * Turns the contract suite's `script(reports)` into ACP traffic, so the suite
 * can run against a real driver over fake agents. Not product code.
 */
import { createLogger, fakeAgents, type FakeAgent } from '../acp-client/__tests__/acp-driver.helpers.js';
import type { Connect } from '../acp-client/types.js';
import type { Logger } from '../../shared/logger.js';
import type { Driver, ToolCallReport } from '../governed-driver.js';
import type { GovernedDriverHarness } from './governed-driver.contract.js';

const SESSION = 'agent-sess-1';

/** More than any contract scenario launches: each turn without a session id starts its own agent. */
const AGENT_COUNT = 4;

/** Every edit diff is sent as this old and new text, so the expected report is known. */
const OLD_TEXT = 'a';
const NEW_TEXT = 'b';

const OPTIONS = [
   { optionId: 'allow_once',  name: 'Allow',  kind: 'allow_once' },
   { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
];

export interface AcpHarnessOptions {
   /** Builds the driver under test over this connect. */
   make:     (connect: Connect, logger: Logger) => Driver;
   /** Lets a test make each fake agent answer the way this agent does. */
   prepare?: (agent: FakeAgent) => void;
}

/** The stream's description of a scripted call. */
function streamCall(id: string, report: ToolCallReport) {
   return {
      sessionUpdate: 'tool_call', toolCallId: id, title: report.title, kind: report.kind, status: 'pending',
      ...(undefined === report.rawInput ? {} : { rawInput: report.rawInput }),
      ...(undefined === report.paths ? {} : { locations: report.paths.map(path => ({ path })) }),
      ...(undefined === report.diff ? {} : {
         content: [{ type: 'diff', path: report.paths?.[0] ?? '', oldText: OLD_TEXT, newText: NEW_TEXT }],
      }),
   };
}

/** The report a driver builds from `streamCall`: only the diff text differs from the scripted one. */
function project(report: ToolCallReport): ToolCallReport {
   if (undefined === report.diff) { return report; }
   const path = report.paths?.[0] ?? '';
   return { ...report, diff: `--- ${path}\n${OLD_TEXT}\n+++ ${path}\n${NEW_TEXT}` };
}

const allowedOnce = (answer: any) =>
   'selected' === answer?.result?.outcome?.outcome && 'allow_once' === answer?.result?.outcome?.optionId;

export function createAcpHarness({ make, prepare }: AcpHarnessOptions): GovernedDriverHarness {
   const { agents, connect } = fakeAgents(AGENT_COUNT);
   const inner = make(connect, createLogger());
   /** One script per launched agent, in launch order. */
   const scripts: ToolCallReport[][] = [];
   const allowed: ToolCallReport[]   = [];
   let next: ToolCallReport[] = [];

   agents.forEach((agent, index) => {
      prepare?.(agent);
      // A real agent exits when its input ends.
      const closeStdin = agent.handle.closeStdin;
      agent.handle.closeStdin = () => { closeStdin(); agent.exit(0); };
      agent.respond('session/prompt', async () => {
         const cancelled = agent.arrived('session/cancel').then(() => 'cancelled' as const);
         for (const [n, report] of (scripts[index] ?? []).entries()) {
            const id = `call-${n}`;
            await agent.notify('session/update', { sessionId: SESSION, update: streamCall(id, report) });
            const asked = agent.request('session/request_permission', {
               sessionId: SESSION, toolCall: { toolCallId: id, title: report.title }, options: OPTIONS,
            });
            const answer = await Promise.race([asked, cancelled]);
            if ('cancelled' === answer || 'cancelled' === (answer as any).result?.outcome?.outcome) {
               return { stopReason: 'cancelled' };
            }
            if (allowedOnce(answer)) { allowed.push(report); }
         }
         return { stopReason: 'end_turn' };
      });
   });

   const driver: Driver = {
      ...inner,
      execute: (command, options) => {
         // A call that is aborted at entry launches nothing, so it takes no script.
         if (true !== options?.signal?.aborted) { scripts.push(next); }
         next = [];
         return inner.execute(command, options);
      },
   };

   return {
      driver,
      script:   reports => { next = reports; },
      ran:      () => [...allowed],
      released: () => agents.filter(agent => agent.stdinClosed).length,
      project,
   };
}
