# Governance Engine

The governance engine evaluates a shell command string against a
declarative YAML config and returns an `approve` / `deny` / `ask`
decision. It is a standalone module — not yet wired to a call site.

Source lives under `.workflow/acp/governance/`.

## Guarantees

- **Fail-closed on config errors.** A missing file, malformed YAML, or
  an invalid shape never falls back to approve-all; it throws a named,
  actionable error.
- **First-match-wins, full-string matching.** Rules are evaluated in
  order against the entire command string, not a substring. Matching
  is not path-aware — `*` crosses `/`, because these patterns describe
  commands, not filesystem paths.
- **Fail-closed on ambiguous input.** Anything that can't be safely
  parsed — command substitution, unbalanced quotes, an unquoted
  newline, or a shell comment — resolves to `ask`, never auto-approve
  or auto-deny.
- **Compound commands are evaluated per-segment.** A command composed
  with `&&`, `||`, `;`, `|`, `&`, or a redirect is split and each part
  checked independently; the overall decision is the most restrictive
  result. A redirect always forces at least `ask`, since its target is
  a side effect that isn't itself evaluated.
- **Every decision and config error is logged**, with the logged
  command redacted (full detail still reaches the `ask` payload a user
  reviews, never the log).

## Known gaps

- Not yet wired to any call site.
- Tool-call-level governance (file edits, reads, MCP/IDE tools) is out
  of scope for this engine.
- Adversarial security review against real tool-call inputs is still
  outstanding.
- The shipped `config.yaml`'s auto-approve comment overstates safety
  for a few entries with exec-capable flags; not yet corrected.
