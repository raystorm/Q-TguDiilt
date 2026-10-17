import { describe, it, expect } from 'vitest';
import type { Driver, ToolCallDecision, ToolCallReport } from '../governed-driver.js';

export interface GovernedDriverHarness {
   driver: Driver;
   script(reports: ToolCallReport[]): void;
   ran():  ToolCallReport[];
   /** How many times close() actually released the downstream agent. */
   released(): number;
}

const REPORT_KEYS = ['kind', 'title', 'command', 'paths', 'diff', 'rawInput'];

const read: ToolCallReport = { kind: 'read', title: 'Read a.ts', paths: ['/repo/a.ts'] };
const edit: ToolCallReport = {
   kind: 'edit', title: 'Edit a.ts', paths: ['/repo/a.ts'], diff: '- a\n+ b',
};
const exec: ToolCallReport = {
   kind: 'execute', title: 'Run build', command: 'npm run build',
   rawInput: { command: 'npm run build' },
};

const decisions = (outcomes: { decision: ToolCallDecision }[]) =>
   outcomes.map(o => o.decision);

function deferred<T = void>() {
   let resolve!: (value: T) => void;
   const promise = new Promise<T>(res => { resolve = res; });
   return { promise, resolve };
}

/** Lets already-settled promises react, without timers. */
async function flush() {
   for (let i = 0; i < 20; i++) { await Promise.resolve(); }
}

/** A decision that is never answered. */
const unanswered = () => new Promise<ToolCallDecision>(() => {});

/** Reusable contract: any governed Driver (the fake today, real drivers later). */
export function describeGovernedDriverContract(
   label: string,
   createHarness: () => GovernedDriverHarness,
) {
   describe(`governed driver contract — ${label}`, () => {
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
         expect(seen).toEqual([exec, edit]);
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
         expect(result.toolCalls).toEqual([{ report: edit, decision: 'approve' }]);
      });

      it('deny: the call does not run and the result has a deny outcome', async () => {
         const h = createHarness();
         h.script([edit]);
         const result = await h.driver.execute('cmd', { onToolCall: async () => 'deny' });
         expect(h.ran()).toEqual([]);
         expect(result.toolCalls).toEqual([{ report: edit, decision: 'deny' }]);
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

         it('decisions made before the abort stay recorded', async () => {
            const h = createHarness();
            const { result } = await abortOnSecondDecision(h);
            expect(result.toolCalls).toEqual([{ report: read, decision: 'approve' }]);
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
   });
}
