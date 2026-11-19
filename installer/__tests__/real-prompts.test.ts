import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { classify, renderCopilot } from '../transform.js';
import { agents, parts } from './fixtures.js';

/**
 * Renders every real prompt in `.workflow/prompts/` for both agents. This is
 * the one test file that reads that folder.
 */

const DIR   = fileURLToPath(new URL('../../.workflow/prompts/', import.meta.url));
const files = readdirSync(DIR).filter((file) => file.endsWith('.md')).sort();
const texts = Object.fromEntries(files.map((file) => [file, readFileSync(`${DIR}${file}`, 'utf8')]));

const kindOf       = (file: string) => classify(file, texts[file]).kind;
const prompts      = files.filter((file) => 'prompt' === kindOf(file));
const placeholders = (text: string) => text.match(/\{\{[^}]*\}\}/g) ?? [];

// A word of a name, for finding its words: a run of capitals that is not the start of a
// capitalised word (`HTTP` in `HTTPServer`), or an optional capital then lower-case letters and numbers.
const WORD     = /[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+/g;
/** The expected folder, worked out from the words of a name and written apart from the transform. */
const folderOf = (name: string) => name.split(/([_-])/)
   .map((part) => (part.match(WORD) ?? [part]).join('-').toLowerCase())
   .join('');
const camelFolders: Record<string, string> = {
   debugCurrent:         'debug-current',
   debugFull:            'debug-full',
   debugProfile:         'debug-profile',
   internalWorkflowScan: 'internal-workflow-scan',
};

describe.each(agents)('$agent: every real prompt', ({ render, token }) => {
   it.each(prompts)('renders %s with its declared slots and no other change', (file) => {
      const source   = parts(texts[file]);
      const declared = (source.frontmatter.arguments ?? []) as string[];
      const body     = parts(render(texts[file]).text).body;

      declared.forEach((slot, index) => {
         expect(body).toContain(token('input' === slot ? 'input' : index + 1));
         expect(body).not.toContain(`{{${slot}}}`);
      });
      const others = placeholders(source.body).filter((found) => !declared.includes(found.slice(2, -2)));
      expect(placeholders(body)).toEqual(others);
   });
});

describe('the real prompts folder', () => {
   it('classifies send-template as helper, hello.md as none and every other file as prompt', () => {
      const special: Record<string, string> = { 'send-template.md': 'helper', 'hello.md': 'none' };
      for (const file of files) { expect([file, kindOf(file)]).toEqual([file, special[file] ?? 'prompt']); }
   });

   it('gives each prompt its own Copilot folder, worked out here from its name', () => {
      const folders = prompts.map((file) => {
         const name       = parts(texts[file]).frontmatter.name as string;
         const { folder } = renderCopilot(file, texts[file], 'prompt');
         expect(folder).toBe(folderOf(name));
         expect(folder).toBe(camelFolders[name] ?? name);
         return folder;
      });
      expect(folders.length).toBeGreaterThan(0);
      expect(new Set(folders).size).toBe(folders.length);
   });
});
