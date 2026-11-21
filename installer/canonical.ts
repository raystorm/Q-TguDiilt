import { load as parseYaml } from 'js-yaml';
import type { Contents } from './io.js';

/** The text of a canonical file, without a leading byte-order mark. */
export const readText = (file: Contents) => file.data.toString('utf8').replace(/^\uFEFF/, '');

/** The first line of an error's message. js-yaml adds a snippet of the file after it. */
export const firstLine = (error: unknown) =>
   (error instanceof Error ? error.message : String(error)).split('\n')[0];

/**
 * The `name` in the frontmatter of `text`, or null when there is none. Throws when the frontmatter is
 * not valid YAML. The transform keeps its own copy of the frontmatter split and exposes only
 * `classify` and the renders, so the name is read here.
 */
export function nameOf(text: string): string | null
{
   const lines = text.split('\n');
   const fence = (line: string) => '---' === line.replace(/\r$/, '');
   const close = lines.findIndex((line, index) => 0 < index && fence(line));
   if (!fence(lines[0]) || -1 === close) { return null; }

   const data = parseYaml(lines.slice(1, close).join('\n'));
   const name = 'object' === typeof data && null !== data ? (data as Record<string, unknown>).name : null;
   return 'string' === typeof name ? name : null;
}
