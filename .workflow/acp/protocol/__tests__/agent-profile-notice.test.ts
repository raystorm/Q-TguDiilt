import { describe, it, expect } from 'vitest';
import { TWO_DRIVERS, registryOf } from '../../drivers/__tests__/registry-fixtures.js';
import { createDispatchResolver } from '../../modelResolver/resolver.js';
import type { DispatchResult, DispatchSubstitution } from '../../modelResolver/types.js';
import {
   catalogOf, createCx, createDriverSpy, createLogger, createResolverStub, makeAgent,
   newSessionArgs, resolved, textParam, textsIn,
} from './agent.helpers.js';

const MARKER = 'NOTICE-MARKER';
const NOTICE = `${MARKER} the preferred driver cannot be used`;

type Result = DispatchResult | Error;
type Asked  = DispatchSubstitution['asked'];
type Reason = DispatchSubstitution['reason'];
type Source = DispatchResult['source'];

const substituted = (
   driver: string, model: string, asked: Asked, reason: Reason, source: Source = 'profile',
) => resolved(driver, model, source, { asked, reason });

/** An alpha driver whose first turn is cancelled and whose later turns end normally. */
function cancelledOnce()
{
   let n = 0;
   return createDriverSpy(() => 0 === n++
      ? { cancelled: true, text: '', sessionId: '', toolCalls: [] }
      : { text: 'a', sessionId: 'a-1', toolCalls: [] }, 'alpha');
}

/**
 * Drivers alpha and beta; the catalog has the notice unless `flagged` is false. A profile
 * resolves to what `byProfile` says, or to alpha/m1 from the registry defaults.
 */
function noticed(
   byProfile: Record<string, Result>,
   { flagged = true, alpha }: { flagged?: boolean; alpha?: any } = {},
)
{
   const first    = alpha ?? createDriverSpy({ text: 'a', sessionId: 'a-1' }, 'alpha');
   const beta     = createDriverSpy({ text: 'b', sessionId: 'b-1' }, 'beta');
   const resolver = createResolverStub((_call, profile) =>
      undefined === profile ? resolved('alpha', 'm1') : byProfile[profile] ?? resolved('alpha', 'm1'));
   const made = makeAgent({
      catalog: catalogOf({ alpha: first, beta }, flagged ? NOTICE : undefined), resolver,
   });
   const open = async () => (await made.agent.newSession(newSessionArgs())).sessionId;
   /** The texts the client got for one prompt. A failed prompt is part of some scenarios. */
   const reply = async (id: string, text: string) => {
      const cx = createCx();
      await made.agent.prompt({ sessionId: id, ...textParam(text) }, cx).catch(() => undefined);
      return textsIn(cx);
   };
   return { ...made, alpha: first, beta, open, reply };
}

const withMarker = (texts: string[]) => texts.some(text => text.includes(MARKER));
const lines      = (texts: string[], phrase: string) => texts.filter(text => text.includes(phrase));

describe('the notice for a profile', () => {
   it('[H] a profile resolved without a substitution has no notice', async () => {
      const { reply, open } = noticed({ Planner: resolved('alpha', 'm1', 'profile') });
      expect(withMarker(await reply(await open(), 'as Planner go'))).toBe(false);
   });

   it.each([
      ['driver not available', { model: 'm1', driver: 'gone' }, 'beta', 'auto', 'profile'],
      ['model not listed', { model: 'm3', driver: 'alpha' }, 'beta', 'm3', 'profile'],
      ['entry could not be resolved', { model: 'm1', driver: 'alpha' }, 'alpha', 'auto',
         'registry-default'],
   ] as Array<[Reason, Asked, string, string, Source]>)(
      '[H] a substitution (%s) sends one line, first, with the facts',
      async (reason, asked, driver, model, source) => {
         const made  = noticed({ Planner: substituted(driver, model, asked, reason, source) });
         const texts = await made.reply(await made.open(), 'as Planner go');
         const line  = texts[0];
         const parts = [
            'Planner', asked.model, driver, model, reason, ...(asked.driver ? [asked.driver] : []),
         ];
         for (const part of parts) { expect(line).toContain(part); }
         expect(line).not.toContain('\n');
         expect(withMarker(texts)).toBe(false);
         expect(lines(texts, reason)).toHaveLength(1);
         const used = 'alpha' === driver ? made.alpha : made.beta;
         expect(used.seen[0].command).toBe('as Planner go');
      },
   );

   it('[H] a substituted provider is told in fail-fast too', async () => {
      const kiro     = createDriverSpy({ text: 'k', sessionId: 'k-1' }, 'kiro');
      const copilot  = createDriverSpy({ text: 'c', sessionId: 'c-1' }, 'copilot');
      const config   = registryOf(TWO_DRIVERS, undefined, {
         profiles: { Planner: { model: 'm3', driver: 'kiro' } }, fallbackMode: 'fail-fast',
      });
      const resolver = createDispatchResolver({ config, logger: createLogger() });
      const { agent } = makeAgent({ catalog: catalogOf({ kiro, copilot }, NOTICE), resolver });
      const { sessionId } = await agent.newSession(newSessionArgs());
      const cx = createCx();
      await agent.prompt({ sessionId, ...textParam('as Planner go') }, cx);
      const texts = textsIn(cx);
      expect(kiro.seen).toHaveLength(0);
      expect(copilot.seen[0].options.model).toBe('m3');
      for (const part of ['Planner', 'm3', 'kiro', 'copilot']) { expect(texts[0]).toContain(part); }
      expect(lines(texts, 'kiro')).toHaveLength(1);
   });

   it('the line does not invent a driver', async () => {
      const made = noticed({
         Planner: substituted('beta', 'm3', { model: 'm3' }, 'model not listed'),
      });
      const [line] = await made.reply(await made.open(), 'as Planner go');
      expect(line).toContain('Planner');
      expect(line).not.toContain('undefined');
      expect(line).not.toContain('driver ""');
   });

   it('[H] the line repeats until a turn ends normally', async () => {
      let n = 0;
      const alpha = createDriverSpy(() => {
         const call = n++;
         if (1 === call) { throw new Error('boom'); }
         if (0 === call) { return { cancelled: true, text: '', sessionId: '', toolCalls: [] }; }
         return {
            text: 'a', sessionId: 'a-1', toolCalls: [], ...(2 === call ? { end: 'output_limit' } : {}),
         };
      }, 'alpha');
      const made = noticed({
         Planner: substituted('alpha', 'm1', { model: 'm1', driver: 'gone' }, 'driver not available'),
      }, { alpha });
      const id   = await made.open();
      const sent: number[] = [];
      for (const text of ['as Planner go', 'go', 'go', 'go', 'go']) {
         sent.push(lines(await made.reply(id, text), 'driver not available').length);
      }
      expect(sent).toEqual([1, 1, 1, 1, 0]);
   });

   it('[H] a new resolution replaces the line', async () => {
      const made = noticed({
         Planner:      substituted('alpha', 'm1', { model: 'm1', driver: 'gone' }, 'driver not available'),
         Architect:    resolved('alpha', 'm1', 'profile'),
         TestDesigner: substituted('alpha', 'm1', { model: 'm9' }, 'model not listed'),
      }, { alpha: cancelledOnce() });
      const id = await made.open();
      await made.reply(id, 'as Planner go');
      expect(await made.reply(id, 'as Architect')).toEqual(['a']);
      const third = await made.reply(id, 'as TestDesigner');
      expect(third).toHaveLength(2);
      expect(third[0]).toContain('TestDesigner');
      expect(withMarker(third) || third.some(text => text.includes('Planner'))).toBe(false);
   });

   it('a profile with no entry brings the catalog notice back', async () => {
      const made = noticed({ Architect: resolved('alpha', 'auto', 'registry-default') });
      const id = await made.open();
      expect(withMarker(await made.reply(id, 'go'))).toBe(true);
      expect(withMarker(await made.reply(id, 'go'))).toBe(false);
      expect((await made.reply(id, 'as Architect'))[0]).toContain(MARKER);
   });

   it('a failed activation keeps the notice that was pending', async () => {
      const made = noticed({
         TestDesigner: substituted('alpha', 'm1', { model: 'm9' }, 'model not listed'),
         Planner:      new Error('no driver'),
      }, { alpha: cancelledOnce() });
      const id = await made.open();
      await made.reply(id, 'as TestDesigner');
      await made.reply(id, 'as Planner go');
      expect((await made.reply(id, 'go'))[0]).toContain('TestDesigner');
   });

   it('two sessions have their own notice', async () => {
      const made = noticed({
         Planner: substituted('alpha', 'm1', { model: 'm9' }, 'model not listed'),
      }, { flagged: false });
      const [first, second] = [await made.open(), await made.open()];
      expect(lines(await made.reply(first, 'as Planner go'), 'model not listed')).toHaveLength(1);
      expect(await made.reply(second, 'go')).toEqual(['a']);
   });
});
