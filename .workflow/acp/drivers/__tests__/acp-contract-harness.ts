/**
 * Turns the contract suite's `script(reports)` and `stream(steps)` into ACP traffic, so the suite
 * can run against a real driver over fake agents. Not product code.
 */
import { createLogger, fakeAgents, type FakeAgent } from '../acp-driver-core/__tests__/acp-driver.helpers.js';
import type { Connect } from '../acp-driver-core/types.js';
import type { Logger } from '../../shared/logger.js';
import type { Driver, ToolCallReport } from '../governed-driver.js';
import type { GovernedDriverHarness, StreamStep } from './governed-driver.contract.js';

/** The session id of the nth fake agent. The first keeps the id every fake agent answers with. */
const sessionOf = (index: number) => `agent-sess-${index + 1}`;

/** The index of the agent that serves a `sessionOf` id; undefined for any other id. */
function agentOf(sessionId: string): number | undefined {
   const match = /^agent-sess-(\d+)$/.exec(sessionId);
   return null === match ? undefined : Number(match[1]) - 1;
}

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
   /** The script of the next turn each agent serves, by agent index. A turn takes it. */
   const scripts: StreamStep[][] = agents.map(() => []);
   /** How many agents the driver has launched: the next fresh turn is served by this one. */
   let launched = 0;
   const allowed: ToolCallReport[] = [];
   let next: StreamStep[] = [];
   /** Index of the agent that served the latest turn. */
   let latest = 0;

   agents.forEach((agent, index) => {
      prepare?.(agent);
      const session = sessionOf(index);
      if (0 < index) { agent.respond('session/new', () => ({ sessionId: session })); }
      // A real agent exits when its input ends.
      const closeStdin = agent.handle.closeStdin;
      agent.handle.closeStdin = () => { closeStdin(); agent.exit(0); };
      agent.respond('session/prompt', async () => {
         const cancelled = agent.arrived('session/cancel').then(() => 'cancelled' as const);
         const steps = scripts[index];
         scripts[index] = [];
         for (const step of steps) {
            if ('say' === step.type) {
               await agent.notify('session/update', { sessionId: session, update: chunk(step.text) });
               continue;
            }
            const { id, report } = step;
            await agent.notify('session/update', { sessionId: session, update: streamCall(id, report) });
            if (true !== step.gate) { continue; }
            const asked = agent.request('session/request_permission', {
               sessionId: session, toolCall: { toolCallId: id, title: report.title }, options: OPTIONS,
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
         // A call that is aborted at entry is served by no agent, so it takes no script.
         if (true !== options?.signal?.aborted) {
            const requested = options?.sessionId;
            const served    = undefined === requested ? launched++ : agentOf(requested);
            if (undefined !== served && served < agents.length) {
               scripts[served] = next;
               latest          = served;
            }
         }
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
      lateChunk: () => agents[latest].notify(
         'session/update', { sessionId: sessionOf(latest), update: chunk('late') },
      ),
      ran:       () => [...allowed],
      released:  () => agents.filter(agent => agent.stdinClosed).length,
      project,
   };
}
