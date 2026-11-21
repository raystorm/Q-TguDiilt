import { resolve } from 'node:path';
import { apply, outcome, type Result } from './apply.js';
import type { Io } from './io.js';
import { plan } from './plan.js';

interface Command
{
   target: string;
   dryRun: boolean;
   force:  boolean;
}

const USAGE = 'usage: node installer/install.mjs <target> [--dry-run] [--force]';

/** The command line, or what is wrong with it. */
function parse(argv: string[]): Command | string
{
   let target: string | undefined;
   let dryRun = false;
   let force  = false;
   for (const arg of argv)
   {
      if ('--dry-run' === arg) { dryRun = true; }
      else if ('--force' === arg) { force = true; }
      else if (undefined === target && !arg.startsWith('--')) { target = arg; }
      else { return `unexpected argument ${arg}`; }
   }
   return undefined === target ? 'no target folder given' : { target, dryRun, force };
}

/** A refused command line: the problem, the usage, and a failure code. Nothing is written. */
const refuse = (problem: string): Result => ({ code: 1, lines: [`error: ${problem}`, USAGE] });

/**
 * Parses the command line, plans the install of the engine at `source` into the target folder, and
 * writes it, or with `--dry-run` only reports it. The target must already be a folder.
 */
export function run(argv: string[], io: Io, source: string): Result
{
   const command = parse(argv);
   if ('string' === typeof command) { return refuse(command); }

   const target = resolve(command.target);
   const kind   = io.stat(target);
   if ('dir' !== kind) { return refuse(`${target} ${null === kind ? 'does not exist' : 'is not a folder'}`); }

   const planned = plan(io, source, target, command.force);
   return command.dryRun ? outcome(planned) : apply(planned, io);
}
