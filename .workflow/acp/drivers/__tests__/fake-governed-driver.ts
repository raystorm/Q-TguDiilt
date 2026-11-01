import {
   Driver,
   ToolCallKind,
   ToolCallOutcome,
   ToolCallReport,
   ToolCallStatus,
   TurnEnd,
   TurnUpdate,
   gateToolCall,
   validateExecuteArgs,
} from '../governed-driver.js';
import type { StreamStep } from './governed-driver.contract.js';

const CANCELLED = Symbol('cancelled');

/** Settles with CANCELLED when the signal aborts; never settles without one. */
function whenAborted(signal?: AbortSignal): Promise<typeof CANCELLED> {
   return new Promise(resolve => {
      if (undefined === signal) { return; }
      if (signal.aborted) { resolve(CANCELLED); return; }
      signal.addEventListener('abort', () => resolve(CANCELLED), { once: true });
   });
}

/** One step of a streaming script. A plain list of reports is a list of `gate` steps. */
export type FakeStep =
   | { step: 'say';    text: string }
   | {
      step: 'call'; id: string; kind?: ToolCallKind; title?: string; status?: ToolCallStatus;
      command?: string; paths?: string[];
   }
   | { step: 'update'; id: string; status?: ToolCallStatus; title?: string }
   | { step: 'gate';   report: ToolCallReport }
   | { step: 'end';    reason: TurnEnd };

type Fields<T extends FakeStep['step']> = Omit<Extract<FakeStep, { step: T }>, 'step'>;

export const say    = (text: string): FakeStep => ({ step: 'say', text });
export const call   = (fields: Fields<'call'>): FakeStep => ({ step: 'call', ...fields });
export const update = (fields: Fields<'update'>): FakeStep => ({ step: 'update', ...fields });
export const gate   = (report: ToolCallReport): FakeStep => ({ step: 'gate', report });
export const end    = (reason: TurnEnd): FakeStep => ({ step: 'end', reason });

const isStep = (item: ToolCallReport | FakeStep): item is FakeStep => 'step' in item;

/**
 * Fake governed driver for the contract suite. It plays a script in order: `say` and
 * `call` go to `onUpdate` (unless `streams` is false), a `gate` asks gateToolCall and
 * "runs" the call (records it) only on 'approve'. A plain list of reports is gates only.
 * It honors the abort signal: it stops asking, discards late answers, and
 * settles cancelled. On close it settles in-flight turns cancelled and
 * discards late answers.
 */
export function createFakeGovernedDriver(
   name = 'fake', { streams = true }: { streams?: boolean } = {},
) {
   let scripted: Array<ToolCallReport | FakeStep> = [];
   const ranReports: ToolCallReport[] = [];
   const events: string[] = [];
   let releases = 0;
   let closing: Promise<void> | undefined;
   let started  = false;
   let isClosed = false;
   let closeNow!: () => void;
   const closed = new Promise<typeof CANCELLED>(resolve => { closeNow = () => resolve(CANCELLED); });

   const driver: Driver = {
      name:                       name,
      supportsToolCallGovernance: true,
      async execute(command, options = {}) {
         validateExecuteArgs(command, options);
         const { signal } = options;
         const toolCalls: ToolCallOutcome[] = [];
         const items = scripted;
         scripted = [];
         const steps = items.map(item => isStep(item) ? item : gate(item));
         const plain = items.every(item => !isStep(item));
         const said: string[] = [];
         let ended: TurnEnd | undefined;
         const textSoFar = () => plain ? '' : said.join('');
         const cancelled = (sessionId: string) =>
            ({ text: textSoFar(), sessionId, toolCalls, cancelled: true });
         const emit = (turnUpdate: TurnUpdate) => {
            if (!streams) { return; }
            try { options.onUpdate?.(turnUpdate); }
            catch { /* a callback that throws never fails the turn */ }
         };
         if (signal?.aborted || isClosed) { return cancelled(''); }
         started = true;
         const aborted = whenAborted(signal);
         try {
            for (const item of steps) {
               if (isClosed) { return cancelled('fake-sess'); }
               if ('say' === item.step) {
                  said.push(item.text);
                  emit({ type: 'text', text: item.text });
                  continue;
               }
               if ('call' === item.step || 'update' === item.step) {
                  const { step, ...fields } = item;
                  emit({ type: 'tool_call', ...fields });
                  continue;
               }
               if ('end' === item.step) { ended = item.reason; continue; }
               const { report } = item;
               events.push(`gate:${report.title}`);
               const decision = await Promise.race([gateToolCall(options, report), aborted, closed]);
               // An answer that arrives after the abort is discarded.
               if (CANCELLED === decision || signal?.aborted || isClosed) { return cancelled('fake-sess'); }
               toolCalls.push({ report, decision });
               if ('approve' === decision) {
                  events.push(`run:${report.title}`);
                  ranReports.push(report);
               }
            }
         }
         catch (err) {
            if (signal?.aborted || isClosed) { return cancelled('fake-sess'); }
            throw err;
         }
         if (signal?.aborted || isClosed) { return cancelled('fake-sess'); }
         return {
            text: plain ? 'done' : said.join(''), sessionId: 'fake-sess', toolCalls,
            ...(undefined === ended ? {} : { end: ended }),
         };
      },
      close() {
         if (undefined === closing) {
            closing = (async () => {
               isClosed = true;
               if (started) { releases += 1; }
               closeNow();
            })();
         }
         return closing;
      },
   };

   return {
      driver,
      events,
      script:   (items: Array<ToolCallReport | FakeStep>) => { scripted = items; },
      stream:   (streamed: StreamStep[]) => {
         scripted = streamed.flatMap((item): FakeStep[] => {
            if ('say' === item.type) { return [say(item.text)]; }
            const { id, report } = item;
            return [
               call({ id, kind: report.kind, title: report.title, command: report.command, paths: report.paths }),
               ...(true === item.gate ? [gate({ ...report, id })] : []),
            ];
         });
      },
      ran:      () => [...ranReports],
      released: () => releases,
   };
}
