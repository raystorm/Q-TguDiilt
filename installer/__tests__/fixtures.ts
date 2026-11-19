import { load as parseYaml } from 'js-yaml';
import { renderCopilot, renderKiro, TransformError, type Source } from '../transform.js';

/**
 * Builds the text of a canonical prompt, so a test states only the fields it
 * cares about. A field left out is left out of the text. Each value is written
 * as JSON, which YAML reads back as the same value, so a test can also write
 * a value that is not valid (a number inside `arguments`, a name with a tab).
 * `name: null` leaves `name` out. `extra` adds any other key, in order.
 * Every value a test makes up says it is fake, so it is never mistaken for a
 * real prompt.
 */

export interface CanonicalFields {
   name?:        string | null;
   arguments?:   unknown;
   hint?:        string;
   version?:     string;
   description?: string;
   extra?:       Record<string, unknown>;
   body?:        string;
}

export function canonical(fields: CanonicalFields = {}): string {
   const { name = 'fake-prompt', body = 'Body.\n', extra = {} } = fields;
   const entries: Array<[string, unknown]> = [
      ['name',          name],
      ['version',       fields.version],
      ['description',   fields.description],
      ['arguments',     fields.arguments],
      ['argument-hint', fields.hint],
      ...Object.entries(extra),
   ];
   const lines = entries
      .filter(([, value]) => undefined !== value && null !== value)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
   return ['---', ...lines, '---', body].join('\n');
}

export const FILE = 'prompts/fake-prompt.md';

/**
 * Both renderers behind one shape. `token` is how an agent writes a slot:
 * the slot's 1-based position, or 'input' for the free-text slot.
 */
export const agents = [
   {
      agent:  'Kiro',
      render: (text: string, source: Source = 'prompt') => renderKiro(FILE, text, source),
      token:  (slot: number | 'input') => ('input' === slot ? '$ARGUMENTS' : '${' + slot + '}'),
   },
   {
      agent:  'Copilot',
      render: (text: string, source: Source = 'prompt') => renderCopilot(FILE, text, source),
      token:  (slot: number | 'input') => `$(${slot})`,
   },
];

/** The TransformError a render throws; fails the test when it returns or throws anything else. */
export function stopOf(render: () => unknown): TransformError {
   try {
      render();
   } catch (error) {
      if (error instanceof TransformError) { return error; }
      throw error;
   }
   throw new Error('expected a TransformError, but the render returned');
}

/**
 * Splits a rendered or canonical text into its parsed frontmatter and its
 * body (everything after the first closing `---` line, line endings kept).
 * Written apart from the transform on purpose, so a test does not rely on it.
 */
export function parts(text: string): { frontmatter: Record<string, unknown>; body: string } {
   const lines = text.split('\n');
   const close = lines.findIndex((line, index) => 0 < index && '---' === line.replace(/\r$/, ''));
   return {
      frontmatter: parseYaml(lines.slice(1, close).join('\n')) as Record<string, unknown>,
      body:        lines.slice(close + 1).join('\n'),
   };
}
