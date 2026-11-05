import { describe, it, expect } from 'vitest';
import type {
   Driver, ExecuteOptions, ToolCallDecision, ToolCallReport, TurnUpdate,
} from '../governed-driver.js';
import { deferred, edit, exec, read, unanswered } from './contract-fixtures.js';
import { describeReleaseChecks } from './governed-driver.release.contract.js';

/**
 * One step of a streamed turn: the agent says something, or announces a call
 * (and asks about it when `gate` is true).
 */
export type StreamStep =
   | { type: 'say'; text: string }
   | { type: 'call'; id: string; report: ToolCallReport; gate?: boolean };

export interface GovernedDriverHarness {
   driver: Driver;
   script(reports: ToolCallReport[]): void;
   ran():  ToolCallReport[];
   /** How many downstream agents were released, by `release` or by `close()`. Each counts once. */
   released(): number;
   /**
    * The report a driver is expected to hand over for the nth scripted one.
    * Absent: the same report.
    */
   project?(report: ToolCallReport, index: number): ToolCallReport;
   /** Scripts the next turn as text and calls, in order. Only the streaming checks need it. */
   stream?(steps: StreamStep[]): void;
   /** The agent sends a text chunk after the turn has settled. Absent: nothing can arrive late. */
   lateChunk?(): Promise<void>;
}

export interface ContractOptions {
   /** True for a driver that reports updates through `onUpdate`: the streaming checks run. */
   streams?: boolean;
}

const REPORT_KEYS = ['id', 'kind', 'title', 'command', 'paths', 'diff', 'rawInput'];

const decisions = (outcomes: { decision: ToolCallDecision }[]) =>
   outcomes.map(o => o.decision);

/** What the driver should report for a scripted report. */
const expected = (h: GovernedDriverHarness, report: ToolCallReport, index = 0): ToolCallReport =>
   h.project?.(report, index) ?? report;

/** Lets already-settled promises react, without timers. */
async function flush() {
   for (let i = 0; i < 20; i++) { await Promise.resolve(); }
}

/**
 * A check on a driver that streams. `create` makes a fresh harness for each turn
 * the check runs.
 */
export interface StreamingCheck {
   name: string;
   run(create: () => GovernedDriverHarness): Promise<void>;
}

const say = (text: string): StreamStep => ({ type: 'say', text });
const call = (id: string, report: ToolCallReport, gate = false): StreamStep =>
   ({ type: 'call', id, report, gate });

/** Two texts and two calls, none asked. */
const TWO_CALLS: StreamStep[]  = [say('a'), call('c1', read), say('b'), call('c2', exec)];
/** Two texts around one call that is asked. */
const ASKED_CALL: StreamStep[] = [say('a'), call('c1', edit, true), say('b')];

/** Lets trailing work finish: microtasks, then a real tick for anything on a stream. */
async function settle() {
   await flush();
   await new Promise<void>(resolve => setTimeout(resolve, 10));
}

/** Runs one scripted turn and collects the updates, in the order they arrived. */
async function streamed(h: GovernedDriverHarness, steps: StreamStep[], extra: ExecuteOptions = {}) {
   if (undefined === h.stream) { throw new Error('the harness cannot script a stream'); }
   h.stream(steps);
   const updates: TurnUpdate[] = [];
   const result = await h.driver.execute('cmd', {
      ...extra,
      onUpdate: update => { updates.push(update); extra.onUpdate?.(update); },
   });
   return { updates, result };
}

const labelOf = (update: TurnUpdate) =>
   'text' === update.type ? `text:${update.text}` : `call:${update.id}`;

export const STREAMING_CHECKS: StreamingCheck[] = [
   {
      name: 'updates arrive in the order the agent produced them',
      async run(create) {
         const { updates } = await streamed(create(), TWO_CALLS);
         expect(updates.map(labelOf)).toEqual(['text:a', 'call:c1', 'text:b', 'call:c2']);
      },
   },
   {
      name: 'the text updates joined equal the result text',
      async run(create) {
         const { updates, result } = await streamed(create(), TWO_CALLS);
         const texts = updates.flatMap(
            update => 'text' === update.type ? [update.text] : []);
         expect(texts.length).toBeGreaterThan(1);
         expect(texts.join('')).toBe(result.text);
         expect(result.text).toBe('ab');
      },
   },
   {
      name: '[H] nothing arrives after the turn settles',
      async run(create) {
         const h = create();
         const { updates } = await streamed(h, TWO_CALLS);
         const count = updates.length;
         expect(count).toBeGreaterThan(0);
         await h.lateChunk?.();
         await settle();
         expect(updates).toHaveLength(count);
      },
   },
   {
      name: '[H] a callback that throws does not fail the turn',
      async run(create) {
         let calls = 0;
         const approve = async () => 'approve' as const;
         const throwing = () => { calls += 1; throw new Error('callback failed'); };
         const threw = await streamed(create(), ASKED_CALL, {
            onToolCall: approve,
            onUpdate:   throwing,
         });
         const quiet = await streamed(create(), ASKED_CALL, { onToolCall: approve });
         expect(calls).toBeGreaterThan(1);
         expect(threw.updates.map(labelOf)).toEqual(['text:a', 'call:c1', 'text:b']);
         expect(threw.result.text).toBe('ab');
         expect(threw.result).toEqual(quiet.result);
      },
   },
   {
      name: '[H] a call is announced before it is gated, with the same id',
      async run(create) {
         const order: string[] = [];
         await streamed(create(), ASKED_CALL, {
            onUpdate:   update => { order.push(labelOf(update)); },
            onToolCall: async report => { order.push(`gate:${report.id}`); return 'approve'; },
         });
         expect(order).toEqual(['text:a', 'call:c1', 'gate:c1', 'text:b']);
      },
   },
];

/** Reusable contract: any governed Driver (the fake today, real drivers later). */
export function describeGovernedDriverContract(
   label: string,
   createHarness: () => GovernedDriverHarness,
   options: ContractOptions = {},
) {
   describe(`governed driver contract — ${label}`, () => {
      if (true === options.streams) {
         describe('streaming', () => {
            for (const check of STREAMING_CHECKS) {
               it(check.name, () => check.run(createHarness));
            }
         });
      }

      it('onToolCall is passed per call and invoked before the call runs', async () => {
         const h = createHarness();
         const ranAtInvoke: number[] = [];
         h.script([read, edit]);
         await h.driver.execute('cmd', {
            onToolCall: async () => { ranAtInvoke.push(h.ran().length); return 'approve'; },
         });
         expect(ranAtInvoke).toEqual([0, 1]);
      });

      it('reports carry kind and title, plus details when applicable, with no ACP types', async () => {
         const h = createHarness();
         const seen: ToolCallReport[] = [];
         h.script([exec, edit]);
         await h.driver.execute('cmd', {
            onToolCall: async report => { seen.push(report); return 'approve'; },
         });
         expect(seen).toEqual([exec, edit].map((report, n) => expected(h, report, n)));
         for (const report of seen) {
            expect(typeof report.kind).toBe('string');
            expect(typeof report.title).toBe('string');
            expect(Object.keys(report).every(k => REPORT_KEYS.includes(k))).toBe(true);
         }
      });

      it('approve: the call runs and execute resolves normally', async () => {
         const h = createHarness();
         h.script([edit]);
         const result = await h.driver.execute('cmd', { onToolCall: async () => 'approve' });
         expect(h.ran()).toEqual([edit]);
         expect(result.toolCalls).toEqual([{ report: expected(h, edit), decision: 'approve' }]);
      });

      it('deny: the call does not run and the result has a deny outcome', async () => {
         const h = createHarness();
         h.script([edit]);
         const result = await h.driver.execute('cmd', { onToolCall: async () => 'deny' });
         expect(h.ran()).toEqual([]);
         expect(result.toolCalls).toEqual([{ report: expected(h, edit), decision: 'deny' }]);
      });

      it('approve then deny: only the first runs, outcomes are [approve, deny]', async () => {
         const h = createHarness();
         const answers: ToolCallDecision[] = ['approve', 'deny'];
         h.script([read, edit]);
         const result = await h.driver.execute('cmd', {
            onToolCall: async () => answers.shift() as ToolCallDecision,
         });
         expect(h.ran()).toEqual([read]);
         expect(decisions(result.toolCalls)).toEqual(['approve', 'deny']);
      });

      it('no onToolCall: every call is denied and none runs', async () => {
         const h = createHarness();
         h.script([read, edit, exec]);
         const result = await h.driver.execute('cmd');
         expect(h.ran()).toEqual([]);
         expect(decisions(result.toolCalls)).toEqual(['deny', 'deny', 'deny']);
      });

      it('a handler that throws: the call does not run and execute rejects', async () => {
         const h = createHarness();
         h.script([edit]);
         await expect(h.driver.execute('cmd', {
            onToolCall: () => { throw new Error('handler failed'); },
         })).rejects.toThrow('handler failed');
         expect(h.ran()).toEqual([]);
      });

      it('a handler that rejects: the call does not run and execute rejects', async () => {
         const h = createHarness();
         h.script([edit]);
         await expect(h.driver.execute('cmd', {
            onToolCall: () => Promise.reject(new Error('handler rejected')),
         })).rejects.toThrow('handler rejected');
         expect(h.ran()).toEqual([]);
      });

      it.each(['allow', 'APPROVE', '', undefined, null, true])(
         'a handler resolving %j is denied',
         async value => {
            const h = createHarness();
            h.script([edit]);
            const result = await h.driver.execute('cmd', {
               onToolCall: async () => value as unknown as ToolCallDecision,
            });
            expect(h.ran()).toEqual([]);
            expect(decisions(result.toolCalls)).toEqual(['deny']);
         },
      );

      describe('abort at entry', () => {
         const abortedSignal = () => { const c = new AbortController(); c.abort(); return c.signal; };

         it('[H] a signal already aborted settles cancelled without work', async () => {
            const h = createHarness();
            const asked: ToolCallReport[] = [];
            h.script([read, edit]);
            const result = await h.driver.execute('cmd', {
               signal:     abortedSignal(),
               onToolCall: async report => { asked.push(report); return 'approve'; },
            });
            expect(result.cancelled).toBe(true);
            expect(asked).toEqual([]);
            expect(h.ran()).toEqual([]);
         });

         it('[H] already aborted with no handler: cancelled, nothing runs, no throw', async () => {
            const h = createHarness();
            h.script([read, edit]);
            const result = await h.driver.execute('cmd', { signal: abortedSignal() });
            expect(result.cancelled).toBe(true);
            expect(h.ran()).toEqual([]);
         });

         it('a cancelled result has the usual shape', async () => {
            const h = createHarness();
            const result = await h.driver.execute('cmd', { signal: abortedSignal() });
            expect(typeof result.text).toBe('string');
            expect(typeof result.sessionId).toBe('string');
            expect(Array.isArray(result.toolCalls)).toBe(true);
         });
      });

      describe('abort during a turn', () => {
         it('[H] abort with a decision pending settles cancelled without waiting for it', async () => {
            const h = createHarness();
            const controller = new AbortController();
            const asked = deferred();
            h.script([edit]);
            const turn = h.driver.execute('cmd', {
               signal:     controller.signal,
               onToolCall: () => { asked.resolve(); return unanswered(); },
            });
            await asked.promise;
            controller.abort();
            const result = await turn;
            expect(result.cancelled).toBe(true);
            expect(h.ran()).toEqual([]);
         });

         /** Aborts with a decision pending, settles the turn, then answers late. */
         const answerLate = async (late: ToolCallDecision) => {
            const h = createHarness();
            const controller = new AbortController();
            const asked   = deferred();
            const pending = deferred<ToolCallDecision>();
            h.script([edit]);
            const turn = h.driver.execute('cmd', {
               signal:     controller.signal,
               onToolCall: () => { asked.resolve(); return pending.promise; },
            });
            await asked.promise;
            controller.abort();
            const result = await turn;
            pending.resolve(late);
            await flush();
            expect(result.cancelled).toBe(true);
            expect(h.ran()).toEqual([]);
            expect(decisions(result.toolCalls)).not.toContain('approve');
         };

         it('[H] a late approve after the abort is discarded', () => answerLate('approve'));
         it('a late deny after the abort is harmless',       () => answerLate('deny'));

         it('[H] an approve returned as the signal aborts never runs', async () => {
            const h = createHarness();
            const controller = new AbortController();
            h.script([edit]);
            const result = await h.driver.execute('cmd', {
               signal:     controller.signal,
               onToolCall: async () => { controller.abort(); return 'approve'; },
            });
            expect(h.ran()).toEqual([]);
            expect(result.cancelled).toBe(true);
         });

         /** Aborts while the second of three reports is decided, answering approve. */
         const abortOnSecondDecision = async (h: GovernedDriverHarness) => {
            const controller = new AbortController();
            let calls = 0;
            h.script([read, edit, exec]);
            const result = await h.driver.execute('cmd', {
               signal:     controller.signal,
               onToolCall: async () => {
                  calls += 1;
                  if (2 === calls) { controller.abort(); }
                  return 'approve';
               },
            });
            return { result, calls };
         };

         it('[H] nothing new is asked after the abort', async () => {
            const h = createHarness();
            const { calls } = await abortOnSecondDecision(h);
            expect(calls).toBe(2);
            expect(h.ran()).toEqual([read]);
         });

         it('decisions made before the abort stay recorded, '
            + 'and the call being decided at the abort is at most a deny', async () => {
            const h = createHarness();
            const { result } = await abortOnSecondDecision(h);
            const [first, ...inFlight] = result.toolCalls;
            expect(first).toEqual({ report: expected(h, read), decision: 'approve' });
            expect(decisions(inFlight)).not.toContain('approve');
         });

         it('[H] a turn whose signal aborted is cancelled although every call was decided', async () => {
            const h = createHarness();
            const controller = new AbortController();
            h.script([read]);
            const result = await h.driver.execute('cmd', {
               signal:     controller.signal,
               onToolCall: async () => { controller.abort(); return 'deny'; },
            });
            expect(result.cancelled).toBe(true);
         });

         it.each(['throws', 'rejects'])('[H] a handler that aborts and then %s settles cancelled', async how => {
            const h = createHarness();
            const controller = new AbortController();
            h.script([edit]);
            const result = await h.driver.execute('cmd', {
               signal:     controller.signal,
               onToolCall: () => {
                  controller.abort();
                  if ('throws' === how) { throw new Error('after abort'); }
                  return Promise.reject(new Error('after abort'));
               },
            });
            expect(result.cancelled).toBe(true);
            expect(h.ran()).toEqual([]);
         });

         it.each(['throws', 'rejects'])('without an abort, a handler that %s still rejects', async how => {
            const h = createHarness();
            h.script([edit]);
            await expect(h.driver.execute('cmd', {
               signal:     new AbortController().signal,
               onToolCall: () => {
                  if ('throws' === how) { throw new Error('no abort'); }
                  return Promise.reject(new Error('no abort'));
               },
            })).rejects.toThrow('no abort');
            expect(h.ran()).toEqual([]);
         });
      });

      describe('isolation and close', () => {
         it('[H] a signal that never aborts changes nothing', async () => {
            const run = async (withSignal: boolean) => {
               const h = createHarness();
               const answers: ToolCallDecision[] = ['approve', 'deny', 'approve'];
               h.script([read, edit, exec]);
               const result = await h.driver.execute('cmd', {
                  onToolCall: async () => answers.shift() as ToolCallDecision,
                  ...(withSignal ? { signal: new AbortController().signal } : {}),
               });
               return { result, ran: h.ran() };
            };
            expect(await run(true)).toEqual(await run(false));
         });

         it('[H] an old signal cannot cancel a later turn', async () => {
            const h = createHarness();
            const first = new AbortController();
            h.script([read]);
            await h.driver.execute('cmd', { signal: first.signal, onToolCall: async () => 'approve' });
            first.abort();
            h.script([edit]);
            const result = await h.driver.execute('cmd', {
               signal:     new AbortController().signal,
               onToolCall: async () => 'approve',
            });
            expect(result.cancelled).not.toBe(true);
            expect(h.ran()).toEqual([read, edit]);
         });

         it('[H] concurrent turns are independent', async () => {
            const h = createHarness();
            const a = new AbortController();
            const b = new AbortController();
            const askedA = deferred();
            const askedB = deferred();
            const heldB  = deferred<ToolCallDecision>();
            h.script([read]);
            const turnA = h.driver.execute('a', {
               signal:     a.signal,
               onToolCall: () => { askedA.resolve(); return unanswered(); },
            });
            h.script([edit]);
            const turnB = h.driver.execute('b', {
               signal:     b.signal,
               onToolCall: () => { askedB.resolve(); return heldB.promise; },
            });
            await Promise.all([askedA.promise, askedB.promise]);
            a.abort();
            const resultA = await turnA;
            heldB.resolve('approve');
            const resultB = await turnB;
            expect(resultA.cancelled).toBe(true);
            expect(resultB.cancelled).not.toBe(true);
            expect(h.ran()).toEqual([edit]);
         });

         /** Runs one turn, so the driver has something to release. */
         const runOneTurn = async (h: GovernedDriverHarness) => {
            h.script([read]);
            await h.driver.execute('cmd', { onToolCall: async () => 'approve' });
         };

         it('close with nothing started resolves and releases nothing', async () => {
            const h = createHarness();
            await expect(h.driver.close()).resolves.toBeUndefined();
            expect(h.released()).toBe(0);
         });

         it('[H] close is idempotent', async () => {
            const h = createHarness();
            await runOneTurn(h);
            await h.driver.close();
            await h.driver.close();
            await h.driver.close();
            expect(h.released()).toBe(1);
         });

         it.each([2, 5])('[H] close called %i times at once resolves every call and releases once', async n => {
            const h = createHarness();
            await runOneTurn(h);
            const results = await Promise.all(Array.from({ length: n }, () => h.driver.close()));
            expect(results).toEqual(Array(n).fill(undefined));
            expect(h.released()).toBe(1);
         });

         it('a late close after close has finished still resolves', async () => {
            const h = createHarness();
            await runOneTurn(h);
            await h.driver.close();
            await flush();
            await expect(h.driver.close()).resolves.toBeUndefined();
            expect(h.released()).toBe(1);
         });

         it('[H] close with a decision pending settles the turn and discards the late approve', async () => {
            const h = createHarness();
            const asked   = deferred();
            const pending = deferred<ToolCallDecision>();
            let settled = false;
            h.script([edit]);
            const turn = h.driver.execute('cmd', {
               onToolCall: () => { asked.resolve(); return pending.promise; },
            });
            turn.then(() => { settled = true; }, () => { settled = true; });
            await asked.promise;
            await h.driver.close();
            await flush();
            expect(settled).toBe(true);
            pending.resolve('approve');
            await flush();
            expect(h.ran()).toEqual([]);
         });

         it('close between decisions stops further calls', async () => {
            const h = createHarness();
            const asked   = deferred();
            const pending = deferred<ToolCallDecision>();
            let calls = 0;
            h.script([read, edit, exec]);
            const turn = h.driver.execute('cmd', {
               onToolCall: () => {
                  calls += 1;
                  if (2 !== calls) { return Promise.resolve<ToolCallDecision>('approve'); }
                  asked.resolve();
                  return pending.promise;
               },
            });
            turn.catch(() => {});
            await asked.promise;
            await h.driver.close();
            pending.resolve('approve');
            await flush();
            expect(calls).toBe(2);
            expect(h.ran()).toEqual([read]);
         });
      });

      describeReleaseChecks(createHarness);
   });
}
