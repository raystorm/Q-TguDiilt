# Governance: Approve, Deny, Ask

Every shell command the AI runs is checked against a governance config
before it executes. The config decides whether to run it
automatically, block it automatically, or ask you.

(This currently covers shell commands only. File edits and other tool
calls are not yet governed.)

## Config file

Governance rules live in a YAML file (`.workflow/acp/governance/config.yaml`
by default):

```yaml
governance:
  rules:
    - pattern: "npm test"
      action: approve
    - pattern: "npm run test*"
      action: approve
    - pattern: "npm run deploy *"
      action: deny
  default: ask
```

- `rules` is checked top to bottom; the **first matching rule wins**.
- `action` is one of `approve`, `deny`, or `ask`.
- `default` is the action used when no rule matches. It defaults to
  `ask` if omitted — nothing runs unchecked by default.

## Pattern syntax

Patterns use two wildcards, matched against the **entire** command
string (not a substring):

- `*` — matches any run of characters, including `/`. This is not a
  file-path glob; `cat *` matches `cat /etc/passwd` on purpose, because
  governance patterns describe commands, not paths.
- `?` — matches exactly one character.

A pattern ending in `" *"` also matches the bare command with no
arguments. For example, `"ls *"` matches both `ls -la` and plain `ls`
— you don't need a separate rule for the no-argument form.

If a command's dangerous usage needs a different action than its safe
usage, put the dangerous pattern first. **Order matters:** the first
match wins, so the more specific and restrictive pattern *must* come
before the general one:

```yaml
- pattern: "date -s *"
  action: deny
- pattern: "date *"
  action: approve
```

## What happens at each action

- **approve** — the command runs immediately, no prompt.
- **deny** — the command is blocked; it never runs.
- **ask** — the full command is shown, with a request to approve or
  reject it before it runs.

## Compound commands

A command built from multiple parts (`&&`, `||`, `;`, `|`, `&`, or a
redirect like `>`) is split into its parts, and each part is checked
independently. The overall decision is the most restrictive one found
(`deny` beats `ask` beats `approve`). A redirect (`>`, `>>`, `<`, etc.)
always forces at least `ask`, since its target is a side effect that
isn't itself evaluated as a command.

## When a command can't be safely parsed

If a command contains anything that can't be safely taken apart —
command substitution (`` $(...) ``, backticks), unbalanced quotes, a
newline, or a `#` comment — it always resolves to `ask`. It is never
silently approved or denied. Anything ambiguous defaults to asking.

## Troubleshooting

- **Nothing is auto-approved** — check that the pattern matches the
  *entire* command string, including arguments. `"npm test"` does not
  match `npm test --watch`; use `"npm test*"` for that.
- **A missing or broken config file** — governance fails with a clear
  error rather than silently allowing everything. Fix the file at the
  configured path and retry.
- **An expected auto-approve command asks instead** — it likely
  contains an unquoted newline, a `#`, or something that can't be
  safely parsed; this is fail-closed by design.
