import { basename, join, resolve } from 'node:path';
import type { Contents, Io } from './io.js';
import { manifest } from './manifest.js';
import { isRecord } from './marker.js';
import type { Stop, Warning } from './plan.js';

/**
 * The registration of the service in the IDE: one entry under `agent_servers` in `acp.json`. The file
 * can hold secrets, so nothing here reports any of its content beyond our own entry.
 */
export interface Registration
{
   /** The `acp.json` path, as the user knows it. */
   path:     string;
   /** The file that is read and replaced: the path with links resolved. */
   real:     string;
   key:      string;
   command:  string;
   args:     string[];
   /** Whether the key is new in the file, as opposed to an entry of ours that is changed. */
   added:    boolean;
   /** `create`: there is no file yet. `update`: the file is rewritten. `skip`: our entry is already right. */
   kind:     'create' | 'update' | 'skip';
   /** The text of the new file. */
   text:     string;
   /** The file as it was; null when there was none. */
   original: Contents | null;
}

/** What `planRegistration` found. A stop leaves `registration` null. */
export interface Registered
{
   registration: Registration | null;
   warnings:     Warning[];
   stops:        Stop[];
}

/** The parsed file, or why it cannot be used. The reason never holds the file's content. */
function parseObject(text: string): Record<string, unknown> | string
{
   let value: unknown;
   try { value = JSON.parse(text); }
   catch { return 'is not valid JSON'; }
   return isRecord(value) ? value : 'does not hold a JSON object';
}

/** Whether an entry starts the service at `start`. */
const holds = (entry: unknown, start: string) =>
   isRecord(entry) && Array.isArray(entry.args) && entry.args.includes(start);

/**
 * Reads `<home>/.jetbrains/acp.json` and works out the entry for the target: the key, `io.node` as the
 * command and the launcher as the only argument. Writes nothing. A file that cannot be used, or a key
 * that belongs to another project, is a stop. Keys are looked up and written as own properties only.
 */
export function planRegistration(io: Io, target: string, name: string | null): Registered
{
   const path  = join(io.home, '.jetbrains', 'acp.json');
   const start = resolve(target, manifest.launcher);
   const key   = name ?? `Q-TguDiilt (${basename(target)})`;
   const stop  = (detail: string): Registered => ({ registration: null, warnings: [], stops: [{ detail }] });

   const kind = io.stat(path);
   if (null === kind && io.isLink(path)) { return stop(`${path} is a link to nothing`); }
   if ('dir' === kind) { return stop(`${path} is a folder, or a link to one`); }
   if ('other' === kind) { return stop(`${path} is not a file`); }

   const real     = null === kind ? path : io.realPath(path);
   const original = null === kind ? null : io.read(real);
   let config: Record<string, unknown> = {};
   if (null !== original)
   {
      const parsed = parseObject(original.data.toString('utf8'));
      if ('string' === typeof parsed) { return stop(`${path} ${parsed}`); }
      config = parsed;
   }

   const servers = Object.hasOwn(config, 'agent_servers') ? config.agent_servers : {};
   if (!isRecord(servers)) { return stop(`${path}: agent_servers is not an object`); }

   const quoted = JSON.stringify(key);
   const old    = Object.hasOwn(servers, key) ? servers[key] : undefined;
   if (undefined !== old && !isRecord(old)) { return stop(`${path}: the entry ${quoted} is not an object`); }
   if (undefined !== old && !holds(old, start))
   {
      return stop(`${path} has an entry ${quoted} for another start file; pass --name <key> to use another`);
   }

   const entry = { ...old, command: io.node, args: [start] };
   const same  = undefined !== old && old.command === io.node
      && JSON.stringify(old.args) === JSON.stringify(entry.args);
   const next  = { ...servers };
   Object.defineProperty(next, key, { value: entry, enumerable: true, writable: true, configurable: true });

   const warnings = Object.entries(servers)
      .filter(([other, value]) => other !== key && holds(value, start))
      .map(([other]) => ({ path, detail: `the entry ${JSON.stringify(other)} also starts this project` }));
   return {
      registration: {
         path, real, key, command: io.node, args: entry.args, original,
         added: undefined === old,
         kind: same ? 'skip' : null === original ? 'create' : 'update',
         text: `${JSON.stringify({ ...config, agent_servers: next }, null, 2)}\n`,
      },
      warnings,
      stops: [],
   };
}

/**
 * Writes the registration: the backup once (never over an old one), then the new text to a temporary
 * file in the same folder, then a rename onto the file. A failure leaves the file as it was, removes
 * the temporary file and the backup this run made (it saves nothing that happened), and is thrown.
 */
export function writeRegistration(io: Io, registration: Registration): void
{
   const { real, original, text } = registration;
   const mode   = io.mode(real);
   const backup = `${real}.bak`;
   const temp   = `${real}.tmp`;
   const saved  = null === original || null !== io.stat(backup) ? null : original;
   try
   {
      if (null !== saved) { io.write(backup, saved.data, false, mode ?? undefined); }
      io.write(temp, Buffer.from(text), false, mode ?? 0o644);
      io.rename(temp, real);
   }
   catch (error)
   {
      for (const path of null === saved ? [temp] : [temp, backup])
      {
         if (null !== io.stat(path)) { io.remove(path); }
      }
      throw error;
   }
}
