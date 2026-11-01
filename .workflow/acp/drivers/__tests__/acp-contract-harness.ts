/**
 * Turns the contract suite's `script(reports)` and `stream(steps)` into ACP traffic, so the suite
 * can run against a real driver over fake agents. Not product code.
 */
import { createLogger, fakeAgents, type FakeAgent } from '../acp-driver-core/__tests__/acp-driver.helpers.js';
import type { Connect } from '../acp-driver-core/types.js';
import type { Logger } from '../../shared/logger.js';
import type { Driver, ToolCallReport } from '../governed-driver.js';
import type { GovernedDriverHarness, StreamStep } from './governed-driver.contract.js';

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

/** The stream's chunk of agent text. */
const chunk = (text: string) => ({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });

/** The id the harness gives the nth report of a `script`. */
const idOf = (index: number) => `call-${index}`;

/** The report a driver builds from `streamCall`: it gains the call's id; the diff text differs. */
function project(report: ToolCallReport, index: number): ToolCallReport {
   const withId = { ...report, id: idOf(index) };
   if (undefined === report.diff) { return withId; }
   const path = report.paths?.[0] ?? '';
   return { ...withId, diff: `--- ${path}\n${OLD_TEXT}\n+++ ${path}\n${NEW_TEXT}` };
}

const allowedOnce = (answer: any) =>
   'selected' === answer?.result?.outcome?.outcome && 'allow_once' === answer?.result?.outcome?.optionId;

export function createAcpHarness({ make, prepare }: AcpHarnessOptions): GovernedDriverHarness {
   const { agents, connect } = fakeAgents(AGENT_COUNT);
   const inner = make(connect, createLogger());
   /** One script per launched agent, in launch order. */
   const scripts: StreamStep[][] = [];
   const allowed: ToolCallReport[] = [];
   let next: StreamStep[] = [];
   /** Index of the agent that served the latest turn. */
   let latest = 0;

   agents.forEach((agent, index) => {
      prepare?.(agent);
      // A real agent exits when its input ends.
      const closeStdin = agent.handle.closeStdin;
      agent.handle.closeStdin = () => { closeStdin(); agent.exit(0); };
      agent.respond('session/prompt', async () => {
         const cancelled = agent.arrived('session/cancel').then(() => 'cancelled' as const);
         for (const step of scripts[index] ?? []) {
            if ('say' === step.type) {
               await agent.notify('session/update', { sessionId: SESSION, update: chunk(step.text) });
               continue;
            }
            const { id, report } = step;
            await agent.notify('session/update', { sessionId: SESSION, update: streamCall(id, report) });
            if (true !== step.gate) { continue; }
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
         if (true !== options?.signal?.aborted) { scripts.push(next); latest = scripts.length - 1; }
         next = [];
         return inner.execute(command, options);
      },
   };

   return {
      driver,
      script:    reports => {
         next = reports.map((report, n): StreamStep => ({ type: 'call', id: idOf(n), report, gate: true }));
      },
      stream:    steps => { next = steps; },
      lateChunk: () => agents[latest].notify('session/update', { sessionId: SESSION, update: chunk('late') }),
      ran:       () => [...allowed],
      released:  () => agents.filter(agent => agent.stdinClosed).length,
      project,
   };
}
