import { describe, it, expect } from 'vitest';
import { evaluateCommand } from '../engine.js';
import type { GovernanceConfig } from '../types.js';

/**
 * Security-focused tests for compound-command evaluation: segment
 * splitting on shell composition/redirection operators (via `shell-quote`),
 * most-restrictive-wins reduction across segments, and fail-closed (ask)
 * behavior on anything that cannot be safely parsed (command substitution,
 * unbalanced quotes, parser errors). Escalated to TestDesigner for
 * adversarial review after initial implementation — see FEATURE.md A4b
 * Deferred Items.
 */

const CONFIG: GovernanceConfig = {
   rules: [
      { pattern: 'cat *',       action: 'approve' },
      { pattern: 'ls *',        action: 'approve' },
      { pattern: 'echo *',      action: 'approve' },
      { pattern: 'rm -rf *',    action: 'deny' },
      { pattern: 'git commit*', action: 'ask' },
   ],
   default: 'ask',
};

describe('compound commands — segment splitting', () => {
   it('a single simple command evaluates unchanged (no operators)', () => {
      expect(evaluateCommand(CONFIG, 'cat myFile').action).toBe('approve');
   });

   it('pipe composes two approved segments -> approve', () => {
      expect(evaluateCommand(CONFIG, 'cat myFile | ls').action).toBe('approve');
   });

   it('redirect forces ask even when the preceding command would approve', () => {
      // `cat myFile > someOtherCommand` — the redirect is itself a side
      // effect (writes/overwrites a file); most-restrictive-wins means an
      // unevaluated redirect target must not silently ride along with an
      // approved command.
      const decision = evaluateCommand(CONFIG, 'cat myFile > someOtherCommand');
      expect(decision.action).toBe('ask');
   });

   it('&& composes two approved segments -> approve', () => {
      expect(evaluateCommand(CONFIG, 'cat a.txt && ls b').action).toBe('approve');
   });

   it('most-restrictive-wins: approve segment + deny segment -> deny', () => {
      const decision = evaluateCommand(CONFIG, 'cat a.txt && rm -rf b');
      expect(decision.action).toBe('deny');
   });

   it('most-restrictive-wins: approve segment + ask segment -> ask', () => {
      const decision = evaluateCommand(CONFIG, 'cat a.txt && git commit -m x');
      expect(decision.action).toBe('ask');
   });

   it('most-restrictive-wins: deny beats ask when both present', () => {
      const decision = evaluateCommand(CONFIG, 'git commit -m x && rm -rf b');
      expect(decision.action).toBe('deny');
   });

   it('semicolon-separated commands are evaluated independently', () => {
      const decision = evaluateCommand(CONFIG, 'cat a.txt; rm -rf b');
      expect(decision.action).toBe('deny');
   });

   it('background operator (&) segments independently', () => {
      const decision = evaluateCommand(CONFIG, 'cat a.txt & rm -rf b');
      expect(decision.action).toBe('deny');
   });

   it('|| segments independently', () => {
      const decision = evaluateCommand(CONFIG, 'cat a.txt || rm -rf b');
      expect(decision.action).toBe('deny');
   });

   it('operator characters inside single-quoted args do not split', () => {
      const decision = evaluateCommand(CONFIG, "echo 'a | b ; c'");
      expect(decision.action).toBe('approve');
   });

   it('operator characters inside double-quoted args do not split', () => {
      const decision = evaluateCommand(CONFIG, 'echo "a && b"');
      expect(decision.action).toBe('approve');
   });

   it('three-way chain: all approved -> approve', () => {
      const decision = evaluateCommand(CONFIG, 'cat a.txt && ls b && echo done');
      expect(decision.action).toBe('approve');
   });

   it('three-way chain: one deny among approves -> deny', () => {
      const decision = evaluateCommand(CONFIG, 'cat a.txt && rm -rf b && echo done');
      expect(decision.action).toBe('deny');
   });
});

describe('compound commands — fail-closed on unparseable input', () => {
   it('command substitution with $(...) forces ask, never auto-approve/deny', () => {
      const decision = evaluateCommand(CONFIG, 'cat $(whoami).txt');
      expect(decision.action).toBe('ask');
   });

   it('command substitution with backticks forces ask', () => {
      const decision = evaluateCommand(CONFIG, 'cat `whoami`.txt');
      expect(decision.action).toBe('ask');
   });

   it('command substitution embedded in an otherwise-denied segment still asks, not silently denies or approves', () => {
      const decision = evaluateCommand(CONFIG, 'rm -rf $(echo /)');
      expect(decision.action).toBe('ask');
   });

   it('unbalanced double quote forces ask', () => {
      const decision = evaluateCommand(CONFIG, 'echo "unterminated');
      expect(decision.action).toBe('ask');
   });

   it('unbalanced single quote forces ask', () => {
      const decision = evaluateCommand(CONFIG, "echo 'unterminated");
      expect(decision.action).toBe('ask');
   });

   it('malformed parameter expansion forces ask', () => {
      const decision = evaluateCommand(CONFIG, 'echo ${}');
      expect(decision.action).toBe('ask');
   });

   it('unparseable input does not populate matchedRule', () => {
      const decision = evaluateCommand(CONFIG, 'cat $(whoami).txt');
      expect(decision.matchedRule).toBeUndefined();
   });

   it('unparseable input still enriches ask details with the full original command', () => {
      const decision = evaluateCommand(CONFIG, 'cat $(whoami).txt');
      expect(decision.details?.command).toBe('cat $(whoami).txt');
   });
});

describe('compound commands — newline and comment rejection', () => {
   // `shell-quote` silently drops newline, comment, and similar tokens
   // instead of treating them as command separators, so a hidden command
   // after one of these characters would otherwise ride along with the
   // visible command's decision. These must fail closed to `ask`.

   it('newline-separated hidden command forces ask, never silently approves', () => {
      const decision = evaluateCommand(CONFIG, 'ls\nrm -rf /');
      expect(decision.action).toBe('ask');
   });

   it('CRLF-separated hidden command forces ask', () => {
      const decision = evaluateCommand(CONFIG, 'ls\r\nrm -rf /');
      expect(decision.action).toBe('ask');
   });

   it('comment hiding a newline-separated command forces ask', () => {
      const decision = evaluateCommand(CONFIG, 'ls # comment\nrm -rf /');
      expect(decision.action).toBe('ask');
   });

   it('tab-separated hidden command forces ask', () => {
      const decision = evaluateCommand(CONFIG, 'ls\trm -rf /');
      expect(decision.action).toBe('ask');
   });

   it('bare shell comment marker forces ask', () => {
      const decision = evaluateCommand(CONFIG, 'ls # rm -rf /');
      expect(decision.action).toBe('ask');
   });

   it('multiple chained newlines force ask', () => {
      const decision = evaluateCommand(CONFIG, 'ls\n\nrm -rf /\necho done');
      expect(decision.action).toBe('ask');
   });

   it('newline-containing input does not populate matchedRule', () => {
      const decision = evaluateCommand(CONFIG, 'ls\nrm -rf /');
      expect(decision.matchedRule).toBeUndefined();
   });

   it('newline-containing input still enriches ask details with the full original command', () => {
      const decision = evaluateCommand(CONFIG, 'ls\nrm -rf /');
      expect(decision.details?.command).toBe('ls\nrm -rf /');
   });
});

describe('compound commands — ask enrichment reflects the whole original command', () => {
   it('an ask decision from a compound command carries the full original command string', () => {
      const decision = evaluateCommand(CONFIG, 'cat a.txt && git commit -m x');
      expect(decision.details?.command).toBe('cat a.txt && git commit -m x');
   });
});
