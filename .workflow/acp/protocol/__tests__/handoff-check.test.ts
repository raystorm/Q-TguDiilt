import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { checkHandoff } from '../handoff-check.js';
import { HANDOFF_PATH, MESSAGE_PATH, parseProfileNames } from '../workflow-command.js';
import { useTempDir, writeFile } from '../../drivers/__tests__/catalog-fixtures.js';
import { changeover } from './agent.helpers.js';
import { PROFILE_FIXTURE } from './profile-fixtures.js';

const dirOf = useTempDir();
const NAMES = parseProfileNames(PROFILE_FIXTURE, 'names-under-test.md');

// A whole second, so a time one millisecond either side of it compares exactly.
const STARTED = 1_700_000_000_000;
const SECOND  = 1000;

const AS_ROOT = 0 === process.getuid?.();

/** Sets the modification time of `file` to `offset` milliseconds from `STARTED`. */
function touch(file: string, offset: number): string
{
   const seconds = (STARTED + offset) / 1000;
   utimesSync(file, seconds, seconds);
   return file;
}

/** The handoff file where the service looks for it, `offset` ms from `STARTED`. */
const handoffNaming = (profile: string, offset = SECOND) =>
   touch(changeover(HANDOFF_PATH, profile, dirOf()), offset);
const handoffWith = (text: string, offset = SECOND) =>
   touch(writeFile(join(dirOf(), HANDOFF_PATH), text), offset);
const handoffPath = () => join(dirOf(), HANDOFF_PATH);

const check = (file: string, expected?: string) =>
   checkHandoff({ file, startedAt: STARTED, names: NAMES, expected });

describe('checking the handoff file', () => {
   it('a fresh file naming a known profile passes', () => {
      expect(check(handoffNaming('Planner'))).toEqual({ ok: true, target: 'Planner' });
   });

   // name under ## To, canonical name
   const WRITTEN: Array<[string, string]> = [['po', 'Planner'], ['PLANNER', 'Planner'], ['Dr', 'Doctor']];

   it.each(WRITTEN)('"%s" under ## To is resolved to %s', (written, target) => {
      expect(check(handoffNaming(written))).toEqual({ ok: true, target });
   });

   // target the service sent, name under ## To, passes
   const SENT: Array<[string, string, boolean]> = [
      ['Planner', 'Planner',  true],
      ['Planner', 'po',       true],
      ['po',      'Planner',  true],
      ['Planner', 'Enforcer', false],
      ['Planner', 'Nobody',   false],
   ];

   it.each(SENT)('[H] a sent handoff to %s with %s under ## To passes: %s', (sent, written, ok) => {
      expect(check(handoffNaming(written), sent).ok).toBe(ok);
   });

   it('[H] a typed handoff accepts any known profile', () => {
      expect(check(handoffNaming('Enforcer'))).toEqual({ ok: true, target: 'Enforcer' });
   });

   it('[H] a typed handoff naming an unknown profile is refused, with the name as written', () => {
      expect(check(handoffNaming('Nobody'))).toEqual({ ok: false, word: 'Nobody' });
   });

   // label, text
   const UNUSABLE: Array<[string, string]> = [
      ['an empty file',       ''],
      ['no ## To heading',    '# Handoff\n\n## From\nBuilder\n'],
      ['nothing under ## To', '## To\n\n## From\nBuilder\n'],
      ['### To',              '### To\nPlanner\n'],
      ['## Tooling',          '## Tooling\nPlanner\n'],
   ];

   it.each(UNUSABLE)('[H] a fresh file with %s does not pass', (_label, text) => {
      expect(check(handoffWith(text))).toEqual({ ok: false });
   });

   it('[H] a file that is not there does not pass', () => {
      expect(check(handoffPath())).toEqual({ ok: false });
   });

   it('[H] a folder in place of the file does not pass', () => {
      mkdirSync(handoffPath(), { recursive: true });
      touch(handoffPath(), SECOND);
      expect(check(handoffPath())).toEqual({ ok: false });
   });

   it.skipIf(AS_ROOT)('[H] a file that cannot be read does not pass', () => {
      const file = handoffNaming('Planner');
      chmodSync(file, 0o000);
      expect(() => check(file)).not.toThrow();
      expect(check(file)).toEqual({ ok: false });
   });

   // label, milliseconds from the start, passes
   const AGES: Array<[string, number, boolean]> = [
      ['60 seconds before', -60_000,    false],
      ['1 ms before',       -1,         false],
      ['exactly at',        0,          true],
      ['1 ms after',        1,          true],
      ['a day after',       86_400_000, true],
   ];

   it.each(AGES)('[H] a file modified %s the start passes: %s', (_label, offset, ok) => {
      expect(check(handoffNaming('Planner', offset)).ok).toBe(ok);
   });

   it('[H] freshness is the modification time, not the text', () => {
      expect(check(handoffNaming('Planner', -60 * SECOND))).toEqual({ ok: false });
      expect(check(handoffNaming('Planner', SECOND))).toEqual({ ok: true, target: 'Planner' });
   });

   it('[H] a stale file gives no name, whatever it names', () => {
      expect(check(handoffNaming('Nobody', -60 * SECOND))).toEqual({ ok: false });
   });

   it('[H] only the file at the handoff path counts', () => {
      changeover(MESSAGE_PATH, 'Planner', dirOf());
      changeover('other/HANDOFF.md', 'Planner', dirOf());
      expect(check(handoffPath())).toEqual({ ok: false });

      handoffNaming('Enforcer');
      expect(check(handoffPath())).toEqual({ ok: true, target: 'Enforcer' });
   });

   it('nothing is remembered between checks', () => {
      expect(check(handoffPath())).toEqual({ ok: false });
      handoffNaming('Planner');
      expect(check(handoffPath())).toEqual({ ok: true, target: 'Planner' });
      handoffNaming('Enforcer');
      expect(check(handoffPath())).toEqual({ ok: true, target: 'Enforcer' });
   });
});
