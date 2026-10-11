import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluateCommand, evaluateToolCall, loadGovernanceConfig } from '../engine.js';
import type { ToolCallKind, ToolCallReport } from '../../drivers/governed-driver.js';
import type { Decision, GovernanceAction, GovernanceConfig, GovernanceRule } from '../types.js';

/**
 * Tool-call matching: rules that constrain `kind`, `path`, `files` and a
 * command `pattern`, evaluated against the report a driver makes for each
 * tool call. High-risk scenarios come first in each group.
 */
const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'config.yaml');

function rep(kind: ToolCallKind, extra: Partial<ToolCallReport> = {}): ToolCallReport {
   return { kind, title: 'agent supplied title', ...extra };
}

function decide(
   rules: GovernanceRule[],
   report: ToolCallReport,
   fallback: GovernanceAction = 'ask',
): Decision {
   return evaluateToolCall({ rules, default: fallback }, report);
}

/** True when a lone approve rule built from `rule` approves an edit of `path`. */
function approves(rule: Omit<GovernanceRule, 'action'>, path: string): boolean {
   const rules: GovernanceRule[] = [{ ...rule, action: 'approve' }];
   return 'approve' === decide(rules, rep('edit', { paths: [path] })).action;
}

describe('rule forms and compatibility', () => {
   it('[H] a legacy pattern rule governs only execute', () => {
      const rules: GovernanceRule[] = [{ pattern: '*', action: 'approve' }];
      expect(decide(rules, rep('edit', { paths: ['/proj/a.ts'] })).action).toBe('ask');
      expect(decide(rules, rep('execute', { command: 'anything' })).action).toBe('approve');
   });

   const forms: Array<[string, GovernanceRule, ToolCallReport, ToolCallReport]> = [
      ['kind only',
         { kind: 'delete', action: 'deny' },
         rep('delete', { paths: ['/p/a'] }), rep('edit', { paths: ['/p/a'] })],
      ['path only',
         { path: '/p/src', action: 'deny' },
         rep('edit', { paths: ['/p/src/a'] }), rep('edit', { paths: ['/p/lib/a'] })],
      ['files only',
         { files: ['*.pem'], action: 'deny' },
         rep('edit', { paths: ['/x/k.pem'] }), rep('edit', { paths: ['/x/k.txt'] })],
      ['kind + path + files',
         { kind: 'edit', path: '/p/src', files: ['*.ts'], action: 'deny' },
         rep('edit', { paths: ['/p/src/a.ts'] }), rep('read', { paths: ['/p/src/a.ts'] })],
      ['pattern only (implies execute)',
         { pattern: 'ls *', action: 'deny' },
         rep('execute', { command: 'ls -la' }), rep('execute', { command: 'pwd' })],
   ];

   it.each(forms)('%s applies, and constrains only what it names', (_name, rule, hit, miss) => {
      expect(decide([rule], hit).action).toBe('deny');
      expect(decide([rule], miss).action).toBe('ask');
   });
});

describe('kind matching and untrusted fields', () => {
   it('a kind rule applies', () => {
      const rules: GovernanceRule[] = [{ kind: 'delete', action: 'deny' }];
      expect(decide(rules, rep('delete', { paths: ['/p/a'] })).action).toBe('deny');
   });

   it('first match wins across rule types', () => {
      const rules: GovernanceRule[] = [
         { kind: 'delete', action: 'deny' },
         { kind: 'delete', action: 'approve' },
      ];
      expect(decide(rules, rep('delete', { paths: ['/p/a'] })).action).toBe('deny');
   });

   it.each<ToolCallKind>(['fetch', 'think', 'other'])('%s matches on kind alone', kind => {
      expect(decide([], rep(kind)).action).toBe('ask');
      expect(decide([{ kind, action: 'deny' }], rep(kind)).action).toBe('deny');
   });

   it('[H] the title is never matched', () => {
      const rules: GovernanceRule[] = [{ pattern: 'safe*', action: 'approve' }];
      const first  = decide(rules, rep('execute', { command: 'rm x', title: 'safe thing' }));
      const second = decide(rules, rep('execute', { command: 'rm x', title: 'other thing' }));
      expect(first.action).toBe('ask');
      expect({ action: first.action, rule: first.matchedRule })
         .toEqual({ action: second.action, rule: second.matchedRule });
   });

   it('[H] annotation hints are not an authorization signal', () => {
      const rules: GovernanceRule[] = [{ pattern: 'ls *', action: 'approve' }];
      const rawInput = { command: 'rm -rf x', annotations: { readOnlyHint: true } };
      expect(decide(rules, rep('execute', { command: 'rm -rf x', rawInput })).action).toBe('ask');
   });

   it('[H] the raw request is never matched', () => {
      const rules: GovernanceRule[] = [{ path: '/proj/ok', action: 'approve' }];
      const report = rep('edit', { paths: ['/proj/secret/x'], rawInput: { path: '/proj/ok/x' } });
      expect(decide(rules, report).action).toBe('ask');
   });
});

describe('path and file-name rules', () => {
   it('path matches itself and everything under it', () => {
      for (const p of ['/proj/src', '/proj/src/a.ts', '/proj/src/a/b/c.ts']) {
         expect(approves({ path: '/proj/src' }, p)).toBe(true);
      }
   });

   it('[H] path matches whole segments only', () => {
      for (const p of ['/proj/src-old/a', '/proj/srcfoo']) {
         expect(approves({ path: '/proj/src' }, p)).toBe(false);
      }
   });

   it('a trailing slash makes no difference', () => {
      for (const p of ['/proj/src', '/proj/src/', '/proj/src/a.ts']) {
         expect(approves({ path: '/proj/src/' }, p)).toBe(true);
         expect(approves({ path: '/proj/src' }, p)).toBe(true);
      }
      expect(approves({ path: '/proj/src/' }, '/proj/src-old/a')).toBe(false);
   });

   it('extension patterns are anchored and case-sensitive', () => {
      expect(approves({ files: ['*.ts'] }, '/x/a.ts')).toBe(true);
      for (const p of ['/x/a.tsx', '/x/a.ts.bak', '/x/A.TS']) {
         expect(approves({ files: ['*.ts'] }, p)).toBe(false);
      }
   });

   it('exact names and trailing wildcards', () => {
      expect(approves({ files: ['.env'] }, '/x/.env')).toBe(true);
      expect(approves({ files: ['.env'] }, '/x/.env.local')).toBe(false);
      expect(approves({ files: ['.env*'] }, '/x/.env')).toBe(true);
      expect(approves({ files: ['.env*'] }, '/x/.env.local')).toBe(true);
   });

   it('[H] * matches dot-files', () => {
      expect(approves({ files: ['*'] }, '/x/.env')).toBe(true);
      expect(approves({ files: ['*.pem'] }, '/x/.k.pem')).toBe(true);
   });

   it('entries are OR\'d', () => {
      expect(approves({ files: ['*.pem', '.env'] }, '/x/.env')).toBe(true);
      expect(approves({ files: ['*.pem', '.env'] }, '/x/k.pem')).toBe(true);
      expect(approves({ files: ['*.pem', '.env'] }, '/x/k.txt')).toBe(false);
   });

   it('path and files must both match', () => {
      const rule = { path: '/proj/src', files: ['*.ts'] };
      expect(approves(rule, '/proj/src/a/b.ts')).toBe(true);
      expect(approves(rule, '/proj/src/a/b.js')).toBe(false);
      expect(approves(rule, '/proj/lib/b.ts')).toBe(false);
   });

   it('[H] files alone applies in any directory', () => {
      const rules: GovernanceRule[] = [{ files: ['*.pem', '.env'], action: 'deny' }];
      expect(decide(rules, rep('edit', { paths: ['/anywhere/x.pem'] })).action).toBe('deny');
   });

   it('[H] first match wins; order decides conflicts', () => {
      const broad:  GovernanceRule = { files: ['*.foo'], action: 'deny' };
      const narrow: GovernanceRule = { path: '/proj/safe/path', files: ['*.foo'], action: 'approve' };
      const inside  = rep('edit', { paths: ['/proj/safe/path/x.foo'] });
      const outside = rep('edit', { paths: ['/proj/other/x.foo'] });
      expect(decide([broad, narrow], inside).action).toBe('deny');
      expect(decide([narrow, broad], inside).action).toBe('approve');
      expect(decide([narrow, broad], outside).action).toBe('deny');
   });

   it('relative paths are not resolved', () => {
      expect(approves({ path: '/proj/src' }, 'src/a.ts')).toBe(false);
      expect(approves({ files: ['*.ts'] }, 'src/a.ts')).toBe(true);
   });

   it('a directory named by the report matches path, but its name is the last segment', () => {
      const dir = rep('delete', { paths: ['/proj/data'] });
      expect(decide([{ path: '/proj/data', action: 'deny' }], dir).action).toBe('deny');
      expect(decide([{ path: '/proj/data', files: ['*.ts'], action: 'deny' }], dir).action).toBe('ask');
   });

   it('paths with spaces match normally', () => {
      expect(approves({ path: '/my proj/src' }, '/my proj/src/a b.ts')).toBe(true);
   });
});

describe('the parent-segment guard', () => {
   it('[H] an approve rule does not approve a path with a ".." segment', () => {
      const path = '/proj/src/../../etc/passwd';
      const d = decide([{ path: '/proj/src', action: 'approve' }], rep('edit', { paths: [path] }));
      expect(d.action).toBe('ask');
      expect(d.reason).toBe('parent_segment');
      expect(d.details?.paths).toEqual([path]);
   });

   it('[H] a kind-only approve rule does not approve one either', () => {
      const d = decide([{ kind: 'read', action: 'approve' }], rep('read', { paths: ['/proj/../etc/passwd'] }));
      expect(d.action).toBe('ask');
   });

   it('a matching deny still denies', () => {
      const rules: GovernanceRule[] = [{ path: '/proj/secrets', action: 'deny' }];
      const d = decide(rules, rep('edit', { paths: ['/proj/secrets/../secrets/a'] }));
      expect(d.action).toBe('deny');
      expect(d.reason).toBeUndefined();
   });

   it('only whole ".." segments count', () => {
      for (const p of ['/proj/src/..foo', '/proj/a..b.txt', '/proj/..hidden/a']) {
         expect(approves({ path: '/proj' }, p)).toBe(true);
      }
   });

   it('"." segments and dot-folders are not forced to ask', () => {
      for (const p of ['/proj/./src/a.ts', '/proj/.github/x.yml']) {
         expect(approves({ path: '/proj' }, p)).toBe(true);
      }
   });

   it('applies to every path in a report', () => {
      const rules: GovernanceRule[] = [{ path: '/proj', action: 'approve' }];
      const d = decide(rules, rep('move', { paths: ['/proj/a', '/proj/../x'] }));
      expect(d.action).toBe('ask');
   });

   it('[H] holds under default approve', () => {
      const d = decide([], rep('edit', { paths: ['/x/../y'] }), 'approve');
      expect(d.action).toBe('ask');
      expect(d.reason).toBe('parent_segment');
   });

   it('is for paths, not commands', () => {
      const rules: GovernanceRule[] = [{ pattern: 'cat *', action: 'approve' }];
      expect(decide(rules, rep('execute', { command: 'cat ../secret' })).action).toBe('approve');
   });
});

describe('missing required fields fail closed', () => {
   it.each([undefined, '', '   '])('[H] execute with command %j is denied under default approve', command => {
      const d = decide([{ kind: 'execute', action: 'approve' }], rep('execute', { command }), 'approve');
      expect(d.action).toBe('deny');
      expect(d.reason).toBe('missing_command');
      expect(d.details).toBeUndefined();
   });

   const unusable: Array<string[] | undefined> = [undefined, [], [''], ['  ', '']];
   describe.each(['edit', 'delete', 'move'] as const)('%s without usable paths', kind => {
      it.each(unusable)('[H] paths %j is denied under default approve', paths => {
         const d = decide([], rep(kind, { paths }), 'approve');
         expect(d.action).toBe('deny');
         expect(d.reason).toBe('missing_paths');
         expect(d.details).toBeUndefined();
      });
   });

   it.each<ToolCallKind>(['read', 'search', 'fetch', 'think', 'other'])(
      '%s needs no command or paths',
      kind => {
         expect(decide([], rep(kind), 'approve').action).toBe('approve');
         expect(decide([], rep(kind)).action).toBe('ask');
      },
   );
});

describe('several paths', () => {
   const rules: GovernanceRule[] = [
      { path: '/a', action: 'approve' },
      { path: '/b', action: 'deny' },
   ];

   it.each([
      [['/a/x', '/a/y'], 'approve'],
      [['/a/x', '/c/x'], 'ask'],
      [['/c/x', '/b/x'], 'deny'],
      [['/a/x', '/b/x'], 'deny'],
   ] as Array<[string[], GovernanceAction]>)('%j -> %s (most restrictive wins)', (paths, expected) => {
      expect(decide(rules, rep('move', { paths })).action).toBe(expected);
   });

   it('a move from an approved directory into a denied one is denied', () => {
      expect(decide(rules, rep('move', { paths: ['/a/x', '/b/x'] })).matchedRule).toBe('#2 path=/b');
   });

   it('ask details list every path, not only the one that asked', () => {
      const d = decide(rules, rep('move', { paths: ['/a/x', '/c/x'] }));
      expect(d.details?.paths).toEqual(['/a/x', '/c/x']);
   });
});

describe('shell commands inside tool calls', () => {
   const config: GovernanceConfig = {
      rules: [
         { pattern: 'npm test', action: 'approve' },
         { pattern: 'ls *',     action: 'approve' },
         { pattern: 'rm *',     action: 'deny'    },
      ],
      default: 'ask',
   };

   it.each([
      'npm test', 'npm test && rm -rf x', 'npm test && ls', 'ls $(whoami)',
      'ls\nrm x', 'ls > out.txt', 'ls | rm x', 'unlisted command',
   ])('[H] execute "%s" decides exactly like evaluateCommand', command => {
      expect(evaluateToolCall(config, rep('execute', { command })))
         .toEqual(evaluateCommand(config, command));
   });

   it('file mutations folded into shell commands are governed', () => {
      const shipped = loadGovernanceConfig(CONFIG_PATH);
      for (const command of ['sed -i s/a/b/ f', 'echo x > /proj/a']) {
         expect(evaluateToolCall(shipped, rep('execute', { command })).action).toBe('ask');
      }
   });

   it('an edit report is not approved by a command rule', () => {
      const report = rep('edit', { command: 'npm test', paths: ['/proj/a.ts'] });
      expect(evaluateToolCall(config, report).action).toBe('ask');
   });
});

describe('ask payload and rule labels', () => {
   it('execute: details carry the full original command', () => {
      const command = 'rm -rf build && ls';
      expect(decide([], rep('execute', { command })).details?.command).toBe(command);
   });

   it('[H] an edit ask carries paths, the whole diff and the raw request', () => {
      const diff     = 'x'.repeat(100_000);
      const rawInput = { path: '/proj/a.ts', patch: diff };
      const d = decide([], rep('edit', { paths: ['/proj/a.ts'], diff, rawInput }));
      expect(d.action).toBe('ask');
      expect(d.details?.paths).toEqual(['/proj/a.ts']);
      expect(d.details?.diff).toBe(diff);
      expect(d.details?.rawInput).toBe(rawInput);
   });

   it('the title never becomes the command', () => {
      const d = decide([], rep('fetch', { title: 'rm -rf /' }));
      expect(d.action).toBe('ask');
      expect(d.details?.command).toBeUndefined();
      expect(JSON.stringify(d.details)).not.toContain('rm -rf /');
   });

   it('a pattern rule reports its pattern; the default reports none', () => {
      const hit = decide([{ pattern: 'ls *', action: 'approve' }], rep('execute', { command: 'ls -la' }));
      expect(hit.matchedRule).toBe('ls *');
      expect(decide([], rep('execute', { command: 'ls' })).matchedRule).toBeUndefined();
   });

   it('other rules report their position and constraints', () => {
      const rules: GovernanceRule[] = [
         { pattern: 'x', action: 'deny' },
         { kind: 'edit', path: '/p/src', files: ['*.ts', '*.js'], action: 'approve' },
         { kind: 'read', action: 'approve' },
      ];
      expect(decide(rules, rep('edit', { paths: ['/p/src/a.ts'] })).matchedRule)
         .toBe('#2 kind=edit path=/p/src files=*.ts,*.js');
      expect(decide(rules, rep('read')).matchedRule).toBe('#3 kind=read');
   });
});

describe('a kind outside the vocabulary', () => {
   const odd = (kind: unknown): ToolCallReport =>
      ({ kind, title: 'agent supplied title', paths: ['/p/a'], command: 'ls' }) as unknown as ToolCallReport;

   // Rules that would approve this report if any of them could reach it.
   const approveAll: GovernanceRule[] = [
      { path: '/p', action: 'approve' },
      { pattern: '*', action: 'approve' },
      { kind: 'read', action: 'approve' },
   ];

   it.each(['teleport', 'constructor', 'toString', '', 7, null, undefined])(
      '[H] kind %j matches no rule and follows the configured default',
      kind => {
         for (const fallback of ['approve', 'deny', 'ask'] as const) {
            const d = decide(approveAll, odd(kind), fallback);
            expect(d.action).toBe(fallback);
            expect(d.matchedRule).toBeUndefined();
            expect(d.reason).toBeUndefined();
         }
      },
   );

   it('when it asks, shows the user what the report carried', () => {
      expect(decide([], odd('teleport')).details).toMatchObject({ paths: ['/p/a'], command: 'ls' });
   });
});
