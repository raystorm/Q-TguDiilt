import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecuteOptions, ToolCallKind, ToolCallReport, TurnUpdate } from '../../governed-driver.js';
import type { UnsafeSetting } from '../types.js';
import { type FakeAgent, deferred, makeDriver } from './acp-driver.helpers.js';
import { abortableTurn, askFor, say, wrapUp } from './cancel.helpers.js';
import { NEVER } from './fake-acp-agent.js';
import { SESSION, failureOf } from './failures.helpers.js';

const END_TURN = { stopReason: 'end_turn' };

const notify   = (agent: FakeAgent, update: object) =>
   agent.notify('session/update', { sessionId: SESSION, update });
const announce = (agent: FakeAgent, fields: object) =>
   notify(agent, { sessionUpdate: 'tool_call', ...fields });
const patch    = (agent: FakeAgent, fields: object) =>
   notify(agent, { sessionUpdate: 'tool_call_update', ...fields });

const labelOf = (u: TurnUpdate) => 'text' === u.type ? `text:${u.text}` : `call:${u.id}`;
const textsOf = (updates: TurnUpdate[]) =>
   updates.flatMap(u => 'text' === u.type ? [u.text] : []);

/** Lets anything still on its way to the driver arrive. */
const quiet = () => new Promise<void>(resolve => setTimeout(resolve, 20));

/** Resolves once `done()` holds; fails after about a second. */
async function until(done: () => boolean) {
   for (let i = 0; i < 200 && !done(); i++) { await new Promise<void>(r => setTimeout(r, 5)); }
   expect(done()).toBe(true);
}

/** A callback that keeps every update it is given. */
function recorder() {
   const updates: TurnUpdate[] = [];
   return { updates, onUpdate: (u: TurnUpdate) => { updates.push(u); } };
}

/** One turn in which the agent does `play`; every update is recorded. */
async function played(play: (agent: FakeAgent) => Promise<unknown>, extra: ExecuteOptions = {}) {
   const made  = makeDriver();
   const agent = made.agents[0];
   const { updates, onUpdate } = recorder();
   agent.respond('session/prompt', async () => { await play(agent); return END_TURN; });
   const result = await made.driver.execute('go', { ...extra, onUpdate });
   return { ...made, agent, updates, result };
}

const DIFF = (path: string) => ({ type: 'diff', path, oldText: 'OLD-TEXT', newText: 'NEW-TEXT' });

describe('text reaches onUpdate as the agent sends it', () => {
   it('[H] one update per chunk, while the turn is still running', async () => {
      const { driver, agents } = makeDriver();
      const agent = agents[0];
      const hold  = deferred();
      const { updates, onUpdate } = recorder();
      agent.respond('session/prompt', async () => {
         await say(agent, 'one');
         await hold.promise;
         await say(agent, 'two');
         return END_TURN;
      });
      let settled = false;
      const turn = driver.execute('go', { onUpdate }).then(result => { settled = true; return result; });
      await until(() => 1 === updates.length);
      expect(updates).toEqual([{ type: 'text', text: 'one' }]);
      expect(settled).toBe(false);
      hold.resolve();
      const result = await turn;
      expect(textsOf(updates)).toEqual(['one', 'two']);
      expect(result.text).toBe('onetwo');
   });

   it('keeps 1000 chunks in order', async () => {
      const chunks = Array.from({ length: 1000 }, (_, i) => `${i},`);
      const { updates, result } = await played(async agent => {
         for (const chunk of chunks) { await say(agent, chunk); }
      });
      expect(textsOf(updates)).toEqual(chunks);
      expect(result.text).toBe(chunks.join(''));
   });
});

describe('a tool_call message becomes one update with the fields it carried', () => {
   it.each<[string, object, object]>([
      ['an execute call',
         { kind: 'execute', title: 'Run build', status: 'pending',
            rawInput: { command: 'npm run build', note: 'NOTE-CANARY' } },
         { kind: 'execute', title: 'Run build', status: 'pending', command: 'npm run build' }],
      ['an edit with locations and a diff',
         { kind: 'edit', title: 'Edit', locations: [{ path: '/r/a.ts' }, { path: '/r/b.ts' }],
            content: [DIFF('/r/a.ts')] },
         { kind: 'edit', title: 'Edit', paths: ['/r/a.ts', '/r/b.ts'] }],
      ['an edit with a diff only',
         { kind: 'edit', title: 'Edit', content: [DIFF('/r/a.ts')] },
         { kind: 'edit', title: 'Edit', paths: ['/r/a.ts'] }],
      ['a read with one location',
         { kind: 'read', title: 'Read', locations: [{ path: '/r/a.ts' }] },
         { kind: 'read', title: 'Read', paths: ['/r/a.ts'] }],
      ['a fetch with a title only',
         { kind: 'fetch', title: 'Fetch' },
         { kind: 'fetch', title: 'Fetch' }],
      ['a kind outside the list', { kind: 'switch_mode', title: 'T' }, { kind: 'other', title: 'T' }],
      ['status in_progress', { title: 'T', status: 'in_progress' }, { title: 'T', status: 'running' }],
      ['status completed',   { title: 'T', status: 'completed' },   { title: 'T', status: 'completed' }],
      ['status failed',      { title: 'T', status: 'failed' },      { title: 'T', status: 'failed' }],
      ['status pending',     { title: 'T', status: 'pending' },     { title: 'T', status: 'pending' }],
   ])('[H] %s', async (_label, message, expected) => {
      const { updates } = await played(agent => announce(agent, { toolCallId: 'c1', ...message }));
      expect(updates).toStrictEqual([{ type: 'tool_call', id: 'c1', ...expected }]);
      expect(JSON.stringify(updates)).not.toMatch(/NOTE-CANARY|OLD-TEXT|NEW-TEXT/);
   });

   it.each<[string, unknown, string | undefined]>([
      ['a command',                           { command: 'ls' }, 'ls'],
      ['a command repeated in commands',      { command: 'ls', commands: ['ls'] }, 'ls'],
      ['a command and two in commands',       { command: 'ls', commands: ['ls', 'pwd'] }, undefined],
      ['a command and an empty commands',     { command: 'ls', commands: [] }, undefined],
      ['a blank command',                     { command: '   ' }, undefined],
      ['commands only',                       { commands: ['ls'] }, undefined],
      ['a string',                            'ls', undefined],
   ])('[H] the command is the one governance would see: %s', async (_label, rawInput, command) => {
      const { updates } = await played(agent =>
         announce(agent, { toolCallId: 'c1', title: 'Run', kind: 'execute', rawInput }));
      expect(updates).toHaveLength(1);
      if (undefined === command) { expect(updates[0]).not.toHaveProperty('command'); }
      else                       { expect(updates[0]).toMatchObject({ command }); }
   });

   it('[H] a later update carries only the fields that message carried', async () => {
      const { updates } = await played(async agent => {
         await announce(agent, {
            toolCallId: 'c1', title: 'Run', kind: 'execute', rawInput: { command: 'ls' },
         });
         await patch(agent, { toolCallId: 'c1', status: 'completed' });
         await patch(agent, { toolCallId: 'c1', title: 'Done' });
      });
      expect(updates.slice(1)).toStrictEqual([
         { type: 'tool_call', id: 'c1', status: 'completed' },
         { type: 'tool_call', id: 'c1', title: 'Done' },
      ]);
   });

   it('an update for a call that was never announced still arrives', async () => {
      const { updates } = await played(agent => patch(agent, { toolCallId: 'c9', title: 'Late' }));
      expect(updates).toStrictEqual([{ type: 'tool_call', id: 'c9', title: 'Late' }]);
   });

   const KINDS: ToolCallKind[] = [
      'read', 'search', 'think', 'execute', 'edit', 'delete', 'move', 'fetch', 'other',
   ];

   it.each(KINDS)('every kind produces updates, also %s, which never asks', async kind => {
      const { updates } = await played(async agent => {
         await announce(agent, { toolCallId: 'c1', title: 'T', kind, status: 'pending' });
         await patch(agent, { toolCallId: 'c1', status: 'completed' });
      });
      expect(updates.map(u => 'tool_call' === u.type ? [u.id, u.status] : [])).toEqual([
         ['c1', 'pending'], ['c1', 'completed'],
      ]);
   });
});

describe('other message types', () => {
   let echo: { mockRestore(): void };
   // The SDK writes an update it cannot read to the service's stderr; held back to keep the run quiet.
   beforeEach(() => { echo = vi.spyOn(console, 'error').mockImplementation(() => undefined); });
   afterEach(()  => { echo.mockRestore(); });

   it.each<[string, object]>([
      ['an agent_thought_chunk',
         { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'THOUGHT' } }],
      ['a plan', { sessionUpdate: 'plan', entries: [] }],
      ['available_commands_update', { sessionUpdate: 'available_commands_update', availableCommands: [] }],
      ['a usage_update', { sessionUpdate: 'usage_update', used: 10, size: 100 }],
      ['a current_mode_update', { sessionUpdate: 'current_mode_update', currentModeId: 'x' }],
      ['a safe config_option_update', { sessionUpdate: 'config_option_update', configOptions: [] }],
      ['an image chunk', { sessionUpdate: 'agent_message_chunk',
         content: { type: 'image', data: 'AAAA', mimeType: 'image/png' } }],
      ['a resource_link chunk', { sessionUpdate: 'agent_message_chunk',
         content: { type: 'resource_link', name: 'n', uri: 'file:///x' } }],
      ['a user_message_chunk',
         { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'USER' } }],
   ])('[H] %s is not forwarded and not in the text', async (_label, message) => {
      const { updates, result } = await played(async agent => {
         await notify(agent, message);
         await say(agent, 'ok');
      });
      expect(updates).toEqual([{ type: 'text', text: 'ok' }]);
      expect(result.text).toBe('ok');
   });
});

describe('order and the callback\'s life', () => {
   it('[H] a tool_call update comes before the gate for the same call, and text goes on meanwhile', async () => {
      const { driver, agents } = makeDriver();
      const agent  = agents[0];
      const events: string[] = [];
      const answer = deferred<'approve'>();
      const reports: ToolCallReport[] = [];
      agent.respond('session/prompt', async () => {
         await say(agent, 'a');
         await announce(agent, {
            toolCallId: 'c1', title: 'Run', kind: 'execute', rawInput: { command: 'ls' },
         });
         const asked = askFor(agent, 'c1');
         await say(agent, 'b');
         await asked;
         return END_TURN;
      });
      const turn = driver.execute('go', {
         onUpdate:   u => { events.push(labelOf(u)); },
         onToolCall: report => { reports.push(report); events.push(`gate:${report.id}`); return answer.promise; },
      });
      await until(() => events.includes('text:b'));
      expect(events).toEqual(['text:a', 'call:c1', 'gate:c1', 'text:b']);
      answer.resolve('approve');
      await turn;
      expect(reports[0].id).toBe('c1');
   });

   it('[H] a throwing onUpdate never fails the turn, and is still called for every update', async () => {
      const { driver, agents } = makeDriver();
      const agent = agents[0];
      const seen: string[] = [];
      const reports: ToolCallReport[] = [];
      agent.respond('session/prompt', async () => {
         await say(agent, 'a');
         await announce(agent, { toolCallId: 'c1', title: 'Run', kind: 'execute' });
         await askFor(agent, 'c1');
         await say(agent, 'b');
         return END_TURN;
      });
      const result = await driver.execute('go', {
         onUpdate: u => {
            seen.push(labelOf(u));
            if (1 === seen.length || 'tool_call' === u.type) { throw new Error('callback failed'); }
         },
         onToolCall: async report => { reports.push(report); return 'approve'; },
      });
      expect(result.text).toBe('ab');
      expect(seen).toEqual(['text:a', 'call:c1', 'text:b']);
      expect(result.toolCalls.map(call => call.decision)).toEqual(['approve']);
   });

   const SETTINGS: UnsafeSetting[] = [
      { name: 'blanket_approval', optionId: 'approval', values: ['on'] },
   ];
   const UNSAFE_ON = {
      sessionUpdate: 'config_option_update',
      configOptions: [{ id: 'approval', name: 'approval', type: 'select', currentValue: 'on', options: [] }],
   };

   it.each<[string, object, boolean]>([
      ['a text chunk', { sessionUpdate: 'agent_message_chunk',
         content: { type: 'text', text: 'LATE-TEXT' } }, false],
      ['a tool_call', { sessionUpdate: 'tool_call', toolCallId: 'late1', title: 'LATE-TITLE',
         kind: 'execute', rawInput: { command: 'ls' } }, false],
      ['a tool_call_update', { sessionUpdate: 'tool_call_update', toolCallId: 'late1',
         status: 'completed' }, false],
      ['a config update that switches an unsafe setting on', UNSAFE_ON, true],
   ])('[H] %s after the turn settled reaches nobody', async (_label, late, warns) => {
      const { driver, agents } = makeDriver(1, undefined, undefined, SETTINGS);
      const agent = agents[0];
      agent.respond('session/prompt', async () => { await say(agent, 'first'); return END_TURN; });
      const one = recorder();
      await driver.execute('one', { onUpdate: one.onUpdate });
      await notify(agent, late);
      await quiet();
      expect(one.updates.map(labelOf)).toEqual(['text:first']);

      agent.respond('session/prompt', async () => { await say(agent, 'second'); return END_TURN; });
      const two = recorder();
      const result = await driver.execute('two', { sessionId: SESSION, onUpdate: two.onUpdate });
      expect(JSON.stringify(two.updates)).not.toContain('LATE');
      expect(result.text).not.toContain('LATE');
      expect(result.text.includes('Warning')).toBe(warns);
      expect(one.updates).toHaveLength(1);
   });

   it('[H] a callback belongs to its own turn', async () => {
      const { driver, agents } = makeDriver();
      const agent = agents[0];
      let turns = 0;
      agent.respond('session/prompt', async () => {
         turns += 1;
         await say(agent, `t${turns}`);
         return END_TURN;
      });
      const a = recorder();
      const b = recorder();
      const first = await driver.execute('one', { onUpdate: a.onUpdate });
      await driver.execute('two', { sessionId: first.sessionId, onUpdate: b.onUpdate });
      const third = await driver.execute('three', { sessionId: first.sessionId });
      expect(textsOf(a.updates)).toEqual(['t1']);
      expect(textsOf(b.updates)).toEqual(['t2']);
      expect(third.text).toBe('t3');
   });
});

describe('ends that are not a normal answer', () => {
   it('[H] text that follows the abort is delivered, and the delivered text joined is the result', async () => {
      const { updates, onUpdate } = recorder();
      const t = await abortableTurn({ onUpdate });
      await say(t.agent, 'one ');
      t.controller.abort();
      await t.agent.arrived('session/cancel');
      await say(t.agent, 'two ');
      await say(t.agent, 'three');
      t.finish({ stopReason: 'cancelled' });
      const result = await t.turn;
      expect(textsOf(updates)).toEqual(['one ', 'two ', 'three']);
      expect(result).toStrictEqual({
         text: 'one two three', sessionId: SESSION, toolCalls: [], cancelled: true,
      });
      await quiet();
      expect(updates).toHaveLength(3);
      await wrapUp(t);
   });

   it('a crash mid-turn: the text so far was delivered, the turn rejects, nothing follows', async () => {
      const { driver, agents } = makeDriver();
      const agent = agents[0];
      const { updates, onUpdate } = recorder();
      agent.respond('session/prompt', async () => {
         await say(agent, 'a');
         await quiet();
         agent.exit(1);
         return NEVER;
      });
      const error = await failureOf(driver.execute('go', { onUpdate }));
      expect(error).toBeDefined();
      expect(textsOf(updates)).toEqual(['a']);
      await quiet();
      expect(updates).toHaveLength(1);
   });
});

describe('the report carries the agent\'s call id', () => {
   it('[H] a call announced before its request: the report and the update share the id', async () => {
      const reports: ToolCallReport[] = [];
      const { updates } = await played(async agent => {
         await announce(agent, {
            toolCallId: 'c1', title: 'Run', kind: 'execute', rawInput: { command: 'ls' },
         });
         await askFor(agent, 'c1');
      }, { onToolCall: async report => { reports.push(report); return 'deny'; } });
      expect(reports.map(report => report.id)).toEqual(['c1']);
      expect(updates.map(labelOf)).toEqual(['call:c1']);
   });

   it('a request with no earlier tool_call: the id comes from the request alone', async () => {
      const reports: ToolCallReport[] = [];
      await played(agent => askFor(agent, 'c2'),
         { onToolCall: async report => { reports.push(report); return 'deny'; } });
      expect(reports.map(report => report.id)).toEqual(['c2']);
   });
});
