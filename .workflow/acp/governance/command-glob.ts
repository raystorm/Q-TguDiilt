/**
 * Non-path-aware glob matcher for governance rule patterns.
 *
 * Governance patterns match arbitrary command text (file paths, shell
 * script arguments, URLs — all of which routinely contain `/`), not
 * filesystem paths. Path-glob libraries such as `minimatch` deliberately
 * make `*` stop at `/` (correct for path segments); using one here would
 * silently fail to match any command whose argument contains a slash
 * (e.g. `cat /etc/passwd` against `cat *`). `matchCommandGlob` supports
 * only `*` (zero or more of any character) and `?` (exactly one
 * character, including `/`); every other character is matched literally.
 * Matching is case-sensitive and anchored to the full string.
 */

const REGEXP_SPECIAL_EXCEPT_WILDCARDS = /[.+^${}()|[\]\\]/g;

/** Builds the cache lazily; governance configs are small and static per process. */
const compiledPatternCache = new Map<string, RegExp>();

function compilePattern(pattern: string): RegExp {
   const cached = compiledPatternCache.get(pattern);
   if (cached) { return cached; }

   let source = '';
   for (const char of pattern) {
      if ('*' === char) { source += '.*'; }
      else if ('?' === char) { source += '.'; }
      else { source += char.replace(REGEXP_SPECIAL_EXCEPT_WILDCARDS, '\\$&'); }
   }
   const regExp = new RegExp(`^${source}$`, 's');
   compiledPatternCache.set(pattern, regExp);
   return regExp;
}

/**
 * Tests whether `text` fully matches `pattern`. `*` matches zero or more
 * of any character (including `/` and newlines); `?` matches exactly one
 * character (including `/`); all other characters match literally.
 */
export function matchCommandGlob(text: string, pattern: string): boolean {
   return compilePattern(pattern).test(text);
}
