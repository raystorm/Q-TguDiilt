import { describe, it, expect } from 'vitest';
import { agents, canonical, FILE, stopOf } from './fixtures.js';

/**
 * Pins down every case where the transform refuses a file. Each refusal is
 * checked for both agents: the render throws a TransformError that carries the
 * label the caller passed, the reason and the slot or name at fault, and
 * returns nothing.
 */

/** Both agents must refuse the text the same way. `detail` is any text when not given. */
function expectStop(text: string, reason: string, detail: unknown = expect.any(String)): void {
   const expected = { reason, file: FILE, detail };
   const seen     = Object.fromEntries(agents.map(({ agent, render }) => {
      const stop = stopOf(() => render(text));
      return [agent, { reason: stop.reason, file: stop.file, detail: stop.detail }];
   }));
   expect(seen).toEqual({ Kiro: expected, Copilot: expected });
}

const tokens = (slots: string[]) => [...new Set(slots)].map((slot) => `{{${slot}}}`).join(' ');

describe('stops: input mixed with another slot', () => {
   it.each([
      { slots: ['input', 'to'] },
      { slots: ['to', 'input'] },
   ])('arguments $slots stops with input_mixed', ({ slots }) => {
      expectStop(canonical({ arguments: slots, body: tokens(slots) }), 'input_mixed');
   });
});

describe('stops: a slot declared twice', () => {
   it.each([
      { slots: ['to', 'to'],         slot: 'to' },
      { slots: ['input', 'input'],   slot: 'input' },
      { slots: ['to', 'task', 'to'], slot: 'to' },
   ])('arguments $slots stops with slot_repeated for $slot', ({ slots, slot }) => {
      expectStop(canonical({ arguments: slots, body: tokens(slots) }), 'slot_repeated', slot);
   });
});

describe('stops: a declared slot missing from the body', () => {
   it.each([
      { slots: ['to', 'task'], body: '{{to}}',    slot: 'task' },
      { slots: ['input'],      body: 'No token.', slot: 'input' },
      { slots: ['to'],         body: '{{ to }}',  slot: 'to' },
   ])('arguments $slots with body "$body" stops with slot_unused for $slot', ({ slots, body, slot }) => {
      expectStop(canonical({ arguments: slots, body }), 'slot_unused', slot);
   });
});

describe('stops: the name rule', () => {
   it.each([
      { label: '64 characters',                 name: 'a'.repeat(64),      ok: true },
      { label: '65 characters',                 name: 'a'.repeat(65),      ok: false },
      { label: 'one letter',                    name: 'a',                 ok: true },
      { label: 'a number first',                name: '1st',               ok: true },
      { label: 'a leading underscore',          name: '_lead',             ok: true },
      { label: 'a capital first',               name: 'Debug',             ok: true },
      { label: 'camelCase',                     name: 'debugProfile',      ok: true },
      { label: 'underscore and hyphen',         name: 'debug_full-v2',     ok: true },
      { label: 'colon, space, dot, underscore', name: 'debug:full v2.1_a', ok: false },
      { label: 'a space inside',                name: 'a b',               ok: false },
      { label: 'a trailing space',              name: 'lead ',             ok: false },
      { label: 'a dot',                         name: 'a.b',               ok: false },
      { label: 'a colon',                       name: 'a:b',               ok: false },
      { label: 'a leading hyphen',              name: '-lead',             ok: false },
      { label: 'a leading dot',                 name: '.lead',             ok: false },
      { label: 'a leading space',               name: ' lead',             ok: false },
      { label: 'empty',                         name: '',                  ok: false },
      { label: 'a slash',                       name: 'a/b',               ok: false },
      { label: 'a backslash',                   name: 'a\\b',              ok: false },
      { label: 'an asterisk',                   name: 'a*b',               ok: false },
      { label: 'an at sign',                    name: 'a@b',               ok: false },
      { label: 'a tab',                         name: 'a\tb',              ok: false },
      { label: 'a letter outside A to Z',       name: 'café',              ok: false },
   ])('a name with $label: ok is $ok', ({ name, ok }) => {
      const text = canonical({ name });
      if (ok) {
         for (const { render } of agents) { expect(() => render(text)).not.toThrow(); }
      } else {
         expectStop(text, 'name_invalid', name);
      }
   });
});

describe('stops: arguments is not a list of slot names', () => {
   it.each([
      { label: 'text, not a list',    value: 'to' },
      { label: 'an empty entry',      value: ['to', ''] },
      { label: 'a number entry',      value: ['to', 3] },
      { label: 'an entry with space', value: ['to', 'two words'] },
   ])('arguments with $label stops with arguments_invalid', ({ value }) => {
      expectStop(canonical({ arguments: value, body: '{{to}}' }), 'arguments_invalid');
   });
});
