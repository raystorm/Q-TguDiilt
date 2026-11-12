import { describe, it, expect } from 'vitest';
import { parseCompletionBlock } from '../completion-block.js';
import { parseProfileNames } from '../workflow-command.js';
import { PROFILE_FIXTURE } from './profile-fixtures.js';

const NAMES = parseProfileNames(PROFILE_FIXTURE, 'names-under-test.md');
// Doctor also answers to an emoji, for the one table that needs it.
const EMOJI_NAMES = parseProfileNames(
   PROFILE_FIXTURE.replace('**Aliases:** Dr, Medic', '**Aliases:** Dr, Medic, 🩺'), 'emoji-names.md',
);

const parse = (text: string) => parseCompletionBlock(text, NAMES);

/** A completion line that suggests `command` in a code span. */
const line = (command: string) => `**Next**: Run \`${command}\``;

const continues = (target: string) => ({ kind: 'continue', target });
const stops     = (reason: string, word?: string) => ({ kind: 'stop', reason, word });

describe('reading the completion block', () => {
   it('the standard completion line continues with the profile it names', () => {
      const text = 'Done.\n\n**Next**: Run `@handoff to=Planner` (or `@send Doctor`)';
      expect(parse(text)).toEqual(continues('Planner'));
   });

   // name as written, canonical name
   const SPELLINGS: Array<[string, string]> = [
      ['Planner', 'Planner'], ['planner', 'Planner'], ['PLANNER', 'Planner'], ['PO', 'Planner'],
      ['po', 'Planner'], ['Strategist', 'Planner'], ['TD', 'TestDesigner'], ['PE', 'PromptEngineer'],
      ['dr', 'Doctor'], ['🩺', 'Doctor'],
   ];

   it.each(SPELLINGS)('"%s" continues with the canonical name %s', (name, target) => {
      expect(parseCompletionBlock(line(`@handoff to=${name}`), EMOJI_NAMES)).toEqual(continues(target));
   });

   it('[H] the block starts at the last line that begins with the marker', () => {
      const text = [
         line('@handoff to=Architect'), 'More work followed.', line('@handoff to=Enforcer'),
      ].join('\n');
      expect(parse(text)).toEqual(continues('Enforcer'));
   });

   it('[H] a suggestion above the marker line is not read', () => {
      const text = 'I would run `@handoff to=Architect` here.\n**Next**: Close this tab.';
      expect(parse(text)).toEqual(stops('no_suggestion'));
   });

   it('[H] every line after the marker line belongs to the block', () => {
      const two = '**Next**: choose one\n- `@handoff to=Planner`\n- `@handoff to=Enforcer`';
      const one = '**Next**: choose one\n- `@handoff to=Planner`\nThat is all.';
      expect(parse(two)).toEqual(stops('several_suggestions'));
      expect(parse(one)).toEqual(continues('Planner'));
   });

   it('two names for one profile are one suggestion; two profiles are two', () => {
      const same  = '**Next**: `@handoff to=Planner` or `@handoff to=po`';
      const plain = '**Next**: `@handoff to=Planner` or `@handoff Planner`';
      const other = '**Next**: `@handoff to=Planner` or `@handoff to=Enforcer`';
      expect(parse(same)).toEqual(continues('Planner'));
      expect(parse(plain)).toEqual(continues('Planner'));
      expect(parse(other)).toEqual(stops('several_suggestions'));
   });

   it('two spellings of one unknown name are one suggestion', () => {
      const text = '**Next**: `@handoff to=Nobody` or `@handoff to=NOBODY`';
      expect(parse(text)).toMatchObject({ kind: 'stop', reason: 'unknown_profile' });
   });

   it('a bare handoff span has no target, and counts as a suggestion of its own', () => {
      expect(parse(line('@handoff'))).toEqual(stops('no_target'));
      expect(parse('**Next**: `@handoff` or `@handoff`')).toEqual(stops('no_target'));
      expect(parse('**Next**: `@handoff` or `@handoff to=Planner`'))
         .toEqual(stops('several_suggestions'));
   });

   it('a span with a target and no command is not a suggestion', () => {
      expect(parse(line('to=Planner'))).toEqual(stops('no_suggestion'));
      expect(parse(line('Planner'))).toEqual(stops('no_suggestion'));
   });

   it('a send span never starts a handoff', () => {
      expect(parse(line('@send Doctor'))).toEqual(stops('no_target'));
      expect(parse(line('@send to=Doctor'))).toEqual(stops('no_target'));
      expect(parse('**Next**: `@send to=Doctor` or `@handoff to=Planner`'))
         .toEqual(continues('Planner'));
   });

   it('a slash send span never starts a handoff either', () => {
      expect(parse(line('/send Doctor'))).toEqual(stops('no_target'));
      expect(parse('**Next**: `/send to=Doctor` or `/handoff to=Planner`'))
         .toEqual(continues('Planner'));
   });

   it('the at and slash forms of one handoff are one suggestion', () => {
      expect(parse('**Next**: `@handoff to=Planner` or `/handoff to=Planner`'))
         .toEqual(continues('Planner'));
   });

   // label, text, result
   const EXAMPLES: Array<[string, string, object]> = [
      [
         'the standard line',
         '**Next**: Run `@handoff to=Planner` (or `@send Doctor`)',
         continues('Planner'),
      ],
      [
         'a branching line with two handoffs',
         '**Next**: Use `@handoff to=Enforcer` or `@handoff to=Planner` if it needs refining.',
         stops('several_suggestions'),
      ],
      [
         'a side-trip completion',
         'Side trip complete.\nClose this tab and return to Planner tab.',
         stops('no_suggestion'),
      ],
      ['text with no marker line', 'All done. Nothing else to do.', stops('no_suggestion')],
      ['empty text', '', stops('no_suggestion')],
   ];

   it.each(EXAMPLES)('the example holds: %s', (_label, text, result) => {
      expect(parse(text)).toEqual(result);
   });

   const UNKNOWN = ['Nobody', 'constructor', '__proto__', 'toString', 'hasOwnProperty'];

   it.each(UNKNOWN)('[H] "%s" is not a profile: the loop stops and returns the name', name => {
      expect(parse(line(`@handoff to=${name}`))).toEqual(stops('unknown_profile', name));
   });

   it('a target with no name has no target', () => {
      expect(parse(line('@handoff to='))).toEqual(stops('no_target'));
   });

   const NOT_SPANS: Array<[string, string]> = [
      ['plain text', '**Next**: run @handoff to=Planner'],
      ['bold text',  '**Next**: run **@handoff to=Planner**'],
      ['a heading',  '**Next**:\n## @handoff to=Planner'],
   ];

   it.each(NOT_SPANS)('[H] only code spans count: %s is not read', (_label, text) => {
      expect(parse(text)).toEqual(stops('no_suggestion'));
   });

   it('[H] the marker must be where a line starts', () => {
      expect(parse('Then **Next**: run `@handoff to=Planner`')).toEqual(stops('no_suggestion'));
      expect(parse('**Next** `@handoff to=Planner`')).toEqual(continues('Planner'));
   });

   it.each(['\r\n', '\n'])('line ends %j make no difference', ends => {
      const text = ['Done.', '', line('@handoff to=Planner')].join(ends);
      expect(parse(text)).toEqual(continues('Planner'));
   });

   // label, text, result
   const SHAPES: Array<[string, string, object]> = [
      ['the command in capitals',        line('@HANDOFF to=planner'),          continues('Planner')],
      ['extra spaces after the command', line('@handoff   to=Planner'),        continues('Planner')],
      ['a tab after the command',        line('@handoff\tto=Planner'),         continues('Planner')],
      ['a trailing period',              line('@handoff to=Planner.'),         continues('Planner')],
      ['a trailing comma',               line('@handoff to=Planner,'),         continues('Planner')],
      ['a trailing colon',               line('@handoff to=Planner:'),         continues('Planner')],
      ['a trailing semicolon',           line('@handoff to=Planner;'),         continues('Planner')],
      [
         'two trailing periods', line('@handoff to=Planner..'), stops('unknown_profile', 'Planner.'),
      ],
      [
         'a quoted name', line('@handoff to="Planner"'), stops('unknown_profile', '"Planner"'),
      ],
      [
         'a name with a space',
         line('@handoff to=Prompt Engineer'),
         stops('unknown_profile', 'Prompt Engineer'),
      ],
      [
         'words after the name', line('@handoff to=Planner now'), stops('unknown_profile', 'Planner now'),
      ],
      ['to= in capitals',                line('@handoff TO=Planner'),          continues('Planner')],
      ['to= in mixed case',              line('@handoff To=po'),               continues('Planner')],
      ['a space after to=',              line('@handoff to= Planner'),         continues('Planner')],
      ['the name with no to=',           line('@handoff Planner'),             continues('Planner')],
      ['an alias with no to=',           line('@handoff po'),                  continues('Planner')],
      ['a trailing period, no to=',      line('@handoff Planner.'),            continues('Planner')],
      ['an unknown name, no to=',        line('@handoff Nobody'),              stops('unknown_profile', 'Nobody')],
      [
         'words after the name, no to=',
         line('@handoff Planner now'),
         stops('unknown_profile', 'Planner now'),
      ],
      ['a slash command',                line('/handoff to=Planner'),          continues('Planner')],
      ['a slash command in capitals',    line('/HANDOFF to=po'),               continues('Planner')],
      ['a slash command, no to=',        line('/handoff Planner'),             continues('Planner')],
      ['a doubled slash',                line('//handoff to=Planner'),         stops('no_suggestion')],
      ['a longer slash command word',    line('/handoffs to=Planner'),         stops('no_suggestion')],
      ['a longer command word',          line('@handoffs to=Planner'),         stops('no_suggestion')],
      ['a longer send word',             line('@sender Doctor'),               stops('no_suggestion')],
      ['an indented marker line',        '  **Next**: Run `@handoff to=Planner`', stops('no_suggestion')],
      [
         'a fenced block',
         '**Next**: choose\n```\n`@handoff to=Planner`\n```',
         stops('no_suggestion'),
      ],
      [
         'a span after a closed fence',
         '**Next**:\n```\nexample\n```\n`@handoff to=Planner`',
         continues('Planner'),
      ],
   ];

   it.each(SHAPES)('structure is strict and cosmetics are tolerated: %s', (_label, text, result) => {
      expect(parse(text)).toEqual(result);
   });

   // Agent output is untrusted, so none of these may be slow or throw.
   const HOSTILE: Array<[string, string]> = [
      ['backticks only',                 '`'.repeat(200_000)],
      ['backticks after the marker',     '**Next**: ' + '`'.repeat(200_000)],
      ['one long line',                  'x'.repeat(200_000)],
      ['one long line after the marker', '**Next**: ' + 'x'.repeat(200_000)],
      ['an unclosed span',               '**Next**: `' + 'x'.repeat(200_000)],
      ['many marker lines',              '**Next**\n'.repeat(50_000)],
      ['many fence lines',               '**Next**\n' + '```\n'.repeat(50_000)],
      ['many spans on one line',         '**Next**: ' + '`@handoff to=Planner` '.repeat(50_000)],
   ];

   it.each(HOSTILE)('[H] hostile input (%s) is answered within a second', (_label, text) => {
      const began = performance.now();
      expect(() => parse(text)).not.toThrow();
      expect(performance.now() - began).toBeLessThan(1000);
   });
});
