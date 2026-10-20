# Governance: Approve, Deny, Ask

Every action the AI takes is checked against a governance config
before it happens: a shell command, a file read, edit, delete or move,
a search, a web fetch. The config decides whether to allow it
automatically, block it automatically, or ask you.

## Config file

Governance rules live in a YAML file (`.workflow/acp/governance/config.yaml`
by default):

```yaml
governance:
  rules:
    - kind: read
      action: approve
    - pattern: "npm test"
      action: approve
    - pattern: "npm run deploy *"
      action: deny
    - kind: edit
      files: [".env", "*.pem"]
      action: deny
    - kind: edit
      path: /home/me/project/src
      files: ["*.ts"]
      action: approve
  default: ask
```

- `rules` is checked top to bottom; the **first matching rule wins**.
- `action` is one of `approve`, `deny`, or `ask`.
- `default` is the action used when no rule matches. It defaults to
  `ask` if omitted — nothing runs unchecked by default.

`default: approve` is **not recommended**. Anything no rule covers then
runs without asking, including an action whose kind governance does not
recognize (an unrecognized kind follows `default`). The `..` check below
softens this but does not remove it.

## Rule keys

A rule has an `action` and at least one of these keys. **Every key a
rule names must match** for the rule to apply.

| Key       | Matches                                              |
| --------- | ---------------------------------------------------- |
| `kind`    | The type of action (listed below)                    |
| `path`    | A file or directory, and everything under it         |
| `files`   | File names, in any directory                         |
| `pattern` | A shell command                                      |

The kinds are:

- `read`, `edit`, `delete`, `move`, `search` — act on file paths
- `execute` — a shell command
- `fetch`, `think`, `other` — matched on kind alone

How the keys combine:

- `pattern` alone means `kind: execute`. Existing configs keep their
  meaning: a pattern-only rule governs shell commands and nothing else.
  `pattern: "*"` does not approve a file edit.
- `kind` alone matches every action of that kind.
- `path` and `files` apply to `read`, `edit`, `delete`, `move` and
  `search`. With no `kind`, a rule that has `path` or `files` applies to
  all five. An action that reports no paths is never matched by them.

### `path`

An absolute path. It matches itself and everything under it, at any
depth, on whole path segments only: `/proj/src` matches `/proj/src` and
`/proj/src/a/b.ts`, not `/proj/src-old/a`. A trailing slash makes no
difference.

### `files`

A list of file-name patterns, matched against the last segment of the
path only. `*` matches any run of characters, including none and a
leading dot; everything else is literal and case-sensitive. Entries are
OR'd. An entry cannot be empty or contain `/`.

- `"*.ts"` matches `a.ts`, not `a.tsx`, `a.ts.bak` or `A.TS`.
- `".env"` matches `.env`, not `.env.local`; `".env*"` matches both.
- `"*"` matches every name, dot-files included.

`files` alone applies in any directory. With `path`, both must match.

### Quote `files` entries

Write entries in quotes: `"*.pem"`. In YAML an unquoted `*` starts an
alias, which is a parse error, and the config will not load (the error
names the file).

### Order matters

The first matching rule wins for every kind of rule, so put narrow
rules before broad ones. This broad deny hides the narrow approve below
it:

```yaml
- files: ["*.foo"]
  action: deny
- path: /proj/safe/path
  files: ["*.foo"]
  action: approve    # never reached
```

Swap them and `/proj/safe/path/x.foo` is approved, while `.foo` files
anywhere else are still denied.

## Pattern syntax

`pattern` matches shell commands with two wildcards, against the
**entire** command string (not a substring):

- `*` — matches any run of characters, including `/`. This is not a
  file-path glob; `cat *` matches `cat /etc/passwd` on purpose, because
  `pattern` describes commands, not paths. To govern file paths use
  `path` and `files`.
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

- **approve** — the action runs immediately, no prompt.
- **deny** — the action is blocked; it never runs.
- **ask** — the specifics are shown first (the exact command, every
  file path, the full diff, and the request details the agent sent),
  then you are asked to approve or reject. The agent's own description
  of the action is shown too, labelled as the agent's text.

Allowing an ask applies to that one action only; the same action asks
again next time.

Rejecting, cancelling, an error from the IDE, an unrecognized answer or
a lost connection all deny. There is no timeout and no retry. If the
specifics cannot be shown, you are not asked and the action is denied.
If governance cannot evaluate an action, it asks you (noting that) and
denies if asking fails.

## Paths

- **`..` is never auto-approved.** A path with a `..` segment, such as
  `/proj/src/../../etc/passwd`, is never approved by a rule or by
  `default: approve`; it is asked about instead. A matching `deny` still
  denies. Only a whole `..` segment counts: `..foo` and `a..b` are
  ordinary names.
- **Nothing else is cleaned up.** `.` segments, doubled slashes,
  relative paths and symlinks are taken literally, and a relative path
  never matches a `path` rule. Configure each symlink path like any
  other path.
- **Deny rules match literally.** `path: /proj/secrets` does not match
  `/proj/./secrets/x` or `/proj//secrets/x`. Such a path falls through to
  the next matching rule or the default, and the shipped config approves
  every read. Prefer narrow approve rules and `default: ask` so an
  unexpected spelling is asked about.
- **Several paths in one action** (a move's source and destination) are
  each matched on their own, and the most restrictive result wins:
  `deny` beats `ask` beats `approve`.

## Missing information

An `execute` with no command (or a blank one), or an `edit`, `delete` or
`move` with no paths (none, an empty list, or only blank entries), is
denied without asking — even under `default: approve`. That is a defect
in the driver, not something you can judge. The log records the reason.

A request that would be asked about but has nothing to show (no command,
no usable paths, no diff, no request details, and a blank title) is
denied too, for the same reason. A title alone is still asked about, for
example a mode switch.

## What is never trusted

Rules match only an action's kind, command and paths. The agent's title,
tool annotation hints such as `readOnlyHint`, and the raw request are
never matched and never count as permission. `pattern: "safe*"` does not
approve a command because the title says "safe thing".

## The shipped config

The shipped config approves `read` and `search` with explicit rules.
This mirrors what the AI already does: both target agents never ask for
these kinds, so changing those rules probably has no effect. Everything
else falls to `ask`, apart from the command rules.

Some approved commands can also change things through their own
options. The shipped config asks about those forms, like a redirect:

- `sort -o out in`, `sort --output=out in` (also inside a flag cluster
  such as `-ro`) and `uniq in out` write a file.
- `sed -i` and `date -s` hidden in a flag cluster (`sed -ni`,
  `date -us`). `date -s` and `date --set` themselves are denied.

Accepted cost: the patterns match a dash, up to two characters and the
letter, so a file name such as `my-notes.txt` or `my-fish.ts` can ask,
and so can options such as `--numeric-sort`. A `uniq` with two or more
arguments asks, so `uniq -c file` asks too. Bare `uniq`, `uniq -c`,
`sort -r file` and `sort -n file` do not.

## Rules that are rejected

The config fails to load, naming the rule (its position in `rules`,
counting from 0), when a rule:

- has no `kind`, `path`, `files` or `pattern`
- uses an unknown or misspelled key (`paths`, `file`, `kinds`)
- has an unknown `kind`
- combines `pattern` with a kind other than `execute`, or with `path` or
  `files`
- uses `path` or `files` with `execute`, `fetch`, `think` or `other`
- has a relative or empty `path`
- has `files` that is not a list, is empty, has an empty entry, or has
  an entry containing `/`

## Shadowed rules

When an earlier rule already decides everything a later rule could
match, the later rule can never apply. Governance logs a warning
(`governance_rule_shadowed`) once at startup, naming both rules and
their actions. The warning is flagged (`approveHidesStricter`) when an
`approve` hides a stricter rule — for example `kind: edit` approve above
`path: /proj/secrets` deny, which hides the deny for edits.

The check is conservative: it may miss some cases but does not warn
about a rule that can still match something. A warning never changes a
decision; the first match still wins.

## Compound commands

A command built from multiple parts (`&&`, `||`, `;`, `|`, `&`, or a
redirect like `>`) is split into its parts, and each part is checked
independently. The overall decision is the most restrictive one found
(`deny` beats `ask` beats `approve`). A redirect (`>`, `>>`, `<`, etc.)
always forces at least `ask`, since its target is a side effect that
isn't itself evaluated as a command.

Commands are checked this way even when the AI runs them through a shell
tool instead of an edit tool: `sed -i s/a/b/ f` and `echo x > /proj/a`
both ask.

An unquoted glob such as `*.ts` or `build/*` is part of its command and
is matched as written: `ls *.ts | wc -l` is two parts, `ls *.ts` and
`wc -l`. A glob as the target of a redirect (`ls > *.log`) still asks.
Limit: governance sees the pattern, the shell sees the file names it
expands to. A file name that starts with `-` can therefore become an
option.

## When a command can't be safely parsed

If a command contains anything that can't be safely taken apart —
command substitution (`` $(...) ``, backticks), unbalanced quotes, a
variable such as `$OPTS` or `${CMD}` outside single quotes, any
whitespace other than a plain space (a newline or tab, for example), a
`#` comment, or an operator with no command next to it (`ls &&`,
`&& ls`) — it always resolves to `ask`. It is never silently approved or
denied. Anything ambiguous defaults to asking.

A `$` inside single quotes is plain text, so `awk '{ print $1 }'` is
not affected.

## Logging

Every decision is logged with its kind, matched rule and action. Shell
commands are redacted; file paths are logged as given, each cut at 500
characters. A result that governance forced carries a reason:
`missing_command`, `missing_paths`, `missing_details` or
`parent_segment`. Diffs, raw requests and the agent's title are never
logged.

## Troubleshooting

- **Nothing is auto-approved** — check that the pattern matches the
  *entire* command string, including arguments. `"npm test"` does not
  match `npm test --watch`; use `"npm test*"` for that.
- **A missing or broken config file** — governance fails with a clear
  error rather than silently allowing everything. Fix the file at the
  configured path and retry.
- **"rule at index N" at startup** — that rule is invalid; see "Rules
  that are rejected". Index 0 is the first rule.
- **A YAML parse error mentioning an alias** — quote the `*` entry:
  `"*.foo"`.
- **A shadow warning in the log** — an earlier rule hides a later one.
  Move the narrow rule above the broad one.
- **An edit is approved by a rule but still asks** — its path contains
  a `..` segment.
- **An edit is denied without asking** — the report had no paths (or a
  command had none); check the logged reason.
- **An expected auto-approve command asks instead** — it likely
  contains an unquoted newline, a `#`, or something that can't be
  safely parsed; this is fail-closed by design.
