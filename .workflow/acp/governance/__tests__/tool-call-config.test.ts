import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createGovernanceEngine, evaluateToolCall, loadGovernanceConfig } from '../engine.js';
import { GovernanceConfigInvalidError, GovernanceConfigParseError } from '../errors.js';
import type { ToolCallKind, ToolCallReport } from '../../drivers/governed-driver.js';
import type { GovernanceAction, GovernanceRule } from '../types.js';

/**
 * Tool-call rule configuration: load-time validation, the shipped config,
 * shadow warnings, and the engine's per-report log entries.
 */
const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'config.yaml');
const IDS         = { sessionId: 'acp-sess-1', callId: 1 };

let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'governance-tool-call-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** JSON is valid YAML, so rules can be written without quoting concerns. */
function writeRules(rules: unknown[], fallback = 'ask'): string {
   const filePath = join(dir, 'governance.yaml');
   writeFileSync(filePath, JSON.stringify({ governance: { rules, default: fallback } }));
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

function engineFor(rules: GovernanceRule[], fallback: GovernanceAction = 'ask') {
   const logger = createLogger();
   const engine = createGovernanceEngine({ config: { rules, default: fallback }, logger });
   return { engine, logger };
}

function rep(kind: ToolCallKind, extra: Partial<ToolCallReport> = {}): ToolCallReport {
   return { kind, title: 'agent supplied title', ...extra };
}

describe('rule validation at load', () => {
   it('[H] a rule with no constraints is invalid and named', () => {
      const filePath = writeRules([{ action: 'approve' }]);
      expect(() => loadGovernanceConfig(filePath)).toThrow(GovernanceConfigInvalidError);
      expect(() => loadGovernanceConfig(filePath)).toThrow(/rule at index 0/);
   });

   it.each(['paths', 'file', 'kinds'])('[H] the misspelled key "%s" is rejected, not ignored', key => {
      const filePath = writeRules([{ kind: 'read', [key]: ['/p'], action: 'approve' }]);
      expect(() => loadGovernanceConfig(filePath)).toThrow(GovernanceConfigInvalidError);
      expect(() => loadGovernanceConfig(filePath)).toThrow(new RegExp(key));
   });

   it.each<[string, unknown]>([
      ['kind read + pattern',          { kind: 'read',    pattern: 'x' }],
      ['kind edit + pattern',          { kind: 'edit',    pattern: 'x' }],
      ['kind fetch + pattern',         { kind: 'fetch',   pattern: 'x' }],
      ['kind execute + path',          { kind: 'execute', path: '/p' }],
      ['kind execute + files',         { kind: 'execute', files: ['*.ts'] }],
      ['kind fetch + path',            { kind: 'fetch',   path: '/p' }],
      ['kind think + files',           { kind: 'think',   files: ['*.ts'] }],
      ['kind other + path',            { kind: 'other',   path: '/p' }],
      ['pattern + path, no kind',      { pattern: 'x',    path: '/p' }],
      ['pattern + files, no kind',     { pattern: 'x',    files: ['*.ts'] }],
      ['relative path',                { path: 'src' }],
      ['empty path',                   { path: '' }],
      ['non-string path',              { path: 7 }],
      ['unknown kind',                 { kind: 'write' }],
      ['files given as a string',      { files: '*.ts' }],
      ['files: []',                    { files: [] }],
      ["files: ['']",                  { files: [''] }],
      ["files: ['a/b.ts']",            { files: ['a/b.ts'] }],
      ['files with a non-string',      { files: [1] }],
   ])('[H] %s is rejected and the rule is named', (_name, rule) => {
      const filePath = writeRules([{ ...(rule as object), action: 'ask' }]);
      expect(() => loadGovernanceConfig(filePath)).toThrow(GovernanceConfigInvalidError);
      expect(() => loadGovernanceConfig(filePath)).toThrow(/rule at index 0/);
   });

   it('names the offending rule by index among valid ones', () => {
      const filePath = writeRules([
         { kind: 'read', action: 'approve' },
         { kind: 'execute', path: '/p', action: 'ask' },
      ]);
      expect(() => loadGovernanceConfig(filePath)).toThrow(/rule at index 1/);
   });

   it('every valid rule form loads with its fields intact', () => {
      const rules = [
         { kind: 'delete', action: 'deny' },
         { path: '/proj/src', action: 'ask' },
         { files: ['*.pem', '.env'], action: 'deny' },
         { kind: 'edit', path: '/proj/src', files: ['*.ts'], action: 'approve' },
         { pattern: 'ls *', action: 'approve' },
         { kind: 'execute', pattern: 'ls *', action: 'approve' },
         { kind: 'execute', action: 'ask' },
      ];
      expect(loadGovernanceConfig(writeRules(rules)).rules).toEqual(rules);
   });

   it('an unquoted * entry is a YAML parse error naming the file; quoted loads', () => {
      const filePath = join(dir, 'governance.yaml');
      writeFileSync(filePath, 'governance:\n  rules:\n    - files:\n        - *.foo\n      action: deny\n');
      expect(() => loadGovernanceConfig(filePath)).toThrow(GovernanceConfigParseError);
      expect(() => loadGovernanceConfig(filePath)).toThrow(filePath);
      writeFileSync(filePath, 'governance:\n  rules:\n    - files:\n        - "*.foo"\n      action: deny\n');
      expect(loadGovernanceConfig(filePath).rules[0].files).toEqual(['*.foo']);
   });

   it('[H] an invalid rule still fails closed at engine start and is logged', () => {
      const filePath = writeRules([{ action: 'approve' }]);
      const logger   = createLogger();
      expect(() => createGovernanceEngine({ configPath: filePath, logger }))
         .toThrow(GovernanceConfigInvalidError);
      const entry = logger.entries.find(e => 'governance_config_error' === e.event);
      expect(entry?.level).toBe('error');
      expect(entry?.data.filePath).toBe(filePath);
   });

   it('[H] an unknown kind asks when the config sets no default', () => {
      const filePath = join(dir, 'governance.yaml');
      writeFileSync(filePath, 'governance:\n  rules:\n    - kind: read\n      action: approve\n');
      const odd = { kind: 'teleport', title: 't' } as unknown as ToolCallReport;
      expect(evaluateToolCall(loadGovernanceConfig(filePath), odd).action).toBe('ask');
   });
});

describe('shipped config', () => {
   const shipped = loadGovernanceConfig(CONFIG_PATH);
   const action  = (report: ToolCallReport) => evaluateToolCall(shipped, report).action;

   it('[H] read and search are approved, with and without paths', () => {
      for (const kind of ['read', 'search'] as const) {
         expect(action(rep(kind))).toBe('approve');
         expect(action(rep(kind, { paths: ['/proj/src/a.ts'] }))).toBe('approve');
      }
   });

   it('[H] a read of a ".." path still asks', () => {
      expect(action(rep('read', { paths: ['/proj/../etc/passwd'] }))).toBe('ask');
   });

   it('the rules carry the explanation as an adjacent comment', () => {
      const lines = readFileSync(CONFIG_PATH, 'utf8').split('\n');
      const index = lines.findIndex(line => /^\s*-\s*kind:\s*read\b/.test(line));
      expect(index).toBeGreaterThan(0);
      const comment = lines.slice(Math.max(0, index - 8), index)
         .filter(line => line.trim().startsWith('#'))
         .map(line => line.replace(/^\s*#\s?/, ''))
         .join(' ')
         .replace(/\s+/g, ' ');
      expect(comment).toMatch(/mirrors the AI/);
      expect(comment).toMatch(/probably has no effect/);
   });

   it('everything else asks', () => {
      const others: ToolCallReport[] = [
         rep('edit',    { paths: ['/proj/a.ts'] }),
         rep('delete',  { paths: ['/proj/a.ts'] }),
         rep('move',    { paths: ['/proj/a.ts', '/proj/b.ts'] }),
         rep('fetch'), rep('think'), rep('other'),
         rep('execute', { command: 'curl https://example.com' }),
      ];
      for (const report of others) { expect(action(report)).toBe('ask'); }
   });

   it('[H] loads with no shadow warning', () => {
      const logger = createLogger();
      createGovernanceEngine({ configPath: CONFIG_PATH, logger });
      expect(logger.entries.filter(e => 'governance_rule_shadowed' === e.event)).toEqual([]);
   });
});

describe('shadow warnings', () => {
   const warnings = (logger: ReturnType<typeof createLogger>) =>
      logger.entries.filter(e => 'governance_rule_shadowed' === e.event);

   const warns: Array<[string, GovernanceRule[]]> = [
      ['duplicate rules',
         [{ kind: 'read', action: 'approve' }, { kind: 'read', action: 'approve' }]],
      ['a path above its sub-path',
         [{ path: '/proj', action: 'deny' }, { path: '/proj/src', action: 'deny' }]],
      ['a kind-less path rule above an edit rule on the same path',
         [{ path: '/p', action: 'deny' }, { kind: 'edit', path: '/p', action: 'approve' }]],
      ['kind execute alone above a pattern rule',
         [{ kind: 'execute', action: 'deny' }, { pattern: 'ls *', action: 'approve' }]],
      ['a files superset above a subset',
         [{ files: ['*.ts', '*.js'], action: 'deny' }, { files: ['*.ts'], action: 'approve' }]],
      ['files * above any files rule',
         [{ files: ['*'], action: 'deny' }, { files: ['*.ts'], action: 'approve' }]],
      ['identical patterns',
         [{ pattern: 'ls', action: 'approve' }, { pattern: 'ls', action: 'deny' }]],
      ['pattern * above any pattern',
         [{ pattern: '*', action: 'ask' }, { pattern: 'ls -la', action: 'approve' }]],
   ];

   it.each(warns)('%s warns once', (_name, rules) => {
      const { logger } = engineFor(rules);
      expect(warnings(logger)).toHaveLength(1);
      expect(warnings(logger)[0].level).toBe('warn');
   });

   const quiet: Array<[string, GovernanceRule[]]> = [
      ['narrow rule before broad',
         [{ path: '/proj/safe/path', files: ['*.foo'], action: 'approve' }, { files: ['*.foo'], action: 'deny' }]],
      ['a sibling prefix',
         [{ path: '/proj/src', action: 'deny' }, { path: '/proj/srcfoo', action: 'deny' }]],
      ['a sub-path above its parent',
         [{ path: '/proj/src', action: 'deny' }, { path: '/proj', action: 'deny' }]],
      ['read above edit',
         [{ kind: 'read', action: 'approve' }, { kind: 'edit', action: 'approve' }]],
      ['a kind-less path rule above a pattern rule',
         [{ path: '/p', action: 'deny' }, { pattern: 'ls *', action: 'approve' }]],
      ['a files subset above a superset',
         [{ files: ['*.ts'], action: 'deny' }, { files: ['*.ts', '*.js'], action: 'approve' }]],
      ['a rule with files above a rule without',
         [{ files: ['*.ts'], action: 'deny' }, { kind: 'edit', action: 'deny' }]],
      ['"ls *" above "ls -la" (conservative)',
         [{ pattern: 'ls *', action: 'approve' }, { pattern: 'ls -la', action: 'deny' }]],
   ];

   it.each(quiet)('%s gives no warning', (_name, rules) => {
      expect(warnings(engineFor(rules).logger)).toEqual([]);
   });

   // An approve that only partly covers a later, stricter rule still hides
   // that rule for the overlapping kinds, so this direction warns on overlap.
   const hidden: Array<[string, GovernanceRule[]]> = [
      ['a kind-specific approve above a kind-less path deny',
         [{ kind: 'edit', action: 'approve' }, { path: '/proj/secrets', action: 'deny' }]],
      ['a read approve above a kind-less files deny',
         [{ kind: 'read', action: 'approve' }, { files: ['*.pem'], action: 'deny' }]],
   ];

   it.each(hidden)('[H] %s warns and is flagged', (_name, rules) => {
      const found = warnings(engineFor(rules).logger);
      expect(found).toHaveLength(1);
      expect(found[0].data.approveHidesStricter).toBe(true);
   });

   const harmless: Array<[string, GovernanceRule[]]> = [
      ['a deny above an approve that only partly overlaps',
         [{ kind: 'edit', action: 'deny' }, { path: '/proj/secrets', action: 'approve' }]],
      ['an approve above an approve',
         [{ kind: 'edit', action: 'approve' }, { path: '/proj/secrets', action: 'approve' }]],
      ['an approve above a deny of a different kind',
         [{ kind: 'read', action: 'approve' }, { kind: 'edit', action: 'deny' }]],
      ['an approve above a path deny whose kinds cannot overlap',
         [{ kind: 'fetch', action: 'approve' }, { path: '/p', action: 'deny' }]],
   ];

   it.each(harmless)('%s gives no warning', (_name, rules) => {
      expect(warnings(engineFor(rules).logger)).toEqual([]);
   });

   it('[H] a broad deny above a narrow approve warns, names both rules, and still denies', () => {
      const rules: GovernanceRule[] = [
         { files: ['*.foo'], action: 'deny' },
         { path: '/proj/safe/path', files: ['*.foo'], action: 'approve' },
      ];
      const { engine, logger } = engineFor(rules);
      const [warning] = warnings(logger);
      expect(warnings(logger)).toHaveLength(1);
      expect(warning.data.rule).toBe('#2 path=/proj/safe/path files=*.foo');
      expect(warning.data.shadowedBy).toBe('#1 files=*.foo');
      expect(warning.data.ruleAction).toBe('approve');
      expect(warning.data.shadowedByAction).toBe('deny');
      expect(warning.data.approveHidesStricter).toBe(false);
      const report = rep('edit', { paths: ['/proj/safe/path/x.foo'] });
      expect(engine.evaluateToolCall(report, IDS).action).toBe('deny');
   });

   it('[H] an approve hiding a stricter rule is flagged, and first match still stands', () => {
      const rules: GovernanceRule[] = [
         { kind: 'edit', action: 'approve' },
         { kind: 'edit', path: '/proj/secrets', action: 'deny' },
      ];
      const { engine, logger } = engineFor(rules);
      expect(warnings(logger)).toHaveLength(1);
      expect(warnings(logger)[0].data.approveHidesStricter).toBe(true);
      const report = rep('edit', { paths: ['/proj/secrets/key'] });
      expect(engine.evaluateToolCall(report, IDS).action).toBe('approve');
   });

   it('warnings are logged once at startup, not on each decision', () => {
      const { engine, logger } = engineFor([
         { kind: 'read', action: 'approve' }, { kind: 'read', action: 'approve' },
      ]);
      for (let i = 0; i < 3; i += 1) { engine.evaluateToolCall(rep('read'), { ...IDS, callId: i }); }
      expect(warnings(logger)).toHaveLength(1);
   });

   it('[H] a shadowed config evaluates exactly as first-match-wins', () => {
      const rules: GovernanceRule[] = [
         { files: ['*.foo'], action: 'deny' },
         { path: '/p', files: ['*.foo'], action: 'approve' },
      ];
      const { engine } = engineFor(rules);
      const report = rep('edit', { paths: ['/p/x.foo'] });
      expect(engine.evaluateToolCall(report, IDS))
         .toEqual(evaluateToolCall({ rules, default: 'ask' }, report));
   });
});

describe('engine log entries', () => {
   const decisions = (logger: ReturnType<typeof createLogger>) =>
      logger.entries.filter(e => 'governance_decision' === e.event);

   it('[H] logs one entry per report with kind, paths, matched rule and action', () => {
      const { engine, logger } = engineFor([{ kind: 'read', action: 'approve' }]);
      engine.evaluateToolCall(rep('read', { paths: ['/proj/a.ts'] }), IDS);
      expect(decisions(logger)).toHaveLength(1);
      expect(decisions(logger)[0].level).toBe('info');
      expect(decisions(logger)[0].data).toEqual({
         sessionId: 'acp-sess-1', callId: 1, kind: 'read', paths: ['/proj/a.ts'],
         matchedRule: '#1 kind=read', action: 'approve',
      });
   });

   it('logs "default" when no rule matched, and the governance result for an ask', () => {
      const { engine, logger } = engineFor([]);
      engine.evaluateToolCall(rep('edit', { paths: ['/proj/a.ts'] }), IDS);
      expect(decisions(logger)[0].data.matchedRule).toBe('default');
      expect(decisions(logger)[0].data.action).toBe('ask');
   });

   it('empty fields are omitted: command only for execute, paths only when present, reason only when forced', () => {
      const { engine, logger } = engineFor([]);
      engine.evaluateToolCall(rep('execute', { command: 'ls' }), IDS);
      engine.evaluateToolCall(rep('fetch'), IDS);
      const [exec, fetch] = decisions(logger).map(e => Object.keys(e.data));
      expect(exec).toContain('command');
      expect(exec).not.toContain('paths');
      expect(fetch).not.toContain('command');
      expect(fetch).not.toContain('paths');
      expect(exec).not.toContain('reason');
   });

   it('execute commands keep the existing redaction', () => {
      const { engine, logger } = engineFor([]);
      engine.evaluateToolCall(rep('execute', { command: 'curl -H secret-token https://x' }), IDS);
      expect(decisions(logger)[0].data.command).toBe('curl […redacted]');
   });

   it('[H] secrets in the diff, raw request or title stay out of every entry', () => {
      const { engine, logger } = engineFor([]);
      engine.evaluateToolCall(rep('edit', {
         title: 'SECRET-TITLE', paths: ['/p/a'], diff: 'SECRET-DIFF', rawInput: { token: 'SECRET-RAW' },
      }), IDS);
      expect(JSON.stringify(logger.entries)).not.toContain('SECRET');
   });

   it.each<[string, ToolCallReport, string]>([
      ['a missing command',  rep('execute'),                                  'missing_command'],
      ['missing paths',      rep('edit', { paths: [] }),                      'missing_paths'],
      ['a ".." path',        rep('edit', { paths: ['/a/../b'] }),             'parent_segment'],
   ])('[H] a forced result (%s) logs its reason', (_name, report, reason) => {
      const { engine, logger } = engineFor([], 'approve');
      engine.evaluateToolCall(report, IDS);
      expect(decisions(logger)[0].data.reason).toBe(reason);
   });

   it('a forced deny with no matching rule omits matchedRule', () => {
      const { engine, logger } = engineFor([]);
      engine.evaluateToolCall(rep('edit'), IDS);
      expect(decisions(logger)[0].data).not.toHaveProperty('matchedRule');
   });

   it('paths are logged as given, each cut at 500 characters', () => {
      const { engine, logger } = engineFor([]);
      const long = '/p/' + 'a'.repeat(600);
      engine.evaluateToolCall(rep('move', { paths: ['/a/../b', long] }), IDS);
      const logged: string[] = decisions(logger)[0].data.paths;
      expect(logged[0]).toBe('/a/../b');
      expect(logged[1]).toHaveLength(501);
      expect(logged[1].startsWith(long.slice(0, 500))).toBe(true);
      expect(logged[1].endsWith('…')).toBe(true);
   });
});
