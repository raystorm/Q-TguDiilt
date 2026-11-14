import { describe, it, expect } from 'vitest';
import { utimesSync } from 'node:fs';
import { join } from 'node:path';
import { end, say } from '../../drivers/__tests__/fake-governed-driver.js';
import { useTempDir, writeFile } from '../../drivers/__tests__/catalog-fixtures.js';
import { returnPrompt } from '../agent/side-trip.js';
import {
   MESSAGE_PATH, STATUS_DIR, detectActivation, detectHandoff, detectSend,
} from '../workflow-command.js';
import {
   type Cx, type LoopRig, type ScriptStep, act, closesTrip, createCx, createResolverStub, eventsOf, loopRig,
   loopRoutes, openChat, readyFile, resolved, sendLine, sendPrompt, sendTurn, statusFile, suggestsSend,
   textsIn, throws,
} from './agent.helpers.js';

const dirOf = useTempDir();

const makeRig = (routes = loopRoutes, overrides: Record<string, unknown> = {}) =>
   loopRig({ routes, dir: dirOf(), ...overrides });

/** The data of every log entry of one event, in order. */
const dataOf = (rig: LoopRig, event: string) => eventsOf(rig.logger, event).map(entry => entry.data);

/** What the client was sent as text, one entry per update, without the padding. */
const trimmed = (cx: Cx) => textsIn(cx).map(text => text.trim());

/** Every non-empty line the client was shown, in order. */
const linesOf = (cx: Cx) => textsIn(cx).join('').split('\n').map(line => line.trim()).filter(line => '' !== line);

const STOPPED = 'Automatic changeover stopped.';

/**
 * Scripts a trip of one profile on beta, where Enforcer and Doctor run: Enforcer suggests a send to
 * `to`, the send turn writes the message, the side profile closes the trip, Enforcer resumes. Each
 * turn gets the session id that tells it apart: `enf-1` for Enforcer, `doc-1` for the side profile.
 */
function scriptTrip(rig: LoopRig, sideSays: ScriptStep[] = [])
{
   const { beta } = rig.scripted;
   beta.script(suggestsSend(rig, 'Enforcer', 'Doctor'), { sessionId: 'enf-1' });
   beta.script(sendTurn(rig, 'Enforcer', 'Doctor'), { sessionId: 'enf-1' });
   beta.script([...sideSays, ...closesTrip(rig, 'Doctor', 'Enforcer')], { sessionId: 'doc-1' });
   beta.script([say('Resumed.')], { sessionId: 'enf-1' });
}

describe('a side trip started from the main thread', () => {
   it('[H] a trip of one profile, from the send to the return', async () => {
      const rig = makeRig();
      scriptTrip(rig);
      const sessionId = await openChat(rig);

      const response = await sendPrompt(rig, sessionId, 'as Enforcer go');

      expect(rig.commands).toEqual(['as Enforcer go', '@send to=Doctor', '@receive', returnPrompt('Doctor')]);
      expect(response).toEqual({ stopReason: 'end_turn' });
      expect(dataOf(rig, 'loop_stopped')).toEqual([{ sessionId, reason: 'no_suggestion', profileHop: 2 }]);
   });

   it('[H] the main session is parked, never released; the side one goes once its end is confirmed', async () => {
      const rig = makeRig();
      const { beta } = rig.scripted;
      scriptTrip(rig);
      const at: Array<{ id: string; commands: number; checks: unknown[] }> = [];
      beta.onRelease = async id => {
         const checks = dataOf(rig, 'status_check').map(data => data.check);
         at.push({ id, commands: rig.commands.length, checks });
      };

      await sendPrompt(rig, await openChat(rig), 'as Enforcer go');

      expect(beta.released).toEqual(['doc-1']);
      expect(at).toEqual([{ id: 'doc-1', commands: 3, checks: ['send', 'end'] }]);
      expect(beta.seen[3].options.sessionId).toBe('enf-1');
   });

   it('[H] the main thread resumes on the driver and model it had, and nothing is resolved again', async () => {
      let enforcer = 0;
      const resolver = createResolverStub((_call, profile) =>
         'Enforcer' === profile ? resolved('beta', 0 === enforcer++ ? 'm2' : 'm9') : resolved('beta', 'm2'));
      const rig = makeRig(loopRoutes, { resolver });
      scriptTrip(rig);

      await sendPrompt(rig, await openChat(rig), 'as Enforcer go');

      const { seen } = rig.scripted.beta;
      expect(seen[3].options.model).toBe('m2');
      const enforcerCalls = rig.resolver.calls.filter((profile: string | undefined) => 'Enforcer' === profile);
      expect(enforcerCalls).toHaveLength(1);
   });

   it('[H] the return prompt is fixed: it names the profile and carries no result', async () => {
      const rig = makeRig();
      scriptTrip(rig, [say('RESULT-MARK-1\n\n')]);
      scriptTrip(rig);
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, 'as Enforcer go');
      await sendPrompt(rig, sessionId, 'go');

      const returns = rig.commands.filter(command => returnPrompt('Doctor') === command);
      expect(returns).toHaveLength(2);
      expect(returnPrompt('Doctor')).toContain('Doctor');
      expect(rig.commands.every(command => !command.includes('RESULT-MARK-1'))).toBe(true);
   });

   it('[H] the return prompt cannot be taken for a command', () => {
      const prompt = returnPrompt('Doctor');
      expect(detectActivation(prompt)).toBeUndefined();
      expect(detectHandoff(prompt)).toBe(false);
      expect(detectSend(prompt)).toBe(false);
      expect(prompt).not.toMatch(/^as\b/i);
      expect(returnPrompt('PromptEngineer')).toContain('PromptEngineer');
   });

   it('the chat shows each command, then a line that names the profile at each switch', async () => {
      const rig = makeRig();
      const cx  = createCx();
      scriptTrip(rig, [say('DOC-TEXT\n\n')]);

      await sendPrompt(rig, await openChat(rig), 'as Enforcer go', cx);

      const lines = linesOf(cx);
      expect(lines).toHaveLength(10);
      expect(lines[4]).toMatch(/Doctor/);
      expect(lines[8]).toMatch(/Enforcer/);
      expect(lines.filter((_line, at) => 4 !== at && 8 !== at)).toEqual([
         sendLine('Doctor'),
         'Changeover: sending `@send to=Doctor`',
         'Message written.',
         'Changeover: sending `@receive`',
         'DOC-TEXT',
         'Close this tab and return to Enforcer.',
         `Changeover: sending \`${returnPrompt('Doctor')}\``,
         'Resumed.',
      ]);
   });
});

// ---------------------------------------------------------------- the prose only triggers the read

const sendReady = (dir: string, overrides: Record<string, unknown> = {}, offset?: number) =>
   readyFile(dir, 'Enforcer', 'Doctor', { next: { command: 'send', to: 'Doctor' }, ...overrides }, offset);

// label, outcome, how the folder is left: the Enforcer file that does not confirm a send to Doctor
const UNCONFIRMED_SEND: Array<[string, string, (dir: string) => void]> = [
   ['no status folder',           'missing',   () => {}],
   ['a stale ready file',         'stale',     dir => { sendReady(dir, {}, -60_000); }],
   ['two fresh files',            'ambiguous', dir => {
      sendReady(dir);
      statusFile(dir, 'Enforcer-wf-b.json', 'not json');
   }],
   ['an unparseable file',        'invalid',   dir => { statusFile(dir, 'Enforcer-wf-test.json', 'not json'); }],
   ['a waiting file',             'not_ready', dir => { sendReady(dir, { status: 'waiting', next: undefined }); }],
   ['a started file',             'not_ready', dir => { sendReady(dir, { status: 'started', next: undefined }); }],
   ['a complete file',            'not_ready', dir => {
      sendReady(dir, { status: 'complete', next: undefined });
   }],
   ['a ready file for Planner',   'mismatch',  dir => {
      sendReady(dir, { next: { command: 'send', to: 'Planner' } });
   }],
   ['a ready file for a handoff', 'mismatch',  dir => {
      sendReady(dir, { next: { command: 'handoff', to: 'Doctor' } });
   }],
];

describe('a send is followed only when the status file confirms it', () => {
   it.each(UNCONFIRMED_SEND)('[H] %s gives %s: no send, no chat line', async (_label, outcome, arrange) => {
      const rig = makeRig();
      const cx  = createCx();
      rig.scripted.beta.script([act(() => arrange(dirOf())), say(sendLine('Doctor'))]);
      const sessionId = await openChat(rig);

      const response = await sendPrompt(rig, sessionId, 'as Enforcer go', cx);

      expect(response).toEqual({ stopReason: 'end_turn' });
      expect(rig.commands).toEqual(['as Enforcer go']);
      expect(trimmed(cx)).toHaveLength(1);
      expect(dataOf(rig, 'status_check')).toEqual([{ sessionId, profile: 'Enforcer', check: 'send', outcome }]);
      expect(dataOf(rig, 'loop_stopped')).toMatchObject([{ reason: 'status_not_confirmed' }]);
      expect(rig.sessionStore.get(sessionId)?.parked).toBeUndefined();
   });

   it('[H] "after you send me X" is not a trip', async () => {
      const rig = makeRig();
      rig.scripted.beta.script([
         act(() => sendReady(dirOf(), { status: 'waiting', next: undefined })),
         say('Which file do you mean?\n\n**Next**: after you answer, run `@send to=Doctor`'),
      ]);

      await sendPrompt(rig, await openChat(rig), 'as Enforcer go');

      expect(rig.commands).toEqual(['as Enforcer go']);
      expect(dataOf(rig, 'loop_stopped')).toMatchObject([{ reason: 'status_not_confirmed' }]);
   });

   it('[H] a chat with no profile reads nothing and starts no trip', async () => {
      const rig = makeRig();
      sendReady(dirOf());
      rig.scripted.alpha.script([say(sendLine('Doctor'))]);
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, 'go');

      expect(rig.commands).toEqual(['go']);
      expect(dataOf(rig, 'status_check')).toEqual([{ sessionId, check: 'send', outcome: 'missing' }]);
   });
});

// ---------------------------------------------------------------- the message file before the target starts

/** The send turn: the message file as `arrange` leaves it, and the sender marked waiting. */
const sendTurnWith = (arrange: (rig: LoopRig, dir: string) => void, rig: LoopRig) => [
   act(() => {
      arrange(rig, dirOf());
      sendReady(dirOf(), { status: 'waiting', next: undefined });
   }),
   say('Message written.'),
];

// label, how the send turn leaves the message file
const NOT_WRITTEN: Array<[string, (rig: LoopRig, dir: string) => void]> = [
   ['no message file',                        () => {}],
   ['a file older than the turn, for Doctor', rig => { rig.writeMessage('Doctor', -60_000); }],
   ['a file that names Planner',              rig => { rig.writeMessage('Planner'); }],
   ['a file with no ## To',                   (_rig, dir) => {
      const file  = writeFile(join(dir, MESSAGE_PATH), '# Message\n\nNo target here.\n');
      const ahead = (Date.now() + 5000) / 1000;
      utimesSync(file, ahead, ahead);
   }],
];

describe('the message file is checked before the target starts', () => {
   it.each(NOT_WRITTEN)('[H] %s: the trip does not start', async (_label, arrange) => {
      const rig = makeRig();
      const cx  = createCx();
      const { beta } = rig.scripted;
      beta.script(suggestsSend(rig, 'Enforcer', 'Doctor'), { sessionId: 'enf-1' });
      beta.script(sendTurnWith(arrange, rig), { sessionId: 'enf-1' });
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, 'as Enforcer go', cx);

      expect(rig.commands).toEqual(['as Enforcer go', '@send to=Doctor']);
      expect(dataOf(rig, 'loop_stopped')).toMatchObject([{ reason: 'message_not_written' }]);
      expect(trimmed(cx).at(-1)).toContain(MESSAGE_PATH);
      expect(beta.released).toEqual([]);
      expect(rig.sessionStore.get(sessionId)?.parked).toBeUndefined();
   });

   it('[H] a message that names an unknown profile stops with that word', async () => {
      const rig = makeRig();
      const cx  = createCx();
      const { beta } = rig.scripted;
      beta.script(suggestsSend(rig, 'Enforcer', 'Doctor'), { sessionId: 'enf-1' });
      beta.script(sendTurnWith(rig2 => { rig2.writeMessage('Nobody'); }, rig), { sessionId: 'enf-1' });

      await sendPrompt(rig, await openChat(rig), 'as Enforcer go', cx);

      expect(rig.commands).toEqual(['as Enforcer go', '@send to=Doctor']);
      expect(dataOf(rig, 'loop_stopped')).toMatchObject([{ reason: 'unknown_profile', word: 'Nobody' }]);
      expect(trimmed(cx).at(-1)).toContain('"Nobody"');
   });

   it('[H] an alias of the target starts the trip', async () => {
      const rig = makeRig();
      const { beta } = rig.scripted;
      beta.script(suggestsSend(rig, 'Enforcer', 'Doctor'), { sessionId: 'enf-1' });
      beta.script(sendTurnWith(rig2 => { rig2.writeMessage('Dr'); }, rig), { sessionId: 'enf-1' });
      beta.script(closesTrip(rig, 'Doctor', 'Enforcer'), { sessionId: 'doc-1' });
      beta.script([say('Resumed.')], { sessionId: 'enf-1' });

      await sendPrompt(rig, await openChat(rig), 'as Enforcer go');

      expect(rig.commands).toEqual(['as Enforcer go', '@send to=Doctor', '@receive', returnPrompt('Doctor')]);
   });
});

// ---------------------------------------------------------------- what the start changes, and when

describe('starting the side profile', () => {
   it('[H] a target that cannot be resolved changes nothing', async () => {
      const { Doctor: _Doctor, ...withoutDoctor } = loopRoutes;
      const rig = makeRig(withoutDoctor);
      const { beta } = rig.scripted;
      beta.script(suggestsSend(rig, 'Enforcer', 'Doctor'), { sessionId: 'enf-1' });
      beta.script(sendTurn(rig, 'Enforcer', 'Doctor'), { sessionId: 'enf-1' });
      const sessionId = await openChat(rig);

      await expect(sendPrompt(rig, sessionId, 'as Enforcer go')).rejects.toThrow('no route for Doctor');

      const record = rig.sessionStore.get(sessionId);
      expect(rig.commands).toEqual(['as Enforcer go', '@send to=Doctor']);
      expect(beta.released).toEqual([]);
      expect(record?.profile).toBe('Enforcer');
      expect(record?.driverSessionId).toBe('enf-1');
      expect(record?.parked).toBeUndefined();
   });

   it('[H] two sessions of one driver are live, and the main one is the one that returns', async () => {
      const rig = makeRig();
      const { beta } = rig.scripted;
      const sessionId = await openChat(rig);
      let during: { released: string[]; running?: string; parked?: string } | undefined;
      beta.script(suggestsSend(rig, 'Enforcer', 'Doctor'), { sessionId: 'enf-1' });
      beta.script(sendTurn(rig, 'Enforcer', 'Doctor'), { sessionId: 'enf-1' });
      beta.script([
         act(() => {
            const record = rig.sessionStore.get(sessionId);
            const parked = record?.parked?.driverSessionId;
            during = { released: [...beta.released], running: record?.driverSessionId, parked };
         }),
         ...closesTrip(rig, 'Doctor', 'Enforcer'),
      ], { sessionId: 'doc-1' });
      beta.script([say('Resumed.')], { sessionId: 'enf-1' });

      await sendPrompt(rig, sessionId, 'as Enforcer go');

      expect(during).toEqual({ released: [], running: undefined, parked: 'enf-1' });
      expect(beta.seen[2].options.sessionId).toBeUndefined();
      expect(rig.sessionStore.get(sessionId)?.driverSessionId).toBe('enf-1');
      expect(beta.seen[3].options.sessionId).toBe('enf-1');
   });

   it('[H] a side profile that is the main profile runs fresh and returns to the parked one', async () => {
      const rig = makeRig();
      const { beta } = rig.scripted;
      beta.script(suggestsSend(rig, 'Enforcer', 'Enforcer'), { sessionId: 'enf-1' });
      beta.script(sendTurn(rig, 'Enforcer', 'Enforcer'), { sessionId: 'enf-1' });
      beta.script(closesTrip(rig, 'Enforcer', 'Enforcer'), { sessionId: 'enf-2' });
      // The side Enforcer's complete file ages before the parked Enforcer's turn starts.
      beta.onRelease = async () => {
         const old = (Date.now() - 60_000) / 1000;
         utimesSync(join(dirOf(), STATUS_DIR, 'Enforcer-wf-test.json'), old, old);
      };
      beta.script([say(sendLine('Doctor'))], { sessionId: 'enf-1' });
      const sessionId = await openChat(rig);

      await sendPrompt(rig, sessionId, 'as Enforcer go');

      expect(rig.commands).toEqual([
         'as Enforcer go', '@send to=Enforcer', '@receive', returnPrompt('Enforcer'),
      ]);
      expect(beta.seen[2].options.sessionId).toBeUndefined();
      expect(beta.seen[3].options.sessionId).toBe('enf-1');
      expect(beta.released).toEqual(['enf-2']);
      expect(dataOf(rig, 'status_check').at(-1)).toMatchObject({ check: 'send', outcome: 'stale' });
   });
});

// ---------------------------------------------------------------- the send turn is the sender's own turn

describe('a send turn that does not end normally', () => {
   it('[H] a throw reaches the caller, says so in the chat, and parks nothing', async () => {
      const rig = makeRig();
      const cx  = createCx();
      const { beta } = rig.scripted;
      beta.script(suggestsSend(rig, 'Enforcer', 'Doctor'), { sessionId: 'enf-1' });
      beta.script([throws(new Error('SECRET-ERR'))], { sessionId: 'enf-1' });
      const sessionId = await openChat(rig);

      await expect(sendPrompt(rig, sessionId, 'as Enforcer go', cx)).rejects.toThrow('SECRET-ERR');

      expect(rig.commands).toEqual(['as Enforcer go', '@send to=Doctor']);
      expect(trimmed(cx)).toContain(STOPPED);
      expect(dataOf(rig, 'loop_stopped')).toMatchObject([{ reason: 'failed' }]);
      expect(rig.sessionStore.get(sessionId)?.parked).toBeUndefined();
   });

   it('[H] an abnormal end stops, says so in the chat, and parks nothing', async () => {
      const rig = makeRig();
      const cx  = createCx();
      const { beta } = rig.scripted;
      beta.script(suggestsSend(rig, 'Enforcer', 'Doctor'), { sessionId: 'enf-1' });
      beta.script([end('output_limit')], { sessionId: 'enf-1' });
      const sessionId = await openChat(rig);

      const response = await sendPrompt(rig, sessionId, 'as Enforcer go', cx);

      expect(response).toEqual({ stopReason: 'max_tokens' });
      expect(rig.commands).toEqual(['as Enforcer go', '@send to=Doctor']);
      expect(trimmed(cx)).toContain(STOPPED);
      expect(dataOf(rig, 'loop_stopped')).toMatchObject([{ reason: 'abnormal_end' }]);
      expect(rig.sessionStore.get(sessionId)?.parked).toBeUndefined();
   });
});
