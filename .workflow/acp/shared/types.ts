/**
 * Cross-cutting types shared across the ACP package layers.
 *
 * Kept as a single file until it grows large enough to warrant splitting.
 */

/**
 * The full specifics of a gated action that a governance `ask` must show the
 * user before approval: the exact command, affected file path(s), a
 * diff/patch, and any tool parameters.
 *
 * This is a contract between layers: the Governance Engine (A4b) *produces*
 * these details, and the ACP Service Boundary (A4a) *delivers* them as the
 * detail message that precedes the approval request.
 */
export interface AskDetails {
   command?: string;
   paths?:   string[];
   diff?:    string;
   [key: string]: unknown;
}
