import { describe, it, expect } from 'vitest';
import { renderCopilot } from '../transform.js';
import { agents, canonical, FILE, parts, stopOf } from './fixtures.js';

/**
 * Pins down an authored skill (source 'skill'): the same token contract as a
 * prompt, no `disable-model-invocation` added, the folder equal to the name,
 * and a lower-case name (an internal skill may start with `_`).
 */

const copilot = (text: string) => renderCopilot(FILE, text, 'skill');

describe('authored skill', () => {
   it('uses the same tokens, and the folder equals the name', () => {
      const text = canonical({ name: 'fake-skill', arguments: ['input'], body: 'Run {{input}}.\n' });
      for (const { render, token } of agents) {
         expect(parts(render(text, 'skill').text).body).toBe(`Run ${token('input')}.\n`);
      }
      expect(copilot(text).folder).toBe('fake-skill');
   });

   it('adds no disable-model-invocation when the skill has none', () => {
      const { frontmatter } = parts(copilot(canonical({ name: 'fake-skill' })).text);
      expect(Object.keys(frontmatter)).not.toContain('disable-model-invocation');
   });

   it.each([{ value: true }, { value: false }])('keeps disable-model-invocation: $value', ({ value }) => {
      const text = canonical({ name: 'fake-skill', extra: { 'disable-model-invocation': value } });
      expect(parts(copilot(text).text).frontmatter['disable-model-invocation']).toBe(value);
   });

   it('keeps the leading underscore of an internal skill in the name and the folder', () => {
      const text = canonical({ name: '_fake-tool', arguments: ['input'], body: 'Run {{input}}.\n' });
      for (const { render, token } of agents) {
         expect(parts(render(text, 'skill').text).body).toBe(`Run ${token('input')}.\n`);
      }
      expect(copilot(text).folder).toBe('_fake-tool');
   });

   it.each([
      { name: 'fake-skill',    ok: true },
      { name: 'fake_skill',    ok: true },
      { name: '_fake-tool',    ok: true },
      { name: '1st-fake-tool', ok: true },
      { name: 'FakeSkill',     ok: false },
      { name: 'fakeSkill',     ok: false },
      { name: 'Fake',          ok: false },
      { name: 'fake skill',    ok: false },
      { name: 'fake.skill',    ok: false },
      { name: 'fake:skill',    ok: false },
      { name: '-fake',         ok: false },
      { name: 'a'.repeat(65),  ok: false },
   ])('a skill named $name: ok is $ok', ({ name, ok }) => {
      const text = canonical({ name });
      for (const { render } of agents) {
         if (ok) {
            expect(() => render(text, 'skill')).not.toThrow();
         } else {
            const { reason, file, detail } = stopOf(() => render(text, 'skill'));
            expect({ reason, file, detail }).toEqual({ reason: 'name_invalid', file: FILE, detail: name });
         }
      }
   });
});
