import { describe, it, expect } from 'vitest';
import { matchCommandGlob } from '../command-glob.js';

/**
 * Exhaustive, direct tests for the command-glob matcher itself, isolated
 * from governance rule evaluation. This replaces `minimatch` specifically
 * because `minimatch` treats `*` as "matches everything except `/`"
 * (correct for filesystem path globs, wrong here: command arguments,
 * file paths, and script text routinely contain `/`). `matchCommandGlob`
 * has no path semantics — `*` and `?` match any character, `/` included.
 */

describe('matchCommandGlob — literal text', () => {
   it('matches an identical literal string', () => {
      expect(matchCommandGlob('npm test', 'npm test')).toBe(true);
   });

   it('does not match a different literal string', () => {
      expect(matchCommandGlob('npm test', 'npm build')).toBe(false);
   });

   it('does not match a substring (full match required)', () => {
      expect(matchCommandGlob('npm test --watch', 'npm test')).toBe(false);
   });

   it('does not match a superstring (full match required)', () => {
      expect(matchCommandGlob('npm test', 'npm test --watch')).toBe(false);
   });

   it('matches an empty string against an empty pattern', () => {
      expect(matchCommandGlob('', '')).toBe(true);
   });

   it('does not match an empty string against a non-empty pattern', () => {
      expect(matchCommandGlob('', 'a')).toBe(false);
   });

   it('is case-sensitive', () => {
      expect(matchCommandGlob('NPM TEST', 'npm test')).toBe(false);
   });
});

describe('matchCommandGlob — `*` wildcard', () => {
   it('`*` matches zero characters', () => {
      expect(matchCommandGlob('npm test', 'npm test*')).toBe(true);
   });

   it('`*` matches one or more characters', () => {
      expect(matchCommandGlob('npm test --watch', 'npm test*')).toBe(true);
   });

   it('`*` matches characters containing a slash', () => {
      // The defect this matcher exists to fix: minimatch\'s `*` does not
      // cross `/` (path-segment semantics); command text routinely does.
      expect(matchCommandGlob('cat /etc/passwd', 'cat *')).toBe(true);
   });

   it('`*` matches a path with multiple slashes', () => {
      expect(matchCommandGlob('cat some/nested/path.txt', 'cat *')).toBe(true);
   });

   it('`*` matches characters containing a backslash', () => {
      expect(matchCommandGlob('cat C:\\Users\\x\\file.txt', 'cat *')).toBe(true);
   });

   it('leading `*` matches a prefix', () => {
      expect(matchCommandGlob('foo npm test', '*npm test')).toBe(true);
   });

   it('`*` in the middle matches an infix', () => {
      expect(matchCommandGlob('npm run build', 'npm*build')).toBe(true);
   });

   it('multiple `*` in one pattern all resolve independently', () => {
      expect(matchCommandGlob('git commit -m "x" --amend', 'git commit *-m*--amend')).toBe(true);
   });

   it('bare `*` matches any string, including empty', () => {
      expect(matchCommandGlob('', '*')).toBe(true);
      expect(matchCommandGlob('anything at all', '*')).toBe(true);
   });

   it('`*` does not allow a pattern to match when a required literal segment is missing', () => {
      expect(matchCommandGlob('npm build', 'npm test*')).toBe(false);
   });
});

describe('matchCommandGlob — `?` wildcard', () => {
   it('`?` matches exactly one character', () => {
      expect(matchCommandGlob('cat a', 'cat ?')).toBe(true);
   });

   it('`?` does not match zero characters', () => {
      expect(matchCommandGlob('cat ', 'cat ?')).toBe(false);
   });

   it('`?` does not match two characters', () => {
      expect(matchCommandGlob('cat ab', 'cat ?')).toBe(false);
   });

   it('`?` matches a slash character', () => {
      expect(matchCommandGlob('cat /', 'cat ?')).toBe(true);
   });

   it('multiple `?` each match exactly one character', () => {
      expect(matchCommandGlob('cat ab', 'cat ??')).toBe(true);
      expect(matchCommandGlob('cat abc', 'cat ??')).toBe(false);
   });
});

describe('matchCommandGlob — regex-special characters are literal', () => {
   it('`.` is literal, not "any character"', () => {
      expect(matchCommandGlob('cat axb', 'cat a.b')).toBe(false);
      expect(matchCommandGlob('cat a.b', 'cat a.b')).toBe(true);
   });

   it('`+` is literal', () => {
      expect(matchCommandGlob('echo a+b', 'echo a+b')).toBe(true);
      expect(matchCommandGlob('echo aab', 'echo a+b')).toBe(false);
   });

   it('parentheses are literal', () => {
      expect(matchCommandGlob('awk system(ls)', 'awk system(ls)')).toBe(true);
   });

   it('square brackets are literal, not a character class', () => {
      expect(matchCommandGlob('echo [a]', 'echo [a]')).toBe(true);
      expect(matchCommandGlob('echo a', 'echo [a]')).toBe(false);
   });

   it('caret and dollar sign are literal, not anchors', () => {
      expect(matchCommandGlob('echo ^a$', 'echo ^a$')).toBe(true);
   });

   it('pipe is literal, not alternation', () => {
      expect(matchCommandGlob('echo a|b', 'echo a|b')).toBe(true);
      expect(matchCommandGlob('echo a', 'echo a|b')).toBe(false);
   });

   it('curly braces are literal, not a quantifier', () => {
      expect(matchCommandGlob('echo a{2}', 'echo a{2}')).toBe(true);
   });

   it('backslash is literal, not an escape introducer', () => {
      expect(matchCommandGlob('echo a\\b', 'echo a\\b')).toBe(true);
   });
});

describe('matchCommandGlob — real-world governance patterns', () => {
   it('"date -s *" matches a clock-set invocation', () => {
      expect(matchCommandGlob('date -s "12:00"', 'date -s *')).toBe(true);
   });

   it('"sed *-i*" matches an in-place edit with a path argument', () => {
      expect(matchCommandGlob("sed -i 's/a/b/' file.txt", 'sed *-i*')).toBe(true);
   });

   it('"sed *" matches a non-in-place invocation containing slashes', () => {
      expect(matchCommandGlob("sed 's/a/b/' file.txt", 'sed *')).toBe(true);
   });

   it('"awk *system(*" matches a script invoking system(...)', () => {
      expect(matchCommandGlob('awk \'{ system("ls") }\' file.txt', 'awk *system(*')).toBe(true);
   });

   it('"awk *" matches a script with no system(...) call, slashes included', () => {
      expect(matchCommandGlob("awk '{ print $1/2 }' file.txt", 'awk *')).toBe(true);
   });
});
