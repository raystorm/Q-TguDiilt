import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
   detectActivation, detectHandoff, detectSend, loadProfileNames, parseProfileNames,
   readChangeoverTarget,
} from '../workflow-command.js';
import { profilesPath } from '../profiles-location.js';
import { ProfileError } from '../errors.js';
import { INHERITED_NAMES } from '../../drivers/__tests__/registry-fixtures.js';
import { useTempDir, writeFile } from '../../drivers/__tests__/catalog-fixtures.js';
import { PROFILE_FIXTURE } from './profile-fixtures.js';

const dirOf = useTempDir();
const LABEL = 'names-under-test.md';
const NAMES = parseProfileNames(PROFILE_FIXTURE, LABEL);

// Finding the activation ------------------------------------------------------------------

describe('finding a user activation', () => {
   // text, command, name
   const USER_FORMS: Array<[string, string, string]> = [
      ['as Planner',              'as',  'Planner'],
      ['AS planner',              'as',  'planner'],
      ['@as Planner',             'as',  'Planner'],
      ['@As PLANNER',             'as',  'PLANNER'],
      ['aS PlaNnEr',              'as',  'PlaNnEr'],
      ['@As pLaNnEr go',          'as',  'pLaNnEr'],
      ['  as Planner  ',          'as',  'Planner'],
      ['as Planner, review it',   'as',  'Planner'],
      ['as Planner. Go',          'as',  'Planner'],
      ['as Planner: go',          'as',  'Planner'],
      ['as Planner; go',          'as',  'Planner'],
      ['as Planner\nreview this', 'as',  'Planner'],
      ['as 🩺',                   'as',  '🩺'],
      ['@dr',                     'dr',  'Doctor'],
      ['@DR help me',             'dr',  'Doctor'],
      ['@dR',                     'dr',  'Doctor'],
      ['@epr',                    'epr', 'Enforcer'],
      ['@Epr check it',           'epr', 'Enforcer'],
      ['@ePr',                    'epr', 'Enforcer'],
      ['/as Planner',             'as',  'Planner'],
      ['/AS planner',             'as',  'planner'],
      ['/aS PlaNnEr',             'as',  'PlaNnEr'],
      ['  /as Planner, review it', 'as',  'Planner'],
      ['/dr',                     'dr',  'Doctor'],
      ['/Dr help me',             'dr',  'Doctor'],
      ['/dR',                     'dr',  'Doctor'],
      ['/epr',                    'epr', 'Enforcer'],
      ['/ePr check it',           'epr', 'Enforcer'],
      ['please run @as Planner',  'as',  'Planner'],
      ['hello @as Planner, go',   'as',  'Planner'],
      ['hello @dr',               'dr',  'Doctor'],
      ['hello\n@dr',              'dr',  'Doctor'],
      ['review it, then @epr',    'epr', 'Enforcer'],
      ['hi @dR',                  'dr',  'Doctor'],
      ['please run /as Planner',  'as',  'Planner'],
      ['hello /dr',               'dr',  'Doctor'],
      ['hello\n/dr',              'dr',  'Doctor'],
      ['review it, then /epr',    'epr', 'Enforcer'],
      ['hi /dR',                  'dr',  'Doctor'],
   ];

   it.each(USER_FORMS)('finds %j: command %s, name %s', (text, command, name) => {
      expect(detectActivation(text)).toEqual({ kind: 'user', command, name });
   });

   it('only the first command and its first name count', () => {
      expect(detectActivation('as Planner as Doctor')?.name).toBe('Planner');
      expect(detectActivation('@as Planner @dr')?.name).toBe('Planner');
      expect(detectActivation('/as Planner @dr')?.name).toBe('Planner');
      expect(detectActivation('run @start then @dr'))
         .toEqual({ kind: 'changeover', command: 'start' });
      expect(detectActivation('run /start then @dr'))
         .toEqual({ kind: 'changeover', command: 'start' });
      expect(detectActivation('@dr then /start'))
         .toEqual({ kind: 'user', command: 'dr', name: 'Doctor' });
   });

   it('the name is the first word only, so a name split by a space is not a profile', () => {
      const found = detectActivation('as Plan ner');
      expect(found?.name).toBe('Plan');
      expect(NAMES.resolve(found?.name as string)).toBeUndefined();
   });

   const NAME_ON_NEXT_LINE = [
      'as\nPlanner', '/as\nPlanner', '@as\nPlanner', 'hello @as\nPlanner', 'hello /as\nPlanner',
   ];

   it.each(NAME_ON_NEXT_LINE)(
      'a name on the next line counts: %j', text => {
         expect(detectActivation(text)).toEqual({ kind: 'user', command: 'as', name: 'Planner' });
      },
   );
});

describe('finding a changeover activation', () => {
   const CHANGEOVER_FORMS: Array<[string, string]> = [
      ['@start',              'start'],
      ['@START',              'start'],
      ['@StArT',              'start'],
      ['  @start  ',          'start'],
      ['@start now please',   'start'],
      ['@Receive',            'receive'],
      ['@rEcEiVe',            'receive'],
      ['@receive\nsome text', 'receive'],
      ['/start',              'start'],
      ['/StArT',              'start'],
      ['/receive now',        'receive'],
      ['run @start',          'start'],
      ['see @receive',        'receive'],
      ['hello\n@start',       'start'],
      ['please @rEcEiVe',     'receive'],
      ['run /start',          'start'],
      ['see /receive',        'receive'],
      ['hello\n/start',       'start'],
   ];

   it.each(CHANGEOVER_FORMS)('[H] finds %j as a changeover, with no name', (text, command) => {
      const found = detectActivation(text);
      expect(found).toEqual({ kind: 'changeover', command });
      expect(found).not.toHaveProperty('name');
   });
});

describe('finding a typed handoff', () => {
   const HANDOFFS = [
      '@handoff', '/handoff', '@HANDOFF', '/HaNdOfF', 'yes, confirmed. @handoff',
      'confirmed\n@handoff to=po', '  @handoff  ', 'hello /handoff to=Planner',
   ];
   const NOT_WHOLE_WORDS = [
      '@handoffs', '@handoff-all', 'handoff', 'me@handoff.io', '@hand', 'x/handoff/y',
      '/handoff/x', '@@handoff',
   ];
   const WITH_ARGUMENTS = ['@handoff to=Nobody', '@handoff to='];
   const NOT_HANDOFFS = ['go', '', 'as Planner write it', '@start', '@send Doctor'];

   it.each(HANDOFFS)('finds %j as a typed handoff', text => {
      expect(detectHandoff(text)).toBe(true);
   });

   it.each(NOT_WHOLE_WORDS)('[H] %j is not a whole word, so not a handoff', text => {
      expect(detectHandoff(text)).toBe(false);
   });

   it.each(WITH_ARGUMENTS)('%j is a handoff: its arguments are not read', text => {
      expect(detectHandoff(text)).toBe(true);
   });

   it.each(NOT_HANDOFFS)('%j is not a handoff', text => {
      expect(detectHandoff(text)).toBe(false);
   });
});

describe('finding a typed send', () => {
   const SENDS = [
      '@send', '/send', '@SEND', '/SeNd', 'yes, confirmed. @send',
      'confirmed\n@send to=po', '  @send  ', 'hello /send to=Doctor',
   ];
   const NOT_WHOLE_WORDS = [
      '@sender', '@send-all', 'send', 'me@send.io', '@sen', 'x/send/y', '/send/x', '@@send', '/sends',
   ];
   const WITH_ARGUMENTS = ['@send to=Nobody', '@send to=', '@send to=Doctor task="check it"'];
   const NOT_SENDS = ['go', '', 'as Planner write it', '@start', '@receive', '@handoff to=Doctor'];

   it.each(SENDS)('finds %j as a typed send', text => {
      expect(detectSend(text)).toBe(true);
   });

   it.each(NOT_WHOLE_WORDS)('[H] %j is not a whole word, so not a send', text => {
      expect(detectSend(text)).toBe(false);
   });

   it.each(WITH_ARGUMENTS)('%j is a send: its arguments are not read', text => {
      expect(detectSend(text)).toBe(true);
   });

   it.each(NOT_SENDS)('%j is not a send', text => {
      expect(detectSend(text)).toBe(false);
   });

   it('[H] a text that holds both words is found by both detectors', () => {
      const text = 'please @handoff to=Planner, or else @send to=Doctor';
      expect(detectSend(text)).toBe(true);
      expect(detectHandoff(text)).toBe(true);
   });

   it('[H] a typed send is not an activation', () => {
      expect(detectActivation('@send to=Doctor')).toBeUndefined();
      expect(detectActivation('/send to=Doctor')).toBeUndefined();
   });
});

describe('text that is not an activation', () => {
   // Plain `as` counts only at the start of the text; `@` and `/` forms count anywhere.
   const NOT_AT_THE_START = ['please run as Planner', 'I work as Planner', 'hello\nas Planner'];
   const NOT_THE_COMMAND = [
      'assess the plan', 'assume Planner', 'ask Planner', 'asPlanner', '@asPlanner', '@draft',
      '@drx', '@eprx', '@started', '@startup', '@receiver', 'start', 'receive',
      '/asPlanner', '/draft', '/drx', '/eprx', '/started', '/startup', '/receiver',
      'hello @asPlanner', 'hello @drx', 'hello @started', 'hello /drx', 'hello /started',
      'me@dr.com', 'a@start', 'x/start', '@@dr', '@/dr', '/@dr', '//dr',
      'open /start/x', '/dr/x', 'cd /receive/now',
   ];
   const NEED_A_PREFIX = [
      'dr', 'Dr help me', 'DR', 'dR', 'epr', 'Epr check it', 'ePr', 'hello dr', 'hello epr',
   ];
   const NO_NAME = [
      'as', '@as', '/as', 'as   ', '/as   ', '@as\n', 'as ,', 'as .', 'as ;',
      'hello @as', 'hello /as', 'hello @as ,', '',
   ];

   // Text that looks like a path is not a command: nothing is found and nothing is raised.
   const PATHS = [
      '/path/to/file', 'open /usr/bin/env', 'cat /etc/hosts', 'diff /a/b /c/d',
      'see /home/start/notes.md', 'edit src/dr/index.ts', 'C:/receive/now',
   ];

   // Words that look like commands but are not ours (an agent's own commands, a profile name,
   // anything made up): nothing is found and nothing is raised.
   const UNKNOWN_COMMANDS = [
      '/this-is-not-a-real-command', '/bad', '/bad-command', '/not-real', '/help', '/plan',
      '@this-is-not-a-real-command', '@bad', '@bad-command', '@not-real', '@planner', '@Doctor',
      '/planner', '/Enforcer', '/', '@', '/ ', '@ ',
      '/bad Planner', '@bad Planner', 'hello /bad', 'hello @not-real', 'hello /bad-command now',
      '/bad then plain text', '@bad\n@not-real\n/also-bad',
      'confirmed @handoff', '@handoff to=po',
   ];

   it.each(NOT_AT_THE_START)('[H] %j does not start the text with the command', text => {
      expect(detectActivation(text)).toBeUndefined();
   });

   it.each(NOT_THE_COMMAND)('[H] %j has a first word that is not the command', text => {
      expect(detectActivation(text)).toBeUndefined();
   });

   it.each(NEED_A_PREFIX)('[H] %j needs an @ or / to be an activation', text => {
      expect(detectActivation(text)).toBeUndefined();
   });

   it.each(NO_NAME)('%j gives no name, so it finds nothing', text => {
      expect(detectActivation(text)).toBeUndefined();
   });

   it.each(PATHS)('%j is taken as a path: nothing is found and nothing is raised', text => {
      expect(() => detectActivation(text)).not.toThrow();
      expect(detectActivation(text)).toBeUndefined();
   });

   it.each(UNKNOWN_COMMANDS)('[H] %j is not one of our commands: nothing is found, nothing is raised',
      text => {
         expect(() => detectActivation(text)).not.toThrow();
         expect(detectActivation(text)).toBeUndefined();
      },
   );

   it('an unknown command does not hide a real one that follows it', () => {
      expect(detectActivation('/bad then @dr')).toEqual({ kind: 'user', command: 'dr', name: 'Doctor' });
      expect(detectActivation('@not-real /start')).toEqual({ kind: 'changeover', command: 'start' });
   });
});

// Profile names ---------------------------------------------------------------------------

describe('resolving a profile name', () => {
   const SPELLINGS: Array<[string, string]> = [
      ['Planner', 'Planner'], ['planner', 'Planner'], ['PLANNER', 'Planner'],
      ['PlaNnEr', 'Planner'], ['sTrAtEgIsT', 'Planner'],
      ['po', 'Planner'], ['Po', 'Planner'], ['STRATEGIST', 'Planner'],
      ['doctor', 'Doctor'], ['dOcToR', 'Doctor'],
      ['dr', 'Doctor'], ['DR', 'Doctor'], ['Dr', 'Doctor'], ['dR', 'Doctor'],
      ['medic', 'Doctor'], ['mEdIc', 'Doctor'],
      ['verifier', 'Enforcer'],
      ['pe', 'PromptEngineer'], ['PE', 'PromptEngineer'], ['promptengineer', 'PromptEngineer'],
      ['PrOmPtEnGiNeEr', 'PromptEngineer'],
      ['td', 'TestDesigner'], ['testdesigner', 'TestDesigner'], ['tEsTdEsIgNeR', 'TestDesigner'],
   ];

   it.each(SPELLINGS)('"%s" resolves to the canonical spelling %s', (name, canonical) => {
      expect(NAMES.resolve(name)).toBe(canonical);
   });

   const NOT_PROFILES = [
      ...INHERITED_NAMES, 'prototype', '__defineGetter__', 'nobody', 'plan', 'Planner2', '',
      'Plan ner', 'P lanner', 'Prompt Engineer', 'Test Designer', 'Plan\tner',
   ];

   it.each(NOT_PROFILES)('[H] "%s" is not a profile, and resolving it does not throw', name => {
      expect(NAMES.resolve(name)).toBeUndefined();
   });
});

describe('reading the names file', () => {
   // label, text, the aliases of Alpha
   const TOLERANT: Array<[string, string, string[]]> = [
      ['a trailing comma', '## Alpha\n**Aliases:** one, two,\n\n## Beta\n', ['one', 'two']],
      ['a trailing space', '## Alpha\n**Aliases:** one, two \n\n## Beta\n', ['one', 'two']],
      ['no space after commas', '## Alpha\n**Aliases:** one,two,three\n', ['one', 'two', 'three']],
      ['spaces around commas', '## Alpha\n**Aliases:**   one  ,   two  \n', ['one', 'two']],
      ['emoji aliases', '## Alpha\n**Aliases:** 🩺, 🔎\n', ['🩺', '🔎']],
      ['the Aliases line last', '## Alpha\n\n**Aliases:** one, two\n', ['one', 'two']],
      ['the Aliases line last, no final break', '## Alpha\n\n**Aliases:** one, two', ['one', 'two']],
      [
         'Windows line ends',
         '## Alpha\r\ntext\r\n\r\n**Aliases:** one, two\r\n\r\n## Beta\r\n',
         ['one', 'two'],
      ],
   ];

   it.each(TOLERANT)('reads aliases with %s', (_label, text, aliases) => {
      const names = parseProfileNames(text, LABEL);
      expect(names.canonical).toContain('Alpha');
      for (const alias of aliases) { expect(names.resolve(alias)).toBe('Alpha'); }
      expect(names.resolve('')).toBeUndefined();
      expect(names.resolve(' ')).toBeUndefined();
   });

   it('a profile with no Aliases line resolves by its name only', () => {
      const names = parseProfileNames('## Alpha\nno aliases here\n\n## Beta\n**Aliases:** b1\n', LABEL);
      expect(names.canonical).toEqual(['Alpha', 'Beta']);
      expect(names.resolve('alpha')).toBe('Alpha');
      expect(names.resolve('b1')).toBe('Beta');
   });

   it('only "## " headings are profiles, listed in file order', () => {
      const names = parseProfileNames(`# Title

## Alpha
**Aliases:** a1

### Notes

**Uses:** foundation/*

some prose

## Beta
`, LABEL);
      expect(names.canonical).toEqual(['Alpha', 'Beta']);
      for (const word of ['Title', 'Notes', 'Uses']) { expect(names.resolve(word)).toBeUndefined(); }
   });
});

describe('a duplicate alias', () => {
   // label, text, the alias (any case), the profiles it names
   const DUPLICATES: Array<[string, string, RegExp, string[]]> = [
      [
         'listed by two profiles',
         '## Alpha\n**Aliases:** sharedname\n\n## Beta\n**Aliases:** sharedname\n',
         /sharedname/i, ['Alpha', 'Beta'],
      ],
      [
         'listed by two profiles in different case',
         '## Alpha\n**Aliases:** Sharedname\n\n## Beta\n**Aliases:** sharedname\n',
         /sharedname/i, ['Alpha', 'Beta'],
      ],
      [
         'listed twice by one profile in different case',
         '## Alpha\n**Aliases:** Twice, TWICE\n',
         /twice/i, ['Alpha'],
      ],
   ];

   it.each(DUPLICATES)('[H] %s stops the load, naming the alias, the profiles and the file',
      (_label, text, alias, profiles) => {
         const load = () => parseProfileNames(text, LABEL);
         expect(load).toThrow(ProfileError);
         expect(load).toThrow('duplicate alias');
         expect(load).toThrow(alias);
         expect(load).toThrow(LABEL);
         for (const profile of profiles) { expect(load).toThrow(profile); }
      },
   );
});

describe('loading the names file', () => {
   it('[H] a missing file stops the load, naming the path', () => {
      const missing = join(dirOf(), 'missing.md');
      expect(() => loadProfileNames(missing)).toThrow(ProfileError);
      expect(() => loadProfileNames(missing)).toThrow('cannot be read');
      expect(() => loadProfileNames(missing)).toThrow(missing);
   });

   it('[H] a folder in place of the file stops the load, naming the path', () => {
      const folder = join(dirOf(), '_PROFILES.md');
      mkdirSync(folder);
      expect(() => loadProfileNames(folder)).toThrow(ProfileError);
      expect(() => loadProfileNames(folder)).toThrow(folder);
   });
});

describe('where the names file is', () => {
   it('[H] the default is the shipped file, absolute, whatever the working directory', () => {
      const shipped = fileURLToPath(new URL('../../../rules/_PROFILES.md', import.meta.url));
      const before  = process.cwd();
      process.chdir(dirOf());
      try {
         const found = profilesPath();
         expect(found).toBe(shipped);
         expect(isAbsolute(found)).toBe(true);
         expect(basename(found)).toBe('_PROFILES.md');
         expect(existsSync(found)).toBe(true);
         expect(found.startsWith(dirOf())).toBe(false);
      }
      finally { process.chdir(before); }
   });
});

// The changeover target -------------------------------------------------------------------

describe('reading the changeover target', () => {
   const targetOf = (text: string) =>
      readChangeoverTarget(writeFile(join(dirOf(), 'HANDOFF.md'), text));

   const FOUND: Array<[string, string]> = [
      ['the first line under ## To',      '## To\nPlanner\n\n## From\nBuilder\n'],
      ['blank lines before the name',     '## To\n\n\nPlanner\n## From\n'],
      ['spaces around the name',          '## To\n   Planner   \n## From\n'],
      ['Windows line ends',               '## To\r\nPlanner\r\n## From\r\nBuilder\r\n'],
      ['a second line under the heading', '## To\nPlanner\nDoctor\n'],
      ['a title above the heading',       '# Handoff to Planner\n\n## To\nPlanner\n'],
   ];

   it.each(FOUND)('returns Planner for %s', (_label, text) => {
      expect(targetOf(text)).toBe('Planner');
   });

   it('returns the name as written, not resolved', () => {
      expect(targetOf('## To\npo\n')).toBe('po');
   });

   it('returns a name with a space in it as written; it is not a profile', () => {
      const written = targetOf('## To\nPlan ner\n');
      expect(written).toBe('Plan ner');
      expect(NAMES.resolve(written as string)).toBeUndefined();
   });

   const SECTION_ENDS: Array<[string, string]> = [
      ['a heading right after',   '## To\n\n## Planner\n'],
      ['## To as the last line',  'Planner\n## To'],
      ['## From before the name', '## To\n## From\nPlanner\n'],
   ];

   it.each(SECTION_ENDS)('[H] finds nothing when the section ends first: %s', (_label, text) => {
      expect(targetOf(text)).toBeUndefined();
   });

   const NOT_THE_HEADING: Array<[string, string]> = [
      ['only ## From',        '## From\nPlanner\n'],
      ['only the title',      '# Handoff to Planner\n'],
      ['## to in lower case', '## to\nPlanner\n'],
      ['## To with a colon',  '## To:\nPlanner\n'],
      ['### To',              '### To\nPlanner\n'],
      ['an empty file',       ''],
   ];

   it.each(NOT_THE_HEADING)('[H] finds nothing without an exact ## To heading: %s',
      (_label, text) => {
         expect(targetOf(text)).toBeUndefined();
      },
   );

   it('a missing file gives nothing and does not throw', () => {
      expect(readChangeoverTarget(join(dirOf(), 'missing.md'))).toBeUndefined();
   });

   it('a folder in place of the file gives nothing and does not throw', () => {
      const folder = join(dirOf(), 'HANDOFF.md');
      mkdirSync(folder);
      expect(readChangeoverTarget(folder)).toBeUndefined();
   });
});
