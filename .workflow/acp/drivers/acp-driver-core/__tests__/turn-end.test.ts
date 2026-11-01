import { describe, expect, it } from 'vitest';
import type { DriverResult } from '../../governed-driver.js';
import { AgentStopReasonError } from '../errors.js';
import { type FakeAgent, createDiagnostics, makeDriver } from './acp-driver.helpers.js';
import { abortableTurn, askFor, say, wrapUp } from './cancel.helpers.js';
import { SESSION, failureOf } from './failures.helpers.js';

const endOf = (result: DriverResult) => result.end ?? 'completed';

/** The agent's next turn: it says `text`, then answers the prompt with `response`. */
function endingWith(agent: FakeAgent, response: object, text = 'so far') {
   agent.respond('session/prompt', async () => {
      if ('' !== text) { await say(agent, text); }
      return response;
   });
}

/**
 * A turn the driver fails, with the process left alone: no process ended, no record, and
 * a second turn on the same session completes. Returns the error.
 */
async function failsButLives(response: object) {
   const diagnostics = createDiagnostics();
   const { driver, agents } = makeDriver(1, undefined, undefined, undefined, diagnostics);
   const agent = agents[0];
   endingWith(agent, response, 'partial');
   const error = await failureOf(driver.execute('go'));
   expect(error).toBeInstanceOf(AgentStopReasonError);
   expect(agent.stdinCloses).toBe(0);
   expect(agent.kills).toEqual([]);
   expect(diagnostics.records).toEqual([]);
   endingWith(agent, { stopReason: 'end_turn' }, 'second');
   await expect(driver.execute('again', { sessionId: SESSION }))
      .resolves.toMatchObject({ text: 'second' });
   agent.exit(0);
   return error as Error;
}

describe('why the turn ended', () => {
   it.each([
      ['end_turn',          'completed'],
      ['max_tokens',        'output_limit'],
      ['max_turn_requests', 'request_limit'],
      ['refusal',           'refused'],
   ])('[H] the stop reason %s is the end %s', async (stopReason, end) => {
      const { driver, agents } = makeDriver();
      endingWith(agents[0], { stopReason });
      const result = await driver.execute('go');
      expect(endOf(result)).toBe(end);
      expect(result.text).toBe('so far');
      expect(Object.keys(result)).not.toContain('cancelled');
      expect(result.sessionId).toBe(SESSION);
      expect(result.toolCalls).toEqual([]);
   });

   it('a completed turn keeps the result shape of before', async () => {
      const { driver, agents } = makeDriver();
      endingWith(agents[0], { stopReason: 'end_turn' }, 'x');
      expect(await driver.execute('go')).toStrictEqual({
         text: 'x', sessionId: SESSION, toolCalls: [],
      });
   });

   it('[H] an agent that cancels on its own fails the turn and leaves the process alone', async () => {
      const error = await failsButLives({ stopReason: 'cancelled' });
      expect(error.message).toContain('cancelled');
   });

   it.each<[string, object, string | undefined]>([
      ['banana',                 { stopReason: 'banana' },    'banana'],
      ['an empty string',        { stopReason: '' },          undefined],
      ['END_TURN',               { stopReason: 'END_TURN' },  'END_TURN'],
      ['end_turn with a space',  { stopReason: 'end_turn ' }, 'end_turn '],
      ['a missing stop reason',  {},                          'none'],
      ['the number 7',           { stopReason: 7 },           undefined],
      ['null',                   { stopReason: null },        undefined],
   ])('[H] a stop reason the driver does not know fails the turn: %s', async (_label, response, named) => {
      const error = await failsButLives(response);
      if (undefined !== named) { expect(error.message).toContain(named); }
   });

   it('the reason in the error goes through redaction', async () => {
      const error = await failsButLives({ stopReason: 'oops token=abc123' });
      expect(error.message).toContain('oops');
      expect(error.message).not.toContain('abc123');
   });

   it.each(['cancelled', 'end_turn', 'max_tokens', 'refusal', 'banana'])(
      '[H] our abort wins over the stop reason %s',
      async stopReason => {
         const t = await abortableTurn();
         t.controller.abort();
         await t.agent.arrived('session/cancel');
         t.finish({ stopReason });
         expect(await t.turn).toMatchObject({ cancelled: true });
         await wrapUp(t);
      },
   );

   it('an abnormal end keeps everything the turn produced', async () => {
      const { driver, agents } = makeDriver();
      const agent = agents[0];
      agent.respond('session/prompt', async () => {
         await askFor(agent, 'c1');
         await say(agent, 'cut');
         return { stopReason: 'max_tokens' };
      });
      const result = await driver.execute('go', { onToolCall: async () => 'approve' });
      expect(endOf(result)).toBe('output_limit');
      expect(result.text).toBe('cut');
      expect(result.toolCalls.map(call => call.decision)).toEqual(['approve']);
      expect(result.sessionId).toBe(SESSION);
   });
});
