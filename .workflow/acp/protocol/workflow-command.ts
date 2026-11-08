/**
 * Finding the profile a prompt activates, and the profile names the service accepts.
 *
 * A command is a whole word: `@name` or `/name` anywhere in the text, or plain `as` at the
 * start of the text. The first command found decides. Text that only looks like one, such as
 * the path `/etc/hosts`, is not a command and finds nothing. No I/O except the two readers,
 * `loadProfileNames` and `readChangeoverTarget`.
 */
import { readFileSync } from 'node:fs';
import { ProfileError } from './errors.js';

/** The changeover files, under the directory the service starts agents in. Held here, in one place. */
export const HANDOFF_PATH = '.amazonq/work/current/HANDOFF.md';
export const MESSAGE_PATH = '.amazonq/work/current/MESSAGE.md';

export type ActivationCommand = 'as' | 'dr' | 'epr' | 'start' | 'receive';

/** What a prompt asks for: a profile by name (`user`), or the profile a changeover file names. */
export interface Activation {
   kind:    'user' | 'changeover';
   command: ActivationCommand;
   /** The word typed after `as`, or the profile a shortcut stands for. Not set for a changeover. */
   name?:   string;
}

/**
 * The profile each shortcut activates. Each shortcut is a saved prompt that activates one fixed
 * profile, and the service cannot see inside the prompt. With the changeover commands, this is
 * the only fixed workflow vocabulary in the service; a new profile-activating prompt needs a
 * new entry here.
 */
const SHORTCUT_PROFILES = { dr: 'Doctor', epr: 'Enforcer' } as const;

/**
 * Command words, after `@` or `/` (or plain `as`), that activate a profile. Other commands don't
 * matter for our current purposes and are ignored.
 */
const COMMANDS: readonly string[] = ['as', 'dr', 'epr', 'start', 'receive'];

/** The command a word is, or undefined. Plain `as` counts only as the first word. */
function commandOf(word: string, first: boolean): ActivationCommand | undefined
{
   const lower = word.toLowerCase();
   if (first && 'as' === lower) { return 'as'; }
   const prefixed = '@' === lower[0] || '/' === lower[0];
   const rest     = lower.slice(1);
   return prefixed && COMMANDS.includes(rest) ? rest as ActivationCommand : undefined;
}

/** The name after `as`: the next word without one trailing `,.:;`; undefined when empty. */
function nameAfter(next: string | undefined): string | undefined
{
   const name = (next ?? '').replace(/[,.:;]$/, '');
   return '' === name ? undefined : name;
}

/** The activation in `text`, or undefined. Case does not matter; the name is returned as typed. */
export function detectActivation(text: string): Activation | undefined
{
   const words = text.match(/\S+/g) ?? [];
   for (let at = 0; at < words.length; at++) {
      const command = commandOf(words[at], 0 === at);
      if (undefined === command) { continue; }
      if ('start' === command || 'receive' === command) { return { kind: 'changeover', command }; }
      if ('as' !== command) { return { kind: 'user', command, name: SHORTCUT_PROFILES[command] }; }
      const name = nameAfter(words[at + 1]);
      return undefined === name ? undefined : { kind: 'user', command, name };
   }
   return undefined;
}

export interface ProfileNames {
   /** The canonical spelling of a profile name or alias, ignoring case; undefined for any other word. */
   resolve(name: string): string | undefined;
   /** The canonical names, in file order. */
   canonical: string[];
}

/**
 * Reads the profile names from `_PROFILES.md`-shaped text: each `## ` heading is a canonical
 * name, and the `**Aliases:**` line under it adds comma-separated aliases. `label` names the
 * source in errors. An alias listed twice, in one profile or across profiles and without regard
 * to case, throws `ProfileError`. An alias never replaces a canonical name.
 */
export function parseProfileNames(text: string, label: string): ProfileNames
{
   const profiles: Array<{ name: string; aliases: string[] }> = [];
   let current: { name: string; aliases: string[] } | undefined;

   for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('## ')) {
         const name = line.slice(3).trim();
         current = '' === name ? undefined : { name, aliases: [] };
         if (undefined !== current) { profiles.push(current); }
      }
      else if (undefined !== current && line.startsWith('**Aliases:**')) {
         const listed = line.slice('**Aliases:**'.length).split(',').map(alias => alias.trim());
         current.aliases.push(...listed.filter(alias => '' !== alias));
      }
   }

   // A Map, so that words every object has (`constructor`) are just unknown words.
   const names = new Map<string, string>();
   for (const { name } of profiles) {
      if (!names.has(name.toLowerCase())) { names.set(name.toLowerCase(), name); }
   }

   const owners = new Map<string, string>();
   for (const { name, aliases } of profiles) {
      for (const alias of aliases) {
         const key   = alias.toLowerCase();
         const owner = owners.get(key);
         if (undefined !== owner) {
            const who = owner === name ? name : `${owner} and ${name}`;
            throw new ProfileError(`profile names file ${label} has a duplicate alias "${alias}" (${who})`);
         }
         owners.set(key, name);
         if (!names.has(key)) { names.set(key, name); }
      }
   }

   return {
      canonical: profiles.map(profile => profile.name),
      resolve:   name => names.get(name.toLowerCase()),
   };
}

/** Reads and parses the profile names file. A file that is missing or unreadable throws `ProfileError`. */
export function loadProfileNames(path: string): ProfileNames
{
   let text: string;
   try { text = readFileSync(path, 'utf8'); }
   catch (cause) {
      throw new ProfileError(`profile names file is missing or cannot be read: ${path}`, cause);
   }
   return parseProfileNames(text, path);
}

/**
 * The first non-empty line under an exact `## To` heading of a changeover file, trimmed and as
 * written, or undefined: no such heading, nothing under it before the next heading, or a file
 * that cannot be read. Never throws.
 */
export function readChangeoverTarget(path: string): string | undefined
{
   let text: string;
   try { text = readFileSync(path, 'utf8'); }
   catch { return undefined; }

   let inTo = false;
   for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('#')) {
         if (inTo) { return undefined; }
         inTo = '## To' === line;
      }
      else if (inTo && '' !== line) { return line; }
   }
   return undefined;
}
