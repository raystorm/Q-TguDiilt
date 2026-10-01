import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadGovernanceConfig, evaluateCommand } from '../engine.js';

/**
 * Verifies the shipped default `governance/config.yaml` policy. Two kinds
 * of coverage: (1) a broad table of commands that should simply approve,
 * and (2) the dangerous-variant-before-general-approve orderings that are
 * load-bearing (first-match-wins) — a future edit that reorders these
 * rules should fail this suite rather than silently widen auto-approval.
 */
const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'config.yaml');
const config = loadGovernanceConfig(CONFIG_PATH);

function actionFor(command: string): string {
   return evaluateCommand(config, command).action;
}

describe('default config.yaml — read-only / inert commands approve', () => {
   it.each([
      'npm test', 'npm run test:unit', 'npm list', 'npm outdated', 'node --version',
      'env', 'pwd', 'cd ..', 'whoami', 'id', 'uname -a', 'hostname', 'which node', 'type node', 'test -f x',
      'ls', 'ls -la', 'cat file.txt', 'head file.txt', 'tail -f file.txt', 'less file.txt', 'more file.txt',
      'wc -l file.txt', 'file file.txt', 'stat file.txt', 'du -sh .', 'df -h', 'tree .', 'locate foo',
      'echo hi', 'grep foo file.txt', 'egrep foo file.txt', 'fgrep foo file.txt', 'rg foo', 'ag foo',
      'sort file.txt', 'uniq file.txt', 'cut -d, -f1 file.txt', 'tr a-z A-Z', 'diff a.txt b.txt', 'comm a b',
      'column -t file.txt', 'nl file.txt', 'paste a b', 'join a b', 'man ls', 'info ls', 'help cd',
      'git status', 'git diff', 'git log', 'git show HEAD', 'git branch', 'git remote -v', 'git blame file.txt',
   ])('%s -> approve', command => { expect(actionFor(command)).toBe('approve'); });
});

describe('default config.yaml — exact-match-only rules do not widen to arguments', () => {
   it.each([
      ['npx tsc --noEmit', 'approve'],
      ['npx tsc --noEmit --project foo', 'ask'],
      ['npx tsc --watch', 'ask'],
      ['env', 'approve'],
      ['env VAR=x npm test', 'ask'],
   ])('%s -> %s', (command, expected) => { expect(actionFor(command)).toBe(expected); });
});

describe('default config.yaml — dangerous-variant-first ordering is load-bearing', () => {
   it.each([
      ['date -s "12:00"', 'deny'],
      ['date --set=12:00', 'deny'],
      ['date', 'approve'],
      ['date +%Y-%m-%d', 'approve'],
      ["sed -i 's/a/b/' file.txt", 'ask'],
      ["sed 's/a/b/' file.txt", 'approve'],
      ['awk \'{ system("ls") }\' file.txt', 'ask'],
      ["awk '{ print $1 }' file.txt", 'approve'],
      ['git checkout main', 'deny'],
      ['git commit -m "x"', 'ask'],
      ['npm run deploy', 'deny'],
      ['npm run build', 'ask'],
   ])('%s -> %s', (command, expected) => { expect(actionFor(command)).toBe(expected); });
});

describe('default config.yaml — unmatched command falls to default ask', () => {
   it('an unrecognized command -> ask', () => {
      expect(actionFor('curl https://example.com')).toBe('ask');
   });

   it('find (no safe subset) -> ask', () => {
      expect(actionFor('find . -name "*.txt"')).toBe('ask');
   });
});
