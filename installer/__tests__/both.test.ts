import { describe, it, expect } from 'vitest';
import { classify } from '../transform.js';
import { agents, canonical, parts } from './fixtures.js';

/**
 * Pins down what holds for both agents: where the frontmatter ends, which
 * tokens are replaced and which are left alone, that only tokens change, that
 * the transform is pure, and that line endings survive. Each test runs once for
 * Kiro and once for Copilot.
 */

type Token = (slot: number | 'input') => string;

/** Turns an agent's tokens back into `{{slot}}`, to compare a rendered body with its source. */
function restore(body: string, slots: string[], token: Token): string {
   return slots.reduce(
      (text, slot, index) => text.split(token('input' === slot ? 'input' : index + 1)).join(`{{${slot}}}`),
      body,
   );
}

describe.each(agents)('$agent', ({ render, token }) => {
   const bodyOf = (text: string) => parts(render(text).text).body;

   it('ends the frontmatter at the first closing --- and keeps every later --- line in the body', () => {
      const body = 'Intro {{to}}\n---\nMiddle\n---\nEnd {{to}}\n';
      expect(bodyOf(canonical({ arguments: ['to'], body })))
         .toBe(`Intro ${token(1)}\n---\nMiddle\n---\nEnd ${token(1)}\n`);
   });

   it('replaces only the declared slot and leaves other {{...}} as written', () => {
      const body = 'A {{profile}}\n{{profileName}} {{profileName}}\n{{contextPercent}}\n{{profileName or "None"}}\n';
      expect(bodyOf(canonical({ arguments: ['profile'], body })))
         .toBe(`A ${token(1)}\n{{profileName}} {{profileName}}\n{{contextPercent}}\n{{profileName or "None"}}\n`);
   });

   it('replaces only the exact token {{name}}, case-sensitive and without spaces', () => {
      const body = '{{ to }} {{To}} {to} {{to}}\n';
      expect(bodyOf(canonical({ arguments: ['to'], body }))).toBe(`{{ to }} {{To}} {to} ${token(1)}\n`);
   });

   it('keeps dollar-sign text in the body as it is', () => {
      const special = ['$&', '$1', '$$', '$`', '$\''].join(' ');
      const body    = `Costs ${special} then {{to}}\n`;
      expect(bodyOf(canonical({ arguments: ['to'], body }))).toBe(`Costs ${special} then ${token(1)}\n`);
   });

   it('replaces a token in a sentence, in an inline code span and in a list item', () => {
      const body = 'In a sentence {{to}}.\nIn code `{{to}}` here.\n- in a list {{to}}\n';
      expect(bodyOf(canonical({ arguments: ['to'], body })))
         .toBe(`In a sentence ${token(1)}.\nIn code \`${token(1)}\` here.\n- in a list ${token(1)}\n`);
   });

   it('does not confuse a slot whose name starts another slot name', () => {
      const text = canonical({ arguments: ['to', 'topic', 'to2'], body: '{{to}} {{topic}} {{to2}}\n' });
      expect(bodyOf(text)).toBe(`${token(1)} ${token(2)} ${token(3)}\n`);
   });

   it.each([
      {
         label: 'positional slots',
         slots: ['to', 'task'],
         body:  'Intro {{to}}\n---\n{{profileName}} costs $& and $$\n{{task}} {{to}}\n',
      },
      {
         label: 'the input slot',
         slots: ['input'],
         body:  'Say {{input}}\n---\n{{other}} $1 $\'\n',
      },
   ])('changes only the tokens of $label', ({ slots, body }) => {
      expect(restore(bodyOf(canonical({ arguments: slots, body })), slots, token)).toBe(body);
   });

   it('is pure: the same input gives the same output', () => {
      const text   = canonical({ arguments: ['to', 'task'], body: '{{to}} {{task}} {{to}}\n' });
      const first  = render(text);
      const second = render(text);
      expect(second).toEqual(first);
   });

   it('keeps CRLF line endings, and classifies the file as before', () => {
      const text = canonical({ arguments: ['to'], body: 'Line {{to}}\nSecond {{to}}\n' }).replace(/\n/g, '\r\n');
      expect(classify('p.md', text).kind).toBe('prompt');
      expect(bodyOf(text)).toBe(`Line ${token(1)}\r\nSecond ${token(1)}\r\n`);
   });
});
