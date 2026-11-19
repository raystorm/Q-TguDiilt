import { describe, it, expect } from 'vitest';
import { renderCopilot } from '../transform.js';
import { canonical, FILE, parts } from './fixtures.js';

/**
 * Pins down the Copilot skill form: `{{slot}}` becomes `$(n)` and `{{input}}`
 * becomes `$(input)`. The frontmatter keeps only name, description, version
 * and argument-hint (each when the source has it) and, for a skill made from a
 * prompt, `disable-model-invocation: true`. The folder is the kebab-case name.
 */

const copilot = (text: string) => renderCopilot(FILE, text, 'prompt');

describe('renderCopilot', () => {
   it('writes positional slots as $(n) and the input slot as $(input)', () => {
      const positional = canonical({ arguments: ['to', 'task'], body: '{{task}} for {{to}}, {{to}}.\n' });
      const free       = canonical({ arguments: ['input'],      body: 'Text: {{input}}.\n' });
      expect(parts(copilot(positional).text).body).toBe('$(2) for $(1), $(1).\n');
      expect(parts(copilot(free).text).body).toBe('Text: $(input).\n');
   });

   it('keeps only the allowed frontmatter keys', () => {
      const text = canonical({
         name:        'fake-prompt',
         version:     '0.0.0-fake',
         description: 'A fake prompt used only by tests.',
         arguments:   ['to'],
         hint:        '[fake-hint]',
         extra:       { 'user-invocable': true, owner: 'nobody' },
         body:        '{{to}}\n',
      });
      const { frontmatter } = parts(copilot(text).text);
      expect(Object.keys(frontmatter).sort())
         .toEqual(['argument-hint', 'description', 'disable-model-invocation', 'name', 'version']);
      expect(frontmatter).toMatchObject({ name: 'fake-prompt', 'argument-hint': '[fake-hint]' });
      expect(frontmatter).toHaveProperty('version');
      expect(String(frontmatter.description)).toContain('fake');
   });

   it('sets disable-model-invocation to true when the prompt does not state it', () => {
      const { frontmatter } = parts(copilot(canonical()).text);
      expect(frontmatter['disable-model-invocation']).toBe(true);
   });

   it('sets disable-model-invocation to true even when the prompt states false', () => {
      const text = canonical({ extra: { 'disable-model-invocation': false } });
      expect(parts(copilot(text).text).frontmatter['disable-model-invocation']).toBe(true);
   });

   it('leaves out version and argument-hint when the prompt has none, and writes no empty value', () => {
      const text            = canonical({ description: 'A fake prompt used only by tests.' });
      const { frontmatter } = parts(copilot(text).text);
      expect(Object.keys(frontmatter).sort()).toEqual(['description', 'disable-model-invocation', 'name']);
      for (const value of Object.values(frontmatter)) { expect(['', null, undefined]).not.toContain(value); }
   });

   it.each([
      { name: 'handoff',              folder: 'handoff' },
      { name: 'as',                   folder: 'as' },
      { name: 'send-epr',             folder: 'send-epr' },
      { name: 'debugCurrent',         folder: 'debug-current' },
      { name: 'debugFull',            folder: 'debug-full' },
      { name: 'debugProfile',         folder: 'debug-profile' },
      { name: 'internalWorkflowScan', folder: 'internal-workflow-scan' },
      { name: 'Debug',                folder: 'debug' },
      { name: '_Commands',            folder: '_commands' },
      { name: 'HTTPServer',           folder: 'http-server' },
      { name: 'getHTTPResponse',      folder: 'get-http-response' },
      { name: 'v2Beta',               folder: 'v2-beta' },
      { name: 'foo-Bar',              folder: 'foo-bar' },
      { name: 'ABC',                  folder: 'abc' },
   ])('names the skill $name and puts it in the folder $folder', ({ name, folder }) => {
      const result = copilot(canonical({ name }));
      expect(parts(result.text).frontmatter.name).toBe(name);
      expect(result.folder).toBe(folder);
   });
});
