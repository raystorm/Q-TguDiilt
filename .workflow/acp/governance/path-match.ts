/**
 * Hand-written path and file-name matching for governance rules.
 *
 * Rule keys `path` and `files` match filesystem paths, but a path-glob
 * library such as `minimatch` is the wrong tool: its `*` stops at `/`, a
 * leading dot needs a special option, and `**` / brace syntax add behavior
 * no rule here asks for. `pathUnder` is a plain whole-segment prefix test.
 * `matchesName` matches one file name, where `*` matches any run of
 * characters (including none and a leading dot) and every other character,
 * `?` and regex characters included, is literal. Matching is case-sensitive
 * and anchored to the whole name. Nothing is resolved or normalized: a
 * relative path does not match an absolute prefix, doubled slashes are not
 * collapsed, and symlinks are ordinary paths.
 */

function stripTrailingSlashes(path: string): string {
   return path.replace(/\/+$/, '');
}

/** True when `path` is `base` itself or lies under it, on whole segments. */
export function pathUnder(path: string, base: string): boolean {
   const target = stripTrailingSlashes(path);
   const prefix = stripTrailingSlashes(base);
   return target === prefix || target.startsWith(`${prefix}/`);
}

/** The final path segment (the file or directory name), ignoring trailing slashes. */
export function lastSegment(path: string): string {
   const trimmed = stripTrailingSlashes(path);
   return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

/** Matches one file name against one `files` entry; `*` is the only wildcard. */
export function matchesName(name: string, entry: string): boolean {
   const parts = entry.split('*');
   if (1 === parts.length) { return name === entry; }

   const first = parts[0];
   const last  = parts[parts.length - 1];
   const tail  = name.length - last.length;
   if (!name.startsWith(first) || tail < first.length || !name.endsWith(last)) { return false; }

   let position = first.length;
   for (const middle of parts.slice(1, -1)) {
      const at = name.indexOf(middle, position);
      if (-1 === at || at + middle.length > tail) { return false; }
      position = at + middle.length;
   }
   return true;
}

/** True when a path has a `..` segment, split on `/` and, for Windows paths, `\`. Only whole segments count. */
export function hasParentSegment(path: string): boolean {
   return path.split(/[\\/]/).includes('..');
}
