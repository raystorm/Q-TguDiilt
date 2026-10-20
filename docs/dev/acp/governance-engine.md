# Governance Engine

The governance engine evaluates what the AI is about to do — a shell
command string or a driver's tool-call report — against a declarative
YAML config and returns an `approve` / `deny` / `ask` decision. The ACP
service boundary asks it about every tool call a governed driver
reports (see `service-boundary.md`).

Source lives under `.workflow/acp/governance/`.

## Guarantees

- **Fail-closed on config errors.** A missing file, malformed YAML, or
  an invalid shape never falls back to approve-all; it throws a named,
  actionable error.
- **First-match-wins, full-string matching.** Rules are evaluated in
  order against the entire command string, not a substring. Command
  `pattern` matching is not path-aware — `*` crosses `/`, because these
  patterns describe commands, not filesystem paths. File paths are
  governed by the separate `path` and `files` keys.
- **Fail-closed on ambiguous input.** Anything that can't be safely
  parsed — command substitution, unbalanced quotes, a variable
  expansion outside single quotes, whitespace other than a plain space,
  a shell comment, or an operator with no command beside it — resolves
  to `ask`, never auto-approve or auto-deny.
- **Compound commands are evaluated per-segment.** A command composed
  with `&&`, `||`, `;`, `|`, `&`, or a redirect is split and each part
  checked independently; the overall decision is the most restrictive
  result. A redirect always forces at least `ask`, since its target is
  a side effect that isn't itself evaluated. An unquoted glob stays one
  word of its segment, as written.
- **Tool-call reports are matched on `kind`, `command` and `paths`
  only.** The title, annotation hints and raw request are never matched.
- **A report missing what its kind needs is denied**, not asked. So is a
  report that would be asked about with nothing to show the user.
- **Every decision and config error is logged**, with the logged
  command redacted (full detail still reaches the `ask` payload a user
  reviews, never the log).

## Tool-call evaluation

`evaluateToolCall` takes the config and a report. It is pure; the
engine's version also logs the decision. The result carries a `reason`
when it was forced. The steps:

1. **`execute`.** No command, or a blank one, is `deny`
   (`missing_command`). Otherwise the command goes through the existing
   shell-command evaluation, so segmentation and fail-closed parsing
   are not reimplemented; the report's paths, diff and raw request ride
   along as ask details. Only rules with a `pattern`, or `kind: execute`
   alone, apply to a command.
2. **`edit`, `delete`, `move`.** No usable path is `deny`
   (`missing_paths`). Blank entries are ignored when at least one usable
   path remains.
3. **Per path.** Each usable path of `read`, `edit`, `delete`, `move`
   and `search` is matched on its own by first match; no match takes the
   configured `default`. `fetch`, `think` and `other` are matched once,
   on kind alone. A kind outside the vocabulary (a defective driver)
   matches no rule and follows `default`.
4. **`..` guard.** An `approve` for a path with a `..` segment, whether
   from a rule or from `default`, becomes `ask` with reason
   `parent_segment`. A `deny` is unchanged. The guard runs only for
   kinds that carry paths.
5. **Reduce.** The most restrictive path result wins: `deny` over `ask`
   over `approve`.
6. **Nothing to show.** An `ask` result for a report with no command, no
   usable path, no diff, no raw input and a blank title is `deny`
   (`missing_details`). A title alone still asks (a mode switch).
7. **Ask details.** An `ask` carries every path of the report as given,
   plus `command`, `diff` and `rawInput` when present.

A rule applies when it has no `pattern`, its kinds include the report's
kind, its `path` matches, and its `files` match the last path segment.
A rule's kinds are its own `kind`; `execute` for a bare `pattern`;
otherwise `read`, `edit`, `delete`, `move` and `search`.

## Command parsing

The engine and the shell must read the same words. Wherever the
`shell-quote` parser would drop or split a character differently from a
shell, the engine does not guess: the command is unparseable and asks.

Unparseable, beyond substitution and unbalanced quotes:

- Whitespace other than a plain space. `shell-quote` splits words on
  every whitespace character JavaScript knows; a shell splits on space,
  tab and newline only, so `ls<NBSP>-la` is one word to a shell.
- `#`, a shell comment: `shell-quote` and a shell can disagree about
  where it starts.
- A variable expansion outside single quotes (`$NAME`, `${NAME}`, `$1`,
  `$@`, `$?`). `shell-quote` replaces it with nothing, so a hidden
  option, as in `sed $OPTS s/a/b/ f` with `OPTS=-i`, would go unseen.
  A `$` inside single quotes, escaped, or before a quote or space is
  literal.
- An operator with no command before it, or a trailing `&&`, `||`, `|`
  or `|&`. A shell rejects these as syntax errors. A trailing `;` or
  `&`, and operators after a closing `)`, are valid.

Globs: `shell-quote` reports an unquoted `*` or `?` as an operator. The
engine keeps it as a word of its segment, as written, so
`ls *.ts | cat` is two segments (`ls *.ts` and `cat`) and `rm -rf build/*`
matches as `rm -rf build/*`. A glob that is the target of a redirect is
dropped with the redirect, which still asks.

Accepted limits (secondary tier): the engine sees a glob pattern where
the shell sees file names, so a name starting with `-` can become an
option. Brace expansion (`{a,b}`) and tilde expansion (`~root`) also make
the shell run different words than the engine saw.

## Path matching

Path matching is hand-written; there is no glob library. A path-glob
library's `*` stops at `/`, a leading dot needs a special option, and
`**` and brace syntax add behavior no rule asks for.

- `path` is a plain whole-segment prefix test. The path itself and
  everything under it match; trailing slashes are ignored.
- `files` entries are matched against the last segment. `*` is the only
  wildcard and matches any run, including none and a leading dot. Every
  other character, `?` and regex characters included, is literal.
  Case-sensitive and anchored to the whole name.
- The `..` guard looks for a whole `..` segment only, splitting the path
  on `/` and on `\` (Windows is best effort and untested).

Nothing is resolved or normalized: a relative path does not match an
absolute prefix, doubled slashes are not collapsed, `.` segments are
kept, and symlinks are ordinary paths.

## Rule validation

Loading rejects, naming the rule index (from 0): a rule that is not an
object; an unknown key; an invalid `action`; an empty or non-string
`pattern`; an unknown `kind`; a non-absolute `path`; `files` that is not
a non-empty list of non-empty names without `/`; a rule with no
`pattern`, `kind`, `path` or `files`; a `pattern` with a kind other than
`execute`; a `pattern` with `path` or `files`; and `path` or `files`
with a kind that has no paths (`execute`, `fetch`, `think`, `other`).

## Shadow detection

Shadow detection finds rules an earlier rule makes dead. Rule B is
shadowed by earlier rule A when A's constraints cover B's and A reaches
every kind B does:

- `path`: A has none, or A's path equals B's or is a whole-segment
  prefix of it.
- `files`: A has none, or A lists `*`, or B has `files` and every entry
  appears exactly in A's.
- `pattern`: A has none, or it is `*`, or the strings are identical.

The check is conservative. One deliberate extension: an `approve` that
reaches only some of a later, stricter rule's kinds still hides that
rule for those kinds, so that direction warns on any overlap.

Each shadowed rule is reported against the first earlier rule that
shadows it, so three identical rules give two warnings. The check runs
once when the engine is created and only logs; it never changes a
decision. `default` is not a rule.

## Rule labels in logs

A pattern rule is labelled by its pattern. Any other rule is
`#<position> kind=… path=… files=…` (position counts from 1). `default`
means no rule matched. A denial forced by a missing field has no
`matchedRule`.

## Log entries

- `governance_decision` (engine) — `sessionId`, `callId`, `kind`,
  redacted `command` (`execute` only), `paths` (array, only for kinds
  with paths, each cut at 500 characters with `…`), `matchedRule`,
  `action`, and `reason` when forced (`missing_command`, `missing_paths`,
  `missing_details` or `parent_segment`). Empty fields are omitted. The plain
  `evaluate(command)` entry carries the redacted `command`, `matchedRule`
  and `action`.
- `governance_rule_shadowed` (warning, at startup) — `rule`,
  `shadowedBy`, `ruleAction`, `shadowedByAction`, `approveHidesStricter`.
- `governance_config_error` — a config that failed to load.

The diff, the raw request and the title are never logged. The handler's
`governance_outcome` entry is described in the service boundary doc.

## Known gaps

- The adversarial security review is done. Findings that were accepted
  rather than fixed are in `docs/dev/acp/security-review.md`.
- The shipped `config.yaml`'s auto-approve comment overstates safety
  for a few entries with exec-capable flags; not yet corrected.
- Matching is textual. Only `..` is guarded; `.` segments and doubled
  slashes are not normalized, so a deny rule on `/proj/secrets` does not
  match `/proj/./secrets/x`. Full path normalization is not done.
- A report with a kind outside the vocabulary follows `default`, so
  `default: approve` approves it. `default: approve` is not recommended.
