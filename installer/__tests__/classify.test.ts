import { describe, it, expect } from 'vitest';
import { classify } from '../transform.js';
import { canonical } from './fixtures.js';

/**
 * Pins down how a file's text is sorted: a prompt, a helper prompt that other
 * prompts read by path, or not a prompt at all. A name that is missing or
 * blank means no name, so the file is not a prompt.
 */

describe('classify', () => {
   it('is a prompt when the frontmatter has a name', () => {
      expect(classify('fake-prompt.md', canonical({ name: 'fake-prompt' })).kind).toBe('prompt');
   });

   it('is not a prompt when there is no frontmatter', () => {
      expect(classify('fake-plain.md', 'Say Hello Tom.\n').kind).toBe('none');
   });

   it.each([
      { state: 'missing', name: null },
      { state: 'empty',   name: '' },
      { state: 'blank',   name: '   ' },
   ])('is not a prompt when the name is $state', ({ name }) => {
      const text = canonical({ name, description: 'A fake prompt used only by tests.', version: '0.0.0-fake' });
      expect(classify('p.md', text).kind).toBe('none');
   });

   it.each([
      { state: 'false',  extra: { 'user-invocable': false }, kind: 'helper' },
      { state: 'true',   extra: { 'user-invocable': true },  kind: 'prompt' },
      { state: 'absent', extra: {},                          kind: 'prompt' },
   ])('user-invocable $state gives $kind', ({ extra, kind }) => {
      expect(classify('p.md', canonical({ extra })).kind).toBe(kind);
   });

   it.each([
      { when: 'a blank line comes before the opening ---', text: `\n${canonical()}` },
      { when: 'the closing --- is missing',                text: '---\nname: fake-prompt\nBody, no closing line.\n' },
   ])('is not a prompt when $when', ({ text }) => {
      expect(classify('p.md', text).kind).toBe('none');
   });
});
