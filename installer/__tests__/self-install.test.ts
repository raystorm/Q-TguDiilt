/**
 * The engine as its own target: it registers, seeds its registry and runs no npm ci, and a dry run says
 * there is something to do until the entry exists.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { acpOf, cleanup, entryOf, keyOf, makeEngine, recordingIo, runOn, textOf, tree } from './engine.js';

afterEach(cleanup);

const REGISTRY = '.workflow/acp/drivers/registry.yaml';
const EXAMPLE  = '.workflow/acp/drivers/registry.example.yaml';
const HIDDEN   = '.workflow/acp/node_modules/.package-lock.json';

describe('a self-install', () =>
{
   it('seeds the registry, registers its own launcher, never runs npm ci, and says so', () =>
   {
      const engine   = makeEngine({ [HIDDEN]: null });
      const recorded = recordingIo();

      const { result } = runOn(engine, [engine.dir], recorded);

      const said = result.lines.some((line) => line.startsWith('note') && line.includes('npm ci was not run'));
      expect(textOf(engine.dir, REGISTRY)).toBe(textOf(engine.dir, EXAMPLE));
      expect(acpOf(recorded.home).agent_servers[keyOf(engine.dir)]).toEqual(entryOf(engine.dir));
      expect(recorded.calls).toEqual([]);
      expect(said).toBe(true);
   });

   it('has nothing to write on the next run once node_modules exists', () =>
   {
      const engine   = makeEngine({ [HIDDEN]: null });
      const recorded = recordingIo();
      runOn(engine, [engine.dir], recorded);
      engine.put(HIDDEN, '{}\n');

      const { result } = runOn(engine, [engine.dir], recorded);

      expect(result.lines).toEqual(['nothing to write']);
   });

   it('never touches a registry that was already there', () =>
   {
      const engine   = makeEngine({ [REGISTRY]: 'fake mine\n' });
      const recorded = recordingIo();

      const { result } = runOn(engine, [engine.dir], recorded);

      expect(textOf(engine.dir, REGISTRY)).toBe('fake mine\n');
      expect(result.lines.some((line) => line.includes(REGISTRY))).toBe(false);
   });
});

describe('a dry run of a self-install', () =>
{
   it('lists a missing entry and writes nothing, then has nothing to write once the entry exists', () =>
   {
      const engine       = makeEngine();
      const recorded     = recordingIo();
      const targetBefore = tree(engine.dir);
      const homeBefore   = tree(recorded.home);

      const dry = runOn(engine, [engine.dir, '--dry-run'], recorded);

      const listed = dry.result.lines.some((line) => line.startsWith('create ') && line.includes('acp.json'));
      expect(listed).toBe(true);
      expect(dry.result.lines.at(-1)).not.toBe('nothing to write');
      expect(recorded.writes).toEqual([]);
      expect(tree(engine.dir)).toEqual(targetBefore);
      expect(tree(recorded.home)).toEqual(homeBefore);

      runOn(engine, [engine.dir], recorded);
      expect(runOn(engine, [engine.dir, '--dry-run'], recorded).result.lines).toEqual(['nothing to write']);
   });
});
