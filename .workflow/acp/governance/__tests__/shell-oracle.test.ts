import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateCommand, loadGovernanceConfig, splitCommandSegments } from '../engine.js';
import { readAccepted, readCases } from './command-cases/cases.js';

const config = loadGovernanceConfig(join(dirname(fileURLToPath(import.meta.url)), '..', 'config.yaml'));
const BASH   = ['/bin/bash', '/usr/bin/bash'].find(existsSync);

const accepted = readAccepted('accepted-oracle-findings.txt');

/** Every stub prints its name and its arguments, if it has any, to the log, and nothing else. */
const STUB = '#!/bin/sh\nprintf \'%s\\n\' "${0##*/}${1+ $*}" >> "$ORACLE_LOG"\n';

/** The first word of each approve rule's pattern: the programs governance lets through. */
const APPROVED_WORDS = [...new Set(
   config.rules
      .filter(rule => 'approve' === rule.action && undefined !== rule.pattern)
      .map(rule => (rule.pattern as string).split(' ')[0])
      .filter(word => /^[\w.+-]+$/.test(word)),
)];

describe.skipIf('win32' === process.platform || undefined === BASH)(
   'what the shell would run equals what governance saw',
   () => {
      let dir: string;
      let log: string;
      let programs: Set<string>;

      beforeAll(() => {
         dir = mkdtempSync(join(tmpdir(), 'oracle-'));
         log = join(dir, 'log');
         mkdirSync(join(dir, 'bin'));
         mkdirSync(join(dir, 'work', 'src'), { recursive: true });
         const builtins = new Set(
            spawnSync(BASH as string, ['-c', 'compgen -b'], { encoding: 'utf8' }).stdout.split('\n'),
         );
         programs = new Set(APPROVED_WORDS.filter(word => !builtins.has(word)));
         for (const name of programs) {
            const file = join(dir, 'bin', name);
            writeFileSync(file, STUB);
            chmodSync(file, 0o755);
         }
      });
      afterAll(() => rmSync(dir, { recursive: true, force: true }));

      /** Runs the line in bash with only the stubs on PATH; returns what ran and what bash said. */
      function runInBash(line: string) {
         writeFileSync(log, '');
         // OPTS is set so that a line such as `sed $OPTS ...` shows what the shell would really run.
         const result = spawnSync(BASH as string, ['--noprofile', '--norc', '-c', line], {
            cwd: join(dir, 'work'), encoding: 'utf8', timeout: 5000,
            env: { PATH: join(dir, 'bin'), ORACLE_LOG: log, OPTS: '-i' },
         });
         return { ran: readFileSync(log, 'utf8').split('\n').filter(entry => '' !== entry), said: result.stderr };
      }

      /** What differs between what the shell did and the segments governance evaluated. */
      function problemsWith(line: string): string[] {
         const split = splitCommandSegments(line);
         if (null === split) { return ['approved although the engine cannot split it']; }
         // An expanded empty variable leaves a trailing space in the segment that the shell never sees.
         const seen = split.segments
            .filter(segment => programs.has(segment.split(' ')[0]))
            .map(segment => segment.trimEnd())
            .sort();
         let outcome: ReturnType<typeof runInBash>;
         // A NUL character cannot be passed to a process at all.
         try { outcome = runInBash(line); }
         catch { return []; }
         const problems: string[] = [];
         if (/command not found|syntax error/.test(outcome.said)) {
            problems.push(`the shell said: ${outcome.said.trim()}`);
         }
         if (JSON.stringify([...outcome.ran].sort()) !== JSON.stringify(seen)) {
            problems.push(`the shell ran ${JSON.stringify(outcome.ran)}, governance saw ${JSON.stringify(seen)}`);
         }
         return problems;
      }

      const approvedIn = (...files: string[]) => files
         .flatMap(file => readCases(file))
         .map(({ text }) => text)
         .filter(text => 'approve' === evaluateCommand(config, text).action);

      it('the oracle records what a stub is run with', () => {
         expect(runInBash('ls  -la src').ran).toEqual(['ls -la src']);
      });

      it.each([
         ['controls and boundaries', ['c1-controls.txt', 'c5-boundaries.txt']],
         ['odd characters',          ['c6-odd-characters.txt']],
         ['expansion',               ['c7-expansion.txt']],
      ])('[H] %s: every approved line is run as governance saw it', (_name, files) => {
         const found = approvedIn(...files).filter(line => !accepted.has(line))
            .flatMap(line => problemsWith(line).map(problem => `${JSON.stringify(line)}: ${problem}`));
         expect(found).toEqual([]);
      });

      it('the accepted list holds only secondary-tier lines that are still approved and still differ', () => {
         const stale = [...accepted.keys()].filter(line =>
            'approve' !== evaluateCommand(config, line).action || 0 === problemsWith(line).length);
         expect(stale).toEqual([]);
         expect([...accepted.values()].filter(({ tier }) => 'S' !== tier)).toEqual([]);
      });

      it('the controls are approved, so the oracle checks something', () => {
         expect(approvedIn('c1-controls.txt').length).toBeGreaterThan(0);
      });
   },
);
