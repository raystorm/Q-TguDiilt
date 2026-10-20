import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { evaluateCommand, loadGovernanceConfig } from '../engine.js';
import { type CaseLine, readAccepted, readCases } from './command-cases/cases.js';

const HERE   = dirname(fileURLToPath(import.meta.url));
const config = loadGovernanceConfig(join(HERE, '..', 'config.yaml'));
const decide = (text: string) => evaluateCommand(config, text);

/**
 * The cases whose decision is not one of `allowed`, each with what it got, so that
 * one failure lists every finding of a case file.
 */
const outside = (cases: CaseLine[], allowed: string[]) =>
   cases
      .map(({ text }) => ({ text, action: decide(text).action }))
      .filter(({ action }) => !allowed.includes(action))
      .map(({ text, action }) => `${action}: ${JSON.stringify(text)}`);

describe('security cases over the shipped config', () => {
   it('[H] controls: every control is approved', () => {
      expect(outside(readCases('c1-controls.txt'), ['approve'])).toEqual([]);
   });

   it('[H] operators: operators and redirects are never approved', () => {
      expect(outside(readCases('c2-operators.txt'), ['ask', 'deny'])).toEqual([]);
   });

   it('[H] operators: the two deploy lines are denied, not only asked about', () => {
      const deploy = readCases('c2-operators.txt').filter(({ text }) => text.includes('npm run deploy'));
      expect(deploy).toHaveLength(2);
      expect(outside(deploy, ['deny'])).toEqual([]);
   });

   it('[H] unparseable: input the engine cannot parse is ask, '
      + 'with no matched rule and the full original command', () => {
      const wrong = readCases('c3-unparseable.txt').flatMap(({ text }) => {
         const decision = decide(text);
         const ok = 'ask' === decision.action
            && undefined === decision.matchedRule
            && text === decision.details?.command;
         return ok ? [] : [`${decision.action}: ${JSON.stringify(text)}`];
      });
      expect(wrong).toEqual([]);
   });

   it('[H] destructive: plain destructive commands are never approved', () => {
      expect(outside(readCases('c8-destructive.txt'), ['ask', 'deny'])).toEqual([]);
   });

   describe('option abuse: approved commands used with options that write or run things', () => {
      const cases    = readCases('c4-option-abuse.txt', true);
      const approved = cases.filter(({ text }) => 'approve' === decide(text).action);
      const accepted = readAccepted('accepted-findings.txt');

      it('[H] no primary-tier case (P:) is approved: blocking', () => {
         expect(approved.filter(({ tier }) => 'P' === tier).map(({ text }) => text)).toEqual([]);
      });

      it('[H] every approved secondary-tier case (S:) is on the accepted list, to be triaged otherwise', () => {
         const untriaged = approved.filter(({ tier, text }) => 'S' === tier && !accepted.has(text));
         expect(untriaged.map(({ text }) => text)).toEqual([]);
      });

      it('the accepted list holds only secondary-tier cases of this file that are still approved', () => {
         const stillApproved = new Set(approved.filter(({ tier }) => 'S' === tier).map(({ text }) => text));
         expect([...accepted.keys()].filter(text => !stillApproved.has(text))).toEqual([]);
         expect([...accepted.values()].filter(({ tier }) => 'S' !== tier)).toEqual([]);
      });
   });

   describe('boundaries: where a rule stops matching', () => {
      const [first, ...rest] = readCases('c5-boundaries.txt');

      it('[H] the two-space line is approved', () => {
         expect(first.text).toBe('ls  -la');
         expect(decide(first.text).action).toBe('approve');
      });

      // `npm run testx` is a known shape of the config's `npm run test*` rule; accepted, pinned here.
      it('[H] no other line is approved except the pinned npm run test* shape', () => {
         const approved = rest.filter(({ text }) => 'approve' === decide(text).action).map(({ text }) => text);
         expect(approved).toEqual(['npm run testx']);
      });
   });

   it('[H] expansion: every line that expands a variable is ask', () => {
      const withVariable = readCases('c7-expansion.txt').filter(({ text }) => text.includes('$'));
      expect(withVariable.map(({ text }) => text))
         .toEqual(['$CMD', '${CMD} -la', 'sed $OPTS s/a/b/ f', 'cat $F', 'ls ${X}', 'echo ${IFS}']);
      expect(outside(withVariable, ['ask'])).toEqual([]);
   });
});

describe('quoting and wrappers over the shipped config', () => {
   it.each([
      'git "checkout" x', 'g"i"t checkout x', 'git\\ checkout x', '\'git\' checkout x',
   ])('[H] "git checkout x" written as %s is not approved', command => {
      expect(decide(command).action).not.toBe('approve');
   });

   it.each([
      "bash -c 'ls'", 'sh -c ls', 'eval ls', 'exec ls', 'command ls', 'nohup ls', 'time ls', 'timeout 5 ls',
      'xargs ls', 'find . -exec ls {} ;', 'sudo ls', "python -c 'print(1)'", "node -e '1'", 'source ./x', '. ./x',
   ])('[H] the wrapper or shell %s is ask or deny', command => {
      expect(['ask', 'deny']).toContain(decide(command).action);
   });
});
