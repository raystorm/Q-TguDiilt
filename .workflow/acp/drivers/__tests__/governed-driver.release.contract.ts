import { describe, expect, it } from 'vitest';
import { SessionCollapseError } from '../../protocol/errors.js';
import type { Driver, ToolCallDecision } from '../governed-driver.js';
import { deferred, edit, unanswered } from './contract-fixtures.js';
import type { GovernedDriverHarness } from './governed-driver.contract.js';

/** Two sessions, each opened by a turn without a session id. */
async function openTwo(h: GovernedDriverHarness) {
   const a = await h.driver.execute('a');
   const b = await h.driver.execute('b');
   expect(a.sessionId).not.toBe('');
   expect(a.sessionId).not.toBe(b.sessionId);
   return { a: a.sessionId, b: b.sessionId };
}

/** The checks for `Driver.release`. Every governed driver passes them. */
export function describeReleaseChecks(createHarness: () => GovernedDriverHarness) {
   describe('release', () => {
      it('[H] a release ends that session and leaves the other usable', async () => {
         const h = createHarness();
         const { a, b } = await openTwo(h);
         await h.driver.release(a);
         expect(h.released()).toBe(1);
         const result = await h.driver.execute('again', { sessionId: b });
         expect(result.sessionId).toBe(b);
         expect(result.cancelled).not.toBe(true);
         expect(h.released()).toBe(1);
      });

      it('release resolves with undefined', async () => {
         const h = createHarness();
         const { sessionId } = await h.driver.execute('cmd');
         const pending = h.driver.release(sessionId);
         expect(pending).toBeInstanceOf(Promise);
         await expect(pending).resolves.toBeUndefined();
      });

      it('a later turn on a released session rejects with SessionCollapseError', async () => {
         const h = createHarness();
         const { sessionId } = await h.driver.execute('cmd');
         await h.driver.release(sessionId);
         const before = h.released();
         await expect(h.driver.execute('again', { sessionId }))
            .rejects.toBeInstanceOf(SessionCollapseError);
         expect(h.released()).toBe(before);
         const fresh = await h.driver.execute('fresh');
         expect(fresh.cancelled).not.toBe(true);
         expect(fresh.sessionId).not.toBe(sessionId);
      });

      it('[H] releasing twice is safe, one after the other and at once', async () => {
         const sequential = createHarness();
         const first = await sequential.driver.execute('cmd');
         await sequential.driver.release(first.sessionId);
         await expect(sequential.driver.release(first.sessionId)).resolves.toBeUndefined();
         expect(sequential.released()).toBe(1);

         const concurrent = createHarness();
         const second = await concurrent.driver.execute('cmd');
         const results = await Promise.all([
            concurrent.driver.release(second.sessionId),
            concurrent.driver.release(second.sessionId),
         ]);
         expect(results).toEqual([undefined, undefined]);
         expect(concurrent.released()).toBe(1);
      });

      it('an unknown id and the empty id do nothing', async () => {
         const used = createHarness();
         const { sessionId } = await used.driver.execute('cmd');
         for (const id of ['no-such-session', '']) {
            await expect(used.driver.release(id)).resolves.toBeUndefined();
         }
         expect(used.released()).toBe(0);
         const again = await used.driver.execute('again', { sessionId });
         expect(again.sessionId).toBe(sessionId);

         const fresh = createHarness();
         for (const id of ['no-such-session', '']) {
            await expect(fresh.driver.release(id)).resolves.toBeUndefined();
         }
         expect(fresh.released()).toBe(0);
      });

      describe('next to close', () => {
         type Run = (driver: Driver, id: string) => Promise<unknown>;
         const cases: Array<[string, Run]> = [
            ['release then close', async (driver, id) => {
               await driver.release(id);
               await driver.close();
            }],
            ['close then release', async (driver, id) => {
               await driver.close();
               await driver.release(id);
            }],
            ['both at once', (driver, id) => Promise.all([driver.release(id), driver.close()])],
         ];

         it.each(cases)('[H] %s: the agent is released once', async (_label, run) => {
            const h = createHarness();
            const { sessionId } = await h.driver.execute('cmd');
            await run(h.driver, sessionId);
            expect(h.released()).toBe(1);
         });

         it('[H] release of one of two sessions, then close, releases each once', async () => {
            const h = createHarness();
            const { a } = await openTwo(h);
            await h.driver.release(a);
            await h.driver.close();
            expect(h.released()).toBe(2);
         });
      });

      it('a session whose last turn was cancelled can be released', async () => {
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
         expect(result.sessionId).not.toBe('');
         await h.driver.release(result.sessionId);
         expect(h.released()).toBe(1);
         await expect(h.driver.execute('again', { sessionId: result.sessionId }))
            .rejects.toBeInstanceOf(SessionCollapseError);
      });

      it('[H] a release leaves a turn waiting on another session undisturbed', async () => {
         const h = createHarness();
         const { a, b } = await openTwo(h);
         const asked   = deferred();
         const pending = deferred<ToolCallDecision>();
         h.script([edit]);
         const turn = h.driver.execute('cmd', {
            sessionId:  b,
            onToolCall: () => { asked.resolve(); return pending.promise; },
         });
         await asked.promise;
         await h.driver.release(a);
         pending.resolve('approve');
         const result = await turn;
         expect(result.cancelled).not.toBe(true);
         expect(result.sessionId).toBe(b);
         expect(h.released()).toBe(1);
      });
   });
}
