import { join, posix } from 'node:path';
import { firstLine, nameOf, readText } from './canonical.js';
import type { Contents, Io } from './io.js';
import { manifest } from './manifest.js';
import { classify, renderCopilot, renderKiro, TransformError } from './transform.js';

/** An authored skill: `.workflow/skills/<folder>/SKILL.md`. */
const SKILL = /^\.workflow\/skills\/([^/]+)\/SKILL\.md$/;

const contents = (text: string): Contents => ({ data: Buffer.from(text), executable: false });

/** What `generate` makes, and what it found wrong. */
export interface Generated
{
   files:  Array<[string, Contents]>;
   /** The Copilot skills made (folder and `name`), to compare with the target's `.github/skills`. */
   skills: Array<{ folder: string; name: string }>;
   stops:  string[];
}

/** The ignore file of one generated folder: exactly the generated names, one per line. */
const ignoreFile = (names: string[]) =>
   contents(`# Written by the installer.\n${[...names].sort().join('\n')}\n`);

/**
 * The files the installer generates from the canonical prompts and skills in `files`. Each prompt
 * gives a Kiro prompt and a Copilot skill; each authored skill gives a Kiro skill and a Copilot skill;
 * a folder where something is generated gets an ignore file. A helper prompt generates nothing.
 * A name or a file that cannot be installed is a stop: the run then writes nothing.
 */
export function generate(files: Map<string, Contents>): Generated
{
   const made: Array<[string, Contents]> = [];
   const skills: Generated['skills'] = [];
   const stops: string[] = [];
   const names: Array<{ name: string; path: string }> = [];
   const folders = new Map<string, string>();
   const kiroPrompts: string[] = [];
   const kiroSkills:  string[] = [];
   const agentSkills: string[] = [];

   for (const [path, file] of files)
   {
      const skill = SKILL.exec(path);
      if (null === skill && !path.startsWith(`${manifest.prompts}/`)) { continue; }
      try
      {
         const text     = readText(file);
         const expected = null !== skill ? skill[1] : posix.basename(path, '.md');
         const name     = nameOf(text);
         if (name !== expected)
         {
            const where = null !== skill ? 'folder' : 'file name';
            stops.push(`${path}: its name (${name ?? 'none'}) differs from its ${where}`);
            continue;
         }
         names.push({ name, path });
         if (null === skill && 'helper' === classify(path, text).kind) { continue; }

         const source  = null !== skill ? 'skill' : 'prompt';
         const kiro    = renderKiro(path, text, source);
         const copilot = renderCopilot(path, text, source);
         if (null !== skill)
         {
            made.push([`.kiro/skills/${name}/SKILL.md`, contents(kiro.text)]);
            kiroSkills.push(`${name}/`);
         }
         else
         {
            made.push([`.kiro/prompts/${name}.md`, contents(kiro.text)]);
            kiroPrompts.push(`${name}.md`);
         }
         made.push([`.agents/skills/${copilot.folder}/SKILL.md`, contents(copilot.text)]);
         agentSkills.push(`${copilot.folder}/`);
         skills.push({ folder: copilot.folder, name });

         const other = folders.get(copilot.folder);
         if (undefined === other) { folders.set(copilot.folder, path); }
         else { stops.push(`${path} and ${other}: both make the folder .agents/skills/${copilot.folder}`); }
      }
      catch (error)
      { stops.push(error instanceof TransformError ? error.message : `${path}: ${firstLine(error)}`); }
   }

   const seen = new Map<string, string>();
   for (const { name, path } of names)
   {
      const other = seen.get(name.toLowerCase());
      if (undefined === other) { seen.set(name.toLowerCase(), path); }
      else { stops.push(`${path} and ${other}: the names are the same when letter case is ignored`); }
   }

   const lists: Array<[string, string[]]> = [
      ['.kiro/prompts', kiroPrompts], ['.kiro/skills', kiroSkills], ['.agents/skills', agentSkills],
   ];
   for (const [folder, listed] of lists)
   {
      if (0 < listed.length) { made.push([`${folder}/.gitignore`, ignoreFile(listed)]); }
   }
   return { files: made, skills, stops };
}

/** A name read for a comparison: null when the file has none or cannot be read. */
function safeName(text: string): string | null
{
   try { return nameOf(text); }
   catch { return null; }
}

/**
 * A warning for each folder in the target's `.github/skills` that Copilot reads before `.agents/skills`
 * and that is named like a generated skill, or holds a `SKILL.md` with the same `name`. It is never
 * touched.
 */
export function shadowed(
   io: Io, target: string, skills: Generated['skills'],
): Array<{ path: string; detail: string }>
{
   const found: Array<{ path: string; detail: string }> = [];
   const entries = io.list(join(target, '.github/skills')).sort((a, b) => (a.name < b.name ? -1 : 1));
   for (const entry of entries)
   {
      if ('dir' !== entry.kind) { continue; }
      const path = `.github/skills/${entry.name}`;
      const file = io.read(join(target, path, 'SKILL.md'));
      const name = null === file ? null : safeName(readText(file));
      const hit  = skills.find((skill) => skill.folder === entry.name || skill.name === name);
      if (undefined === hit) { continue; }
      found.push({ path, detail: `Copilot reads it before .agents/skills, so it hides the skill ${hit.name}` });
   }
   return found;
}
