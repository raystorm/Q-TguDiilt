import { describe, it, expect } from 'vitest';
import { renderKiro } from '../transform.js';
import { canonical, FILE, parts } from './fixtures.js';

/**
 * Pins down the Kiro form: `{{slot}}` becomes `${n}`, where n is the slot's
 * position in `arguments`, and `{{input}}` becomes `$ARGUMENTS`. The
 * frontmatter is kept whole. A prompt that declares nothing is not changed.
 */

const kiro = (text: string) => renderKiro(FILE, text, 'prompt').text;

describe('renderKiro', () => {
   it('writes each positional slot as ${n}, wherever it stands', () => {
      const body = 'Send to {{to}}. Task: {{task}}. Again {{to}}.\n';
      const text = canonical({ arguments: ['to', 'task'], body });
      expect(parts(kiro(text)).body).toBe('Send to ${1}. Task: ${2}. Again ${1}.\n');
   });

   it('numbers a slot by its place in arguments, not by its place in the body', () => {
      const text = canonical({ arguments: ['to', 'task'], body: 'Task {{task}} for {{to}}.\n' });
      expect(parts(kiro(text)).body).toBe('Task ${2} for ${1}.\n');
   });

   it('writes the input slot as $ARGUMENTS', () => {
      const text = canonical({ arguments: ['input'], body: 'Text: {{input}} and {{input}}.\n' });
      expect(parts(kiro(text)).body).toBe('Text: $ARGUMENTS and $ARGUMENTS.\n');
   });

   it('keeps the frontmatter, every key and value', () => {
      const text = canonical({
         name:        'fake-prompt',
         version:     '0.0.0-fake',
         description: 'A fake prompt used only by tests.',
         arguments:   ['to'],
         hint:        '[fake-hint]',
         extra:       { 'user-invocable': true },
         body:        '{{to}}\n',
      });
      expect(parts(kiro(text)).frontmatter).toEqual(parts(text).frontmatter);
   });

   it.each([
      { state: 'absent',        declared: undefined },
      { state: 'an empty list', declared: [] },
   ])('returns the text unchanged when arguments is $state', ({ declared }) => {
      const text = canonical({ arguments: declared, body: 'Keep {{to}} as it is.\n' });
      expect(kiro(text)).toBe(text);
   });
});
