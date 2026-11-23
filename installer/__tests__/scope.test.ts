/**
 * What a full run may write: only inside the target and the IDE's acp.json (with its backup and a
 * temporary file that is gone at the end); a dry run writes and runs nothing.
 */
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
   acpJson, cleanup, makeEngine, prompt, put, recordingIo, runOn, skill, tempDir, tree,
} from './engine.js';

afterEach(() =>
{
   vi.unstubAllEnvs();
   cleanup();
});

/** An engine with every feature in play. */
const full = () => makeEngine({
   ...prompt('fake-extra'),
   ...skill('fake-skill'),
   '.amazonq/prompts/fake-q-prompt.md': 'fake q prompt\n',
});

describe('a full real run with --force', () =>
{
   it('writes only inside the target and to acp.json, its backup and a temporary file that is gone', () =>
   {
      const sentinel = tempDir('installer-sentinel-');
      put(sentinel, '.fake-sentinel', 'fake\n');
      vi.stubEnv('HOME', sentinel);
      vi.stubEnv('USERPROFILE', sentinel);
      const target   = tempDir('installer-target-');
      const recorded = recordingIo();
      acpJson(recorded.home, { servers: { 'fake-one': { command: 'fake-cmd' } } });
      const homeBefore     = tree(recorded.home);
      const sentinelBefore = tree(sentinel);
      const jetbrains      = join(recorded.home, '.jetbrains');

      runOn(full(), [target, '--force'], recorded);

      const inside = (path: string) =>
         path.startsWith(`${target}${sep}`) || path.startsWith(`${jetbrains}${sep}`);
      for (const list of [recorded.writes, recorded.renames, recorded.removes])
      { expect(list.filter((path) => !inside(path))).toEqual([]); }
      const homeAfter = tree(recorded.home);
      for (const path of Object.keys(homeBefore).filter((path) => !path.startsWith('.jetbrains')))
      { expect(homeAfter[path]).toBe(homeBefore[path]); }
      expect(Object.keys(homeAfter).filter((path) => path.startsWith('.jetbrains')).sort())
         .toEqual(['.jetbrains/', '.jetbrains/acp.json', '.jetbrains/acp.json.bak']);
      expect(tree(sentinel)).toEqual(sentinelBefore);
      expect(existsSync(join(target, '.amazonq', 'prompts'))).toBe(false);
   });
});

describe('a dry run', () =>
{
   it('writes, renames, removes and runs nothing, and lists the registration and npm ci', () =>
   {
      const target     = tempDir('installer-target-');
      const recorded   = recordingIo();
      const homeBefore = tree(recorded.home);

      const { result } = runOn(full(), [target, '--dry-run'], recorded);

      const registered = result.lines.some((line) => line.startsWith('create ') && line.includes('acp.json'));
      expect([recorded.writes, recorded.renames, recorded.removes, recorded.calls]).toEqual([[], [], [], []]);
      expect(tree(target)).toEqual({});
      expect(tree(recorded.home)).toEqual(homeBefore);
      expect(registered).toBe(true);
      expect(result.lines.some((line) => line.includes('npm ci --omit=dev'))).toBe(true);
      expect(result.code).toBe(0);
   });
});
