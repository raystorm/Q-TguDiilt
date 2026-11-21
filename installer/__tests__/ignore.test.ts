/**
 * The effect of the ignore files the installer writes, as git sees it in a temporary repository: logs
 * and workflow state are ignored, markers, ignore files and rules are not, and the root of the target
 * is left alone. Skipped when git cannot be run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, hasGit, makeEngine, MARKERS, prompt, put, runOn, skill, tempDir, textOf } from './engine.js';

afterEach(cleanup);

/** The fixture's own marker ignore files: ignore everything in the folder except the markers. */
const KEEP_MARKERS = '*\n!*/\n!.gitignore\n!.gitkeep\n!README.md\n';

/** Files a run leaves behind that no repository should track. */
const PRIVATE = [
   '.amazonq/workflow.log',
   '.amazonq/.timestamp-temp',
   '.amazonq/suspended/auto-x.md',
   '.amazonq/work/current/HANDOFF.md',
   '.amazonq/work/status/Fake-wf-fake.json',
   '.workflow/work/acp.log',
];

const KEPT = [
   ...MARKERS,
   '.amazonq/.gitignore',
   '.workflow/.gitignore',
   '.amazonq/rules/fake-rule.md',
   '.workflow/rules/foundation/fake-rule.md',
];

const ignored = (target: string, path: string) =>
   0 === spawnSync('git', ['check-ignore', '-q', path], { cwd: target }).status;

describe.skipIf(!hasGit)('git, in a target after an install', () =>
{
   function installedRepository()
   {
      const target = tempDir('installer-target-');
      expect(spawnSync('git', ['init', '-q'], { cwd: target }).status).toBe(0);
      runOn(makeEngine({
         '.amazonq/work/.gitignore':      KEEP_MARKERS,
         '.amazonq/suspended/.gitignore': KEEP_MARKERS,
         '.workflow/work/.gitignore':     KEEP_MARKERS,
      }), [target]);
      for (const path of PRIVATE) { put(target, path, 'fake private\n'); }
      return target;
   }

   it.each([...PRIVATE, '.workflow/installed.json'])('ignores %s', (path) =>
   {
      expect(ignored(installedRepository(), path)).toBe(true);
   });

   it.each(KEPT)('does not ignore %s', (path) =>
   {
      expect(ignored(installedRepository(), path)).toBe(false);
   });

   it('writes no .gitignore at the root of the target', () =>
   {
      expect(existsSync(join(installedRepository(), '.gitignore'))).toBe(false);
   });
});

/** Files of the user in the folders where the installer generates. */
const USER_FILES = [
   '.agents/skills/test-skill/SKILL.md',
   '.kiro/skills/mine/SKILL.md',
   '.kiro/prompts/hi.md',
   '.kiro/prompts/args-probe.md',
];

describe.skipIf(!hasGit)('git, in a target with generated copies and files of the user', () =>
{
   it('ignores each generated copy only, never a file of the user or an ignore file, and uses no wildcard', () =>
   {
      const target = tempDir('installer-target-');
      expect(spawnSync('git', ['init', '-q'], { cwd: target }).status).toBe(0);
      for (const path of USER_FILES) { put(target, path, 'fake mine\n'); }
      runOn(makeEngine({ ...prompt('fake-one'), ...skill('fake-skill') }), [target]);

      const generated = [
         '.kiro/prompts/fake-one.md',
         '.agents/skills/fake-one/SKILL.md',
         '.kiro/skills/fake-skill/SKILL.md',
         '.agents/skills/fake-skill/SKILL.md',
      ];
      const files = ['.kiro/prompts/.gitignore', '.kiro/skills/.gitignore', '.agents/skills/.gitignore'];
      for (const path of generated) { expect(ignored(target, path)).toBe(true); }
      for (const path of [...USER_FILES, ...files]) { expect(ignored(target, path)).toBe(false); }
      for (const path of files)
      {
         const patterns = textOf(target, path).split('\n').filter((line) => !line.startsWith('#'));
         expect(patterns.some((line) => line.includes('*'))).toBe(false);
      }
   });
});
