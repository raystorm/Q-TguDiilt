import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGovernanceConfig, evaluateCommand, createGovernanceEngine } from '../engine.js';
import {
   GovernanceConfigMissingError,
   GovernanceConfigParseError,
   GovernanceConfigInvalidError,
} from '../errors.js';

let dir: string;

beforeEach(() => {
   dir = mkdtempSync(join(tmpdir(), 'governance-test-'));
});

afterEach(() => {
   rmSync(dir, { recursive: true, force: true });
});

function writeConfig(yaml: string): string {
   const filePath = join(dir, 'governance.yaml');
   writeFileSync(filePath, yaml);
   return filePath;
}

function createLogger() {
   const entries: Array<{ level: string; event: string; data: any }> = [];
   return {
      entries,
      debug: (event: string, data: any = {}) => { entries.push({ level: 'debug', event, data }); },
      info:  (event: string, data: any = {}) => { entries.push({ level: 'info',  event, data }); },
      warn:  (event: string, data: any = {}) => { entries.push({ level: 'warn',  event, data }); },
      error: (event: string, data: any = {}) => { entries.push({ level: 'error', event, data }); },
   };
}

// Group 1: Config Parsing ----------------------------------------------------

describe('Group 1 — config parsing', () => {
   it('parses a minimal valid config (rules + default)', () => {
      const filePath = writeConfig(`
governance:
  rules:
    - pattern: "npm test"
      action: approve
  default: ask
`);
      const config = loadGovernanceConfig(filePath);
      expect(config.rules).toEqual([{ pattern: 'npm test', action: 'approve' }]);
      expect(config.default).toBe('ask');
   });

   it('parses multiple rules preserving order', () => {
      const filePath = writeConfig(`
governance:
  rules:
    - pattern: "npm test"
      action: approve
    - pattern: "npm deploy"
      action: deny
  default: ask
`);
      const config = loadGovernanceConfig(filePath);
      expect(config.rules.map(r => r.pattern)).toEqual(['npm test', 'npm deploy']);
   });

   it('defaults `default` to "ask" when omitted', () => {
      const filePath = writeConfig(`
governance:
  rules:
    - pattern: "npm test"
      action: approve
`);
      const config = loadGovernanceConfig(filePath);
      expect(config.default).toBe('ask');
   });

   it('accepts an empty rules list', () => {
      const filePath = writeConfig(`
governance:
  rules: []
  default: deny
`);
      const config = loadGovernanceConfig(filePath);
      expect(config.rules).toEqual([]);
      expect(config.default).toBe('deny');
   });

   it('accepts all three action values in rules', () => {
      const filePath = writeConfig(`
governance:
  rules:
    - pattern: "a"
      action: approve
    - pattern: "b"
      action: deny
    - pattern: "c"
      action: ask
  default: ask
`);
      const config = loadGovernanceConfig(filePath);
      expect(config.rules.map(r => r.action)).toEqual(['approve', 'deny', 'ask']);
   });
});

// Group 2: Pattern Matching / First-Match-Wins -------------------------------

describe('Group 2 — pattern matching, first-match-wins', () => {
   it('matches an exact literal pattern against the full command', () => {
      const config = { rules: [{ pattern: 'npm test', action: 'approve' as const }], default: 'ask' as const };
      const decision = evaluateCommand(config, 'npm test');
      expect(decision.action).toBe('approve');
      expect(decision.matchedRule).toBe('npm test');
   });

   it('does not match on substring — full string glob semantics', () => {
      const config = { rules: [{ pattern: 'npm test', action: 'approve' as const }], default: 'ask' as const };
      const decision = evaluateCommand(config, 'npm test -- --watch');
      expect(decision.action).toBe('ask');
      expect(decision.matchedRule).toBeUndefined();
   });

   it('matches using glob wildcard `*`', () => {
      const config = { rules: [{ pattern: 'npm test*', action: 'approve' as const }], default: 'ask' as const };
      const decision = evaluateCommand(config, 'npm test --watch');
      expect(decision.action).toBe('approve');
   });

   it('matches using glob wildcard across whole command', () => {
      const config = { rules: [{ pattern: 'npm *', action: 'approve' as const }], default: 'ask' as const };
      const decision = evaluateCommand(config, 'npm run build');
      expect(decision.action).toBe('approve');
   });

   it('first-match-wins: earlier rule takes priority over a later match', () => {
      const config = {
         rules: [
            { pattern: 'npm *',      action: 'ask' as const },
            { pattern: 'npm test',   action: 'approve' as const },
         ],
         default: 'deny' as const,
      };
      const decision = evaluateCommand(config, 'npm test');
      expect(decision.action).toBe('ask');
      expect(decision.matchedRule).toBe('npm *');
   });

   it('falls through to a later rule when earlier rules do not match', () => {
      const config = {
         rules: [
            { pattern: 'npm deploy', action: 'deny' as const },
            { pattern: 'npm test',   action: 'approve' as const },
         ],
         default: 'ask' as const,
      };
      const decision = evaluateCommand(config, 'npm test');
      expect(decision.action).toBe('approve');
      expect(decision.matchedRule).toBe('npm test');
   });

   it('falls through to `default` when no rule matches', () => {
      const config = { rules: [{ pattern: 'npm deploy', action: 'deny' as const }], default: 'ask' as const };
      const decision = evaluateCommand(config, 'npm test');
      expect(decision.action).toBe('ask');
      expect(decision.matchedRule).toBeUndefined();
   });

   it('a pattern ending in " *" also matches the bare command with no trailing args', () => {
      const config = { rules: [{ pattern: 'ls *', action: 'approve' as const }], default: 'ask' as const };
      const decision = evaluateCommand(config, 'ls');
      expect(decision.action).toBe('approve');
      expect(decision.matchedRule).toBe('ls *');
   });

   it('a pattern ending in " *" still matches the command with trailing args', () => {
      const config = { rules: [{ pattern: 'ls *', action: 'approve' as const }], default: 'ask' as const };
      const decision = evaluateCommand(config, 'ls -la');
      expect(decision.action).toBe('approve');
   });

   it('the bare-command match from " *" does not match an unrelated command', () => {
      const config = { rules: [{ pattern: 'ls *', action: 'approve' as const }], default: 'ask' as const };
      const decision = evaluateCommand(config, 'lsomething');
      expect(decision.action).toBe('ask');
   });

   it('is case-sensitive by default (no accidental matches)', () => {
      const config = { rules: [{ pattern: 'npm test', action: 'approve' as const }], default: 'deny' as const };
      const decision = evaluateCommand(config, 'NPM TEST');
      expect(decision.action).toBe('deny');
   });
});

// Group 3: Ask Payload Enrichment --------------------------------------------

describe('Group 3 — ask payload enrichment', () => {
   it('produces a Decision with no `details` when action is approve', () => {
      const config = { rules: [{ pattern: 'npm test', action: 'approve' as const }], default: 'ask' as const };
      const decision = evaluateCommand(config, 'npm test');
      expect(decision.details).toBeUndefined();
   });

   it('produces a Decision with no `details` when action is deny', () => {
      const config = { rules: [{ pattern: 'npm deploy', action: 'deny' as const }], default: 'ask' as const };
      const decision = evaluateCommand(config, 'npm deploy');
      expect(decision.details).toBeUndefined();
   });

   it('enriches an `ask` decision with the command in `details`', () => {
      const config = { rules: [], default: 'ask' as const };
      const decision = evaluateCommand(config, 'rm -rf /tmp/foo');
      expect(decision.action).toBe('ask');
      expect(decision.details?.command).toBe('rm -rf /tmp/foo');
   });

   it('enriches an `ask` decision produced by an explicit rule match', () => {
      const config = { rules: [{ pattern: 'git push*', action: 'ask' as const }], default: 'deny' as const };
      const decision = evaluateCommand(config, 'git push --force');
      expect(decision.action).toBe('ask');
      expect(decision.details?.command).toBe('git push --force');
   });

   it('accepts caller-supplied paths/diff merged into `ask` details', () => {
      const config = { rules: [], default: 'ask' as const };
      const decision = evaluateCommand(config, 'apply patch', {
         paths: ['/a/b.ts'],
         diff:  '--- a\n+++ b\n',
      });
      expect(decision.details?.paths).toEqual(['/a/b.ts']);
      expect(decision.details?.diff).toBe('--- a\n+++ b\n');
      expect(decision.details?.command).toBe('apply patch');
   });
});

// Group 4: Error Handling / Fail-Closed --------------------------------------

describe('Group 4 — error handling, fail-closed', () => {
   it('missing config file throws GovernanceConfigMissingError', () => {
      const missingPath = join(dir, 'does-not-exist.yaml');
      expect(() => loadGovernanceConfig(missingPath)).toThrow(GovernanceConfigMissingError);
   });

   it('missing config file error identifies the file path', () => {
      const missingPath = join(dir, 'does-not-exist.yaml');
      expect(() => loadGovernanceConfig(missingPath)).toThrow(missingPath);
   });

   it('malformed YAML throws GovernanceConfigParseError', () => {
      const filePath = writeConfig('governance:\n  rules: [this is not: valid: yaml');
      expect(() => loadGovernanceConfig(filePath)).toThrow(GovernanceConfigParseError);
   });

   it('missing `governance` root key throws GovernanceConfigInvalidError', () => {
      const filePath = writeConfig('notGovernance:\n  foo: bar\n');
      expect(() => loadGovernanceConfig(filePath)).toThrow(GovernanceConfigInvalidError);
   });

   it('rule missing `pattern` throws GovernanceConfigInvalidError', () => {
      const filePath = writeConfig(`
governance:
  rules:
    - action: approve
  default: ask
`);
      expect(() => loadGovernanceConfig(filePath)).toThrow(GovernanceConfigInvalidError);
   });

   it('rule with invalid `action` value throws GovernanceConfigInvalidError', () => {
      const filePath = writeConfig(`
governance:
  rules:
    - pattern: "npm test"
      action: allow-everything
  default: ask
`);
      expect(() => loadGovernanceConfig(filePath)).toThrow(GovernanceConfigInvalidError);
   });

   it('invalid `default` action value throws GovernanceConfigInvalidError', () => {
      const filePath = writeConfig(`
governance:
  rules: []
  default: sure-why-not
`);
      expect(() => loadGovernanceConfig(filePath)).toThrow(GovernanceConfigInvalidError);
   });

   it('never defaults to approve-all on any config error', () => {
      const missingPath = join(dir, 'does-not-exist.yaml');
      try { loadGovernanceConfig(missingPath); }
      catch (err) {
         expect(err).toBeInstanceOf(GovernanceConfigMissingError);
         return;
      }
      throw new Error('expected loadGovernanceConfig to throw');
   });
});

// Group 5: Operational Logging ------------------------------------------------

describe('Group 5 — operational logging', () => {
   it('logs every decision with command, matchedRule, and action', () => {
      const config = { rules: [{ pattern: 'npm test', action: 'approve' as const }], default: 'ask' as const };
      const logger = createLogger();
      const engine = createGovernanceEngine({ config, logger });
      engine.evaluate('npm test');
      const entry = logger.entries.find(e => 'governance_decision' === e.event);
      expect(entry?.data.command).toBe('npm test');
      expect(entry?.data.matchedRule).toBe('npm test');
      expect(entry?.data.action).toBe('approve');
   });

   it('logs "default" as matchedRule when no rule matched', () => {
      const config = { rules: [], default: 'deny' as const };
      const logger = createLogger();
      const engine = createGovernanceEngine({ config, logger });
      engine.evaluate('rm -rf /');
      const entry = logger.entries.find(e => 'governance_decision' === e.event);
      expect(entry?.data.matchedRule).toBe('default');
      expect(entry?.data.action).toBe('deny');
   });

   it('logs config load errors with the file path and problem', () => {
      const logger = createLogger();
      const missingPath = join(dir, 'does-not-exist.yaml');
      expect(() => createGovernanceEngine({ configPath: missingPath, logger })).toThrow();
      const entry = logger.entries.find(e => 'governance_config_error' === e.event);
      expect(entry?.data.filePath).toBe(missingPath);
      expect(entry?.level).toBe('error');
   });

   it('logs each evaluated command independently (no cross-contamination)', () => {
      const config = {
         rules: [{ pattern: 'npm test', action: 'approve' as const }],
         default: 'ask' as const,
      };
      const logger = createLogger();
      const engine = createGovernanceEngine({ config, logger });
      engine.evaluate('npm test');
      engine.evaluate('rm -rf /');
      const decisions = logger.entries.filter(e => 'governance_decision' === e.event);
      expect(decisions).toHaveLength(2);
      expect(decisions[0].data.action).toBe('approve');
      expect(decisions[1].data.action).toBe('ask');
   });
});
