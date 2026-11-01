import { describe, it, expect } from 'vitest';
import { UPDATE_FAILED_EVENT, createUpdateSink } from '../update-sink.js';
import { createLogger, deferred, eventsOf, flush } from './agent.helpers.js';

/** A sink over a recording delivery. `behave` decides what each attempt does (0-based). */
function makeSink(behave: (attempt: number) => Promise<void> | void = () => undefined) {
   const logger   = createLogger();
   const attempts: unknown[] = [];
   const sink     = createUpdateSink({
      deliver:   update => behave(attempts.push(update) - 1),
      logger,
      sessionId: 'sess-1',
   });
   return { sink, logger, attempts };
}

describe('the update sink', () => {
   it('[H] a slow send holds back the sends behind it', async () => {
      const held = [deferred(), deferred(), deferred()];
      const { sink, attempts } = makeSink(n => held[n].promise);
      void sink.send(1);
      void sink.send(2);
      void sink.send(3);
      await flush();
      expect(attempts).toEqual([1]);
      held[0].resolve();
      await flush();
      expect(attempts).toEqual([1, 2]);
      held[1].resolve();
      await flush();
      expect(attempts).toEqual([1, 2, 3]);
      held[2].resolve();
   });

   it('a send resolves true once it was delivered', async () => {
      const { sink } = makeSink();
      await expect(sink.send('a')).resolves.toBe(true);
   });

   it('flush resolves with nothing queued and after a failure, and never rejects', async () => {
      await expect(makeSink().sink.flush()).resolves.toBeUndefined();
      const broken = makeSink(() => { throw new Error('SECRET-ERR'); });
      await broken.sink.send('a');
      await expect(broken.sink.flush()).resolves.toBeUndefined();
   });

   it('[H] flush resolves only after everything queued was delivered', async () => {
      const hold = deferred();
      const { sink, attempts } = makeSink(n => 0 === n ? hold.promise : undefined);
      void sink.send('a');
      void sink.send('b');
      let done = false;
      void sink.flush().then(() => { done = true; });
      await flush();
      expect(done).toBe(false);
      hold.resolve();
      await flush();
      expect(done).toBe(true);
      expect(attempts).toEqual(['a', 'b']);
   });

   it.each(['rejects', 'throws'])(
      '[H] a send that %s is logged once, kind only, and the rest is dropped', async how => {
         const { sink, logger, attempts } = makeSink(n => {
            if (2 !== n) { return undefined; }
            if ('throws' === how) { throw new Error('SECRET-ERR'); }
            return Promise.reject(new Error('SECRET-ERR'));
         });
         const results = await Promise.all(Array.from({ length: 10 }, (_, i) => sink.send(i + 1)));
         expect(attempts).toEqual([1, 2, 3]);
         expect(results).toEqual([true, true, ...Array(8).fill(false)]);
         const failures = eventsOf(logger, UPDATE_FAILED_EVENT);
         expect(failures).toHaveLength(1);
         expect(failures[0].level).toBe('warn');
         expect(failures[0].data).toEqual({ sessionId: 'sess-1', failureKind: 'internal' });
         expect(JSON.stringify(logger.entries)).not.toContain('SECRET-ERR');
      },
   );

   it('[H] a closed sink ignores late sends and logs nothing', async () => {
      const { sink, logger, attempts } = makeSink();
      await sink.send('a');
      sink.close();
      await expect(sink.send('late')).resolves.toBe(false);
      expect(attempts).toEqual(['a']);
      expect(logger.entries).toEqual([]);
   });
});

describe('a reserved slot', () => {
   it('[H] holds its place: later sends leave after the slot was filled and released', async () => {
      const { sink, attempts } = makeSink();
      void sink.send('earlier');
      const slot = sink.reserve();
      void sink.send('later');
      await flush();
      expect(attempts).toEqual(['earlier']);
      await expect(slot.send('detail')).resolves.toBe(true);
      await flush();
      expect(attempts).toEqual(['earlier', 'detail']);
      slot.release();
      await flush();
      expect(attempts).toEqual(['earlier', 'detail', 'later']);
   });

   it('[H] waits for the sends queued before it', async () => {
      const hold = deferred();
      const { sink, attempts } = makeSink(n => 0 === n ? hold.promise : undefined);
      void sink.send('earlier');
      const slot   = sink.reserve();
      const detail = slot.send('detail');
      await flush();
      expect(attempts).toEqual(['earlier']);
      hold.resolve();
      await expect(detail).resolves.toBe(true);
      expect(attempts).toEqual(['earlier', 'detail']);
      slot.release();
   });

   it('released without a send it lets the queue go, and releasing twice is harmless', async () => {
      const { sink, attempts } = makeSink();
      const slot = sink.reserve();
      void sink.send('later');
      await flush();
      expect(attempts).toEqual([]);
      slot.release();
      slot.release();
      await flush();
      expect(attempts).toEqual(['later']);
   });

   it('[H] the sends behind it wait for its own send, even after the release', async () => {
      const hold = deferred();
      const { sink, attempts } = makeSink(n => 0 === n ? hold.promise : undefined);
      const slot   = sink.reserve();
      const detail = slot.send('detail');
      void sink.send('later');
      slot.release();
      await flush();
      expect(attempts).toEqual(['detail']);
      hold.resolve();
      await detail;
      await flush();
      expect(attempts).toEqual(['detail', 'later']);
   });

   it('after a failed send a slot send delivers nothing and resolves false', async () => {
      const { sink, attempts } = makeSink(() => { throw new Error('SECRET-ERR'); });
      await sink.send('a');
      const slot = sink.reserve();
      await expect(slot.send('detail')).resolves.toBe(false);
      expect(attempts).toEqual(['a']);
      slot.release();
   });
});
