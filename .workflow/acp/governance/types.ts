/**
 * Governance config and decision types.
 *
 * The Governance Engine evaluates every AI command against a
 * declarative YAML config and produces a `Decision` consumed by the ACP
 * Service Boundary.
 */
import { AskDetails } from '../shared/types.js';

/** A single governance rule: glob `pattern` matched to an `action`. */
export interface GovernanceRule {
   pattern: string;
   action:  GovernanceAction;
}

export type GovernanceAction = 'approve' | 'deny' | 'ask';

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
}
