import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISCONNECT_BOUND_MS, DISCONNECT_ERROR_EXIT_CODE, createShutdownHandler } from '../shutdown.js';
import { deferred, flush } from './agent.helpers.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(()  => { vi.useRealTimers(); });

function make(disconnect: () => Promise<void>) {
   const exit = vi.fn();
   const run  = vi.fn(disconnect);
   return { trigger: createShutdownHandler({ disconnect: run, exit }), exit, run };
}

describe('the end of the service', () => {
   it('the bound and the error status are named constants', () => {
      expect(DISCONNECT_BOUND_MS).toBe(10000);
      expect(DISCONNECT_ERROR_EXIT_CODE).toBe(1);
   });

   it('[H] a clean disconnect runs once and exits 0', async () => {
      const t = make(() => Promise.resolve());
      t.trigger();
      await flush();
      expect(t.run).toHaveBeenCalledTimes(1);
      expect(t.exit.mock.calls).toEqual([[0]]);
      expect(vi.getTimerCount()).toBe(0);
   });

   it('[H] the service does not exit while the disconnect is still running', async () => {
      const slow = deferred<void>();
      const t = make(() => slow.promise);
      t.trigger();
      await vi.advanceTimersByTimeAsync(DISCONNECT_BOUND_MS - 1);
      expect(t.exit).not.toHaveBeenCalled();
      slow.resolve();
      await flush();
      expect(t.exit.mock.calls).toEqual([[0]]);
   });

   it('[H] a later trigger changes nothing, even during a slow disconnect', async () => {
      const slow = deferred<void>();
      const t = make(() => slow.promise);
      t.trigger();
      t.trigger();
      await vi.advanceTimersByTimeAsync(3000);
      t.trigger();
      await flush();
      expect(t.run).toHaveBeenCalledTimes(1);
      expect(t.exit).not.toHaveBeenCalled();
      slow.resolve();
      await flush();
      t.trigger();
      await flush();
      expect(t.exit.mock.calls).toEqual([[0]]);
      expect(t.run).toHaveBeenCalledTimes(1);
   });

   it.each([
      ['rejects',                          () => Promise.reject(new Error('lost'))],
      ['throws before returning a promise', () => { throw new Error('lost'); }],
   ] as Array<[string, () => Promise<void>]>)('[H] a disconnect that %s exits non-zero', async (_how, disconnect) => {
      const t = make(disconnect);
      t.trigger();
      await flush();
      expect(t.exit.mock.calls).toEqual([[DISCONNECT_ERROR_EXIT_CODE]]);
      expect(vi.getTimerCount()).toBe(0);
   });

   it('[H] a disconnect that never settles cannot hold the service forever', async () => {
      const t = make(() => new Promise<void>(() => undefined));
      t.trigger();
      await vi.advanceTimersByTimeAsync(5000);
      t.trigger();
      await vi.advanceTimersByTimeAsync(DISCONNECT_BOUND_MS - 5000 - 1);
      expect(t.exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(t.exit.mock.calls).toEqual([[DISCONNECT_ERROR_EXIT_CODE]]);
      await vi.advanceTimersByTimeAsync(DISCONNECT_BOUND_MS);
      expect(t.exit).toHaveBeenCalledTimes(1);
   });
});
