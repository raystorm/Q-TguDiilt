import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { evaluateCommand, loadGovernanceConfig } from '../engine.js';

const config = loadGovernanceConfig(join(dirname(fileURLToPath(import.meta.url)), '..', 'config.yaml'));

/** How long one decision may take. */
const LIMIT_MS = 1000;

const HOSTILE: Array<[string, () => string]> = [
   ['a 1 MB word',                () => `ls ${'a'.repeat(1_000_000)}`],
   ['a 1 MB run of arguments',    () => `ls ${'a '.repeat(500_000)}`],
   ['100,000 operators',          () => Array(100_001).fill('ls').join(' && ')],
   ['10,000 segments',            () => Array(10_000).fill('ls -la').join('; ')],
   ['10,000 nested parentheses',  () => `${'('.repeat(10_000)}ls${')'.repeat(10_000)}`],
   ['50,000 alternating quotes',  () => `echo ${'"\''.repeat(50_000)}`],
   ['5,000 nested quoted groups', () => `echo ${'"a '.repeat(5_000)}${'" b'.repeat(5_000)}`],
   ['100,000 redirects',          () => `ls ${'> f '.repeat(100_000)}`],
   ['100,000 backslashes',        () => `ls ${'\\'.repeat(100_000)}`],
];

describe('hostile input', () => {
   it.each(HOSTILE)('%s is decided within a second and never throws', (_name, make) => {
      const command  = make();
      const started  = performance.now();
      const decision = evaluateCommand(config, command);
      const elapsed  = performance.now() - started;
      expect(['approve', 'deny', 'ask']).toContain(decision.action);
      expect(elapsed).toBeLessThan(LIMIT_MS);
   });
});
