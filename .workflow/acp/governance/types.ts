/**
 * Governance config and decision types.
 *
 * The Governance Engine evaluates every AI command against a
 * declarative YAML config and produces a `Decision` consumed by the ACP
 * Service Boundary.
 */
import { AskDetails } from '../shared/types.js';
import type { ToolCallKind } from '../drivers/governed-driver.js';

/**
 * A single governance rule: an `action` plus at least one constraint.
 * Every constraint a rule names must match. A rule with only a `pattern`
 * governs shell commands (kind `execute`).
 */
export interface GovernanceRule {
   action:   GovernanceAction;
   pattern?: string;
   kind?:    ToolCallKind;
   path?:    string;
   files?:   string[];
}

export type GovernanceAction = 'approve' | 'deny' | 'ask';

/** Most-restrictive-wins ranking for reducing multiple decisions. */
export const RESTRICTIVENESS: Record<GovernanceAction, number> = { deny: 2, ask: 1, approve: 0 };

/** Kinds whose reports carry file paths: the only ones `path` and `files` can constrain. */
export const PATH_KINDS: readonly ToolCallKind[] = ['read', 'edit', 'delete', 'move', 'search'];

/** Parsed shape of the `governance:` YAML config. */
export interface GovernanceConfig {
   rules:    GovernanceRule[];
   default:  GovernanceAction;
}

/**
 * The outcome of evaluating a command against the governance config.
 * `matchedRule` is the pattern that matched, or omitted when the
 * configured `default` action applied. `details` is populated for `ask`
 * decisions with the enriched payload the user must see before approving.
 */
export interface Decision {
   action:      GovernanceAction;
   matchedRule?: string;
   details?:    AskDetails;
   /** Why the result was forced: `missing_command`, `missing_paths`, `missing_details` or `parent_segment`. */
   reason?:     string;
}
