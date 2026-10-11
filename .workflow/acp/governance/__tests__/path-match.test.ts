import { describe, it, expect } from 'vitest';
import { hasParentSegment, lastSegment, matchesName, pathUnder } from '../path-match.js';

/**
 * Direct tests for the path and file-name matchers, isolated from rule
 * evaluation. `matchesName` is hand-written (no glob library), so its
 * multi-wildcard and boundary behavior is pinned down here.
 */

describe('matchesName — literal and single wildcard', () => {
   it('matches an identical name, and nothing else', () => {
      expect(matchesName('a.ts', 'a.ts')).toBe(true);
      expect(matchesName('a.ts', 'b.ts')).toBe(false);
      expect(matchesName('a.tsx', 'a.ts')).toBe(false);
   });

   it('* alone matches any name, including empty and dot-files', () => {
      for (const name of ['', 'a', '.env', '.k.pem']) { expect(matchesName(name, '*')).toBe(true); }
   });

   it('a leading * matches any run before the suffix, including none and a leading dot', () => {
      expect(matchesName('a.ts', '*.ts')).toBe(true);
      expect(matchesName('.ts', '*.ts')).toBe(true);
      expect(matchesName('a.tsx', '*.ts')).toBe(false);
   });

   it('a trailing * matches any run after the prefix, including none', () => {
      expect(matchesName('.env', '.env*')).toBe(true);
      expect(matchesName('.env.local', '.env*')).toBe(true);
      expect(matchesName('.en', '.env*')).toBe(false);
   });

   it('a middle * matches any run between the ends', () => {
      expect(matchesName('ac', 'a*c')).toBe(true);
      expect(matchesName('abbbc', 'a*c')).toBe(true);
      expect(matchesName('abd', 'a*c')).toBe(false);
   });

   it('is case-sensitive', () => {
      expect(matchesName('A.TS', '*.ts')).toBe(false);
   });
});

describe('matchesName — several wildcards and boundaries', () => {
   it('matches pieces in order', () => {
      expect(matchesName('abc', 'a*b*c')).toBe(true);
      expect(matchesName('aXbYc', 'a*b*c')).toBe(true);
      expect(matchesName('acb', 'a*b*c')).toBe(false);
      expect(matchesName('ab', 'a*b*c')).toBe(false);
   });

   it('does not let the prefix and suffix overlap', () => {
      expect(matchesName('ab', 'ab*b')).toBe(false);
      expect(matchesName('abb', 'ab*b')).toBe(true);
   });

   it('does not let a middle piece run into the suffix', () => {
      expect(matchesName('abc', 'a*bc*c')).toBe(false);
      expect(matchesName('abcc', 'a*bc*c')).toBe(true);
   });

   it('consecutive wildcards behave as one', () => {
      expect(matchesName('ac', 'a**c')).toBe(true);
      expect(matchesName('abc', 'a**c')).toBe(true);
   });

   it('every other character is literal, including regex and glob characters', () => {
      expect(matchesName('axb', 'a.b')).toBe(false);
      expect(matchesName('a.b', 'a.b')).toBe(true);
      expect(matchesName('a(x)+', 'a(x)+')).toBe(true);
      expect(matchesName('abc', 'a?c')).toBe(false);
      expect(matchesName('a?c', 'a?c')).toBe(true);
   });
});

describe('pathUnder', () => {
   it('matches the path itself and everything under it', () => {
      for (const path of ['/proj/src', '/proj/src/a.ts', '/proj/src/a/b/c.ts']) {
         expect(pathUnder(path, '/proj/src')).toBe(true);
      }
   });

   it('matches whole segments only', () => {
      expect(pathUnder('/proj/src-old/a', '/proj/src')).toBe(false);
      expect(pathUnder('/proj/srcfoo', '/proj/src')).toBe(false);
   });

   it('ignores trailing slashes on either side', () => {
      expect(pathUnder('/proj/src/', '/proj/src')).toBe(true);
      expect(pathUnder('/proj/src', '/proj/src/')).toBe(true);
      expect(pathUnder('/proj/src-old', '/proj/src/')).toBe(false);
   });

   it('the root matches every absolute path and no relative one', () => {
      expect(pathUnder('/anything/at/all', '/')).toBe(true);
      expect(pathUnder('/', '/')).toBe(true);
      expect(pathUnder('src/a.ts', '/')).toBe(false);
   });

   it('normalizes nothing: relative paths and doubled slashes do not match', () => {
      expect(pathUnder('src/a.ts', '/proj/src')).toBe(false);
      expect(pathUnder('/proj//src/a', '/proj/src')).toBe(false);
   });
});

describe('lastSegment', () => {
   it('returns the final name, ignoring trailing slashes', () => {
      expect(lastSegment('/a/b.ts')).toBe('b.ts');
      expect(lastSegment('/a/b/')).toBe('b');
      expect(lastSegment('b.ts')).toBe('b.ts');
      expect(lastSegment('/')).toBe('');
   });
});

describe('hasParentSegment', () => {
   it('is true for a whole ".." segment anywhere', () => {
      for (const path of ['/a/../b', '..', '../a', '/a/..']) { expect(hasParentSegment(path)).toBe(true); }
   });

   it('is false for "." segments and names that merely contain dots', () => {
      for (const path of ['/a/..b', '/a/b..', '/a/./b', '/a/...', '/a/.hidden']) {
         expect(hasParentSegment(path)).toBe(false);
      }
   });
});
