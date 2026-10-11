/**
 * Shadowed-rule detection. Rules are first-match-wins, so a rule that an
 * earlier rule already decides for everything it could match is dead, and
 * a later, stricter rule hidden behind an `approve` is a likely mistake.
 *
 * The check is conservative: it may miss cases but never reports a rule
 * that can still match something its earlier rule does not. It only warns
 * (see the engine); it never changes a decision.
 */
import { pathUnder } from './path-match.js';
import { GovernanceRule, PATH_KINDS, RESTRICTIVENESS } from './types.js';
import type { ToolCallKind } from '../drivers/governed-driver.js';

/** The kinds a rule can reach: its own, `execute` for a bare pattern, else every kind with paths. */
export function ruleKinds(rule: GovernanceRule): readonly ToolCallKind[] {
   if (undefined !== rule.kind)    { return [rule.kind]; }
   if (undefined !== rule.pattern) { return ['execute']; }
   return PATH_KINDS;
}

/** True when `earlier`'s path, files and pattern constraints include all of `later`'s. */
function constraintsCover(earlier: GovernanceRule, later: GovernanceRule): boolean {
   if (undefined !== earlier.path && (undefined === later.path || !pathUnder(later.path, earlier.path)))
   { return false; }

   const earlierFiles = earlier.files;
   if (undefined !== earlierFiles) {
      if (undefined === later.files) { return false; }
      if (!earlierFiles.includes('*') && !later.files.every(entry => earlierFiles.includes(entry)))
      { return false; }
   }

   return undefined === earlier.pattern || '*' === earlier.pattern || earlier.pattern === later.pattern;
}

/**
 * True when `earlier` makes `later` dead: its constraints cover `later`'s
 * and it reaches every kind `later` does. One deliberate extension: an
 * `approve` that reaches only some of a later, stricter rule's kinds still
 * hides that rule for those kinds, so that direction warns on any overlap.
 */
function isShadowedBy(later: GovernanceRule, earlier: GovernanceRule): boolean {
   if (!constraintsCover(earlier, later)) { return false; }
   const earlierKinds = ruleKinds(earlier);
   const laterKinds   = ruleKinds(later);
   if (laterKinds.every(kind => earlierKinds.includes(kind))) { return true; }
   return 'approve' === earlier.action
      && RESTRICTIVENESS[later.action] > RESTRICTIVENESS[earlier.action]
      && laterKinds.some(kind => earlierKinds.includes(kind));
}

export interface Shadowing {
   /** Position (0-based) of the shadowed rule. */
   rule:       number;
   /** Position (0-based) of the first earlier rule that shadows it. */
   shadowedBy: number;
}

/** Each shadowed rule paired with the first earlier rule that shadows it. */
export function findShadowedRules(rules: GovernanceRule[]): Shadowing[] {
   const found: Shadowing[] = [];
   rules.forEach((later, rule) => {
      const shadowedBy = rules.slice(0, rule).findIndex(earlier => isShadowedBy(later, earlier));
      if (-1 !== shadowedBy) { found.push({ rule, shadowedBy }); }
   });
   return found;
}
