import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { createToolCallTable } from '../../drivers/acp-driver-core/permissions.js';
import type { ToolCallKind } from '../../drivers/governed-driver.js';
import { evaluateToolCall, loadGovernanceConfig } from '../engine.js';
import type { GovernanceAction, GovernanceConfig, GovernanceRule } from '../types.js';

const SHIPPED = loadGovernanceConfig(join(dirname(fileURLToPath(import.meta.url)), '..', 'config.yaml'));

const withDefault = (action: GovernanceAction, rules: GovernanceRule[] = []): GovernanceConfig =>
   ({ rules, default: action });
const decide = (config: GovernanceConfig, kind: ToolCallKind, paths?: string[]) =>
   evaluateToolCall(config, { kind, title: 't', ...(undefined === paths ? {} : { paths }) }).action;

const MUTATIONS: ToolCallKind[] = ['edit', 'delete', 'move'];

describe.each(MUTATIONS)('path reports from real agents: %s', kind => {
   it('[H] a report without usable paths is denied, also under default approve', () => {
      for (const config of [SHIPPED, withDefault('approve')]) {
         expect(decide(config, kind)).toBe('deny');
         expect(decide(config, kind, [])).toBe('deny');
         expect(decide(config, kind, [' '])).toBe('deny');
      }
   });

   it.each([
      ['a relative parent path',                            ['../etc/passwd']],
      ['a parent segment inside a path',                    ['/repo/../etc/passwd']],
      ['one safe path and one parent path: the worst wins', ['/repo/a.ts', '/repo/../x']],
   ])('[H] %s is ask, never approve, also under default approve', (_name, paths) => {
      expect(decide(SHIPPED, kind, paths)).toBe('ask');
      expect(decide(withDefault('approve'), kind, paths)).toBe('ask');
   });

   it('[H] a backslash parent path is ask or deny, never approve, also under default approve', () => {
      for (const config of [SHIPPED, withDefault('approve')]) {
         expect(['ask', 'deny']).toContain(decide(config, kind, ['..\\x']));
      }
   });

   it('[H] a path starting with ~ is not approved by a rule that names an absolute path', () => {
      const config = withDefault('ask', [{ kind, path: '/home/u', action: 'approve' }]);
      expect(decide(config, kind, ['/home/u/x'])).toBe('approve');
      expect(decide(config, kind, ['~/x'])).toBe('ask');
   });

   // Accepted residual risk: paths are matched as text, nothing is resolved.
   it.each(['deny', 'ask'] as const)(
      'a path with ./ or // is not matched by a %s rule for the directory (accepted risk, textual matching)',
      action => {
         const config = withDefault('approve', [{ kind, path: '/repo/secret', action }]);
         expect(decide(config, kind, ['/repo/secret/k'])).toBe(action);
         expect(decide(config, kind, ['/repo/./secret/k'])).toBe('approve');
         expect(decide(config, kind, ['/repo//secret/k'])).toBe('approve');
      },
   );
});

describe('path reports: the other kinds', () => {
   it('[H] a thin Kiro edit request with no stream record is reported as other with no paths: '
      + 'ask under the shipped config', () => {
      const report = createToolCallTable().report({ toolCallId: 'e1', status: 'pending', title: 'Edit a.ts' });
      expect(report).toEqual({ id: 'e1', kind: 'other', title: 'Edit a.ts' });
      expect(evaluateToolCall(SHIPPED, report).action).toBe('ask');
      // Accepted residual risk: under `default: approve` an unclassified request is approved.
      expect(evaluateToolCall(withDefault('approve'), report).action).toBe('approve');
   });

   it.each([
      ['fetch',  undefined],
      ['other',  undefined],
      ['think',  undefined],
      ['delete', ['/repo/a.ts']],
   ] as Array<[ToolCallKind, string[] | undefined]>)('%s with no matching rule gets the configured '
      + 'default', (kind, paths) => {
      for (const action of ['ask', 'deny', 'approve'] as const) {
         expect(decide(withDefault(action), kind, paths)).toBe(action);
      }
      expect(decide(SHIPPED, kind, paths)).toBe('ask');
   });

   it.each(['fetch', 'think', 'other'] as ToolCallKind[])(
      '[H] %s with nothing to show, not even a title, is denied instead of asked',
      kind => {
         const empty = { kind, title: '  ' };
         expect(evaluateToolCall(SHIPPED, empty)).toMatchObject({ action: 'deny', reason: 'missing_details' });
         expect(evaluateToolCall(withDefault('ask'), empty).action).toBe('deny');
         expect(evaluateToolCall(withDefault('deny'), empty).action).toBe('deny');
         // Accepted residual risk: `default: approve` approves whatever no rule covers.
         expect(evaluateToolCall(withDefault('approve'), empty).action).toBe('approve');
      },
   );

   it('a title alone is enough to ask: a mode switch is asked about, not denied', () => {
      expect(evaluateToolCall(SHIPPED, { kind: 'other', title: 'Switch mode' }).action).toBe('ask');
   });
});

describe('reads are approved by design (accepted residual risk)', () => {
   it('a read of a secret file is approved by the shipped config', () => {
      expect(evaluateToolCall(SHIPPED, { kind: 'read', title: 't', paths: ['/home/u/.ssh/id_rsa'] }).action)
         .toBe('approve');
   });

   it.each(['cat ~/.ssh/id_rsa', 'head -c 100 /etc/hosts'])('the command %s is approved by '
      + 'the shipped config', command => {
      expect(evaluateToolCall(SHIPPED, { kind: 'execute', title: 't', command }).action).toBe('approve');
   });
});
