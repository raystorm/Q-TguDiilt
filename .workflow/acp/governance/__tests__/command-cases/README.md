# Command cases

Plain-text lists of shell commands, one per line, run against the shipped
`config.yaml` by two tests:

- `security-cases.test.ts` checks the decision the engine gives each line.
- `shell-oracle.test.ts` runs the approved lines in real bash, with every
  approved program replaced by a stub that records its arguments, and
  checks that what the shell ran is what governance evaluated. It is
  skipped on Windows and when bash is missing.

The loader is `cases.ts`.

## Line format

- Empty lines and lines starting with `#` are skipped.
- A leading `esc:` marks a line whose escapes are turned into real
  characters (see below). Every other line is literal.
- In `c4-option-abuse.txt` only, a leading `P: ` or `S: ` is the tier of
  the case, not part of the command (see "Tiers").

### The `esc:` prefix

A case file cannot hold a real newline, tab, NUL or non-breaking space
inside a line. A line starting with `esc:` writes them as escapes, and
the loader turns `\n`, `\r`, `\t`, `\v`, `\f`, `\0` and `\uXXXX` into the
characters before the line is used. The `esc:` itself is dropped.

    esc:ls\nrm -rf build        is the two-line command  ls <newline> rm -rf build
    esc:ls\u00a0-la             is  ls<NBSP>-la

Used in `c3-unparseable.txt` (control characters) and
`c6-odd-characters.txt` (look-alike whitespace and NUL). A backslash
sequence in any other line stays as written. In `c4`, the tier comes
first: `P: esc:...`.

## The files

The numbers keep the files in a fixed order. A new file takes the next
number.

| File                    | Every line must be                                            |
| ----------------------- | ------------------------------------------------------------- |
| `c1-controls.txt`       | approved                                                      |
| `c2-operators.txt`      | ask or deny; the two `npm run deploy` lines are deny          |
| `c3-unparseable.txt`    | ask, with no matched rule and the full original command       |
| `c4-option-abuse.txt`   | see "Tiers"                                                   |
| `c5-boundaries.txt`     | not approved, except two pinned lines                         |
| `c6-odd-characters.txt` | run by the shell oracle if approved                           |
| `c7-expansion.txt`      | ask if it contains a `$`; run by the shell oracle if approved |
| `c8-destructive.txt`    | ask or deny                                                   |

In `c5`, `ls  -la` (two spaces) is approved, and so is `npm run testx`,
because of the config's `npm run test*` rule. Both are pinned.

## Tiers

Each `c4` line is an approved command used with an option that writes a
file or runs another program.

- `P:` primary tier, a plausible accident. It must not be approved. This
  is blocking: fix the config or the engine, never accept it.
- `S:` secondary tier, needs crafted input. If it is still approved it
  must be listed in `accepted-findings.txt`; a line that is neither
  blocked nor listed fails the test so that it gets triaged.

Tiers are defined in `docs/dev/acp/threat-model.md`; the findings are in
`docs/dev/acp/security-review.md`.

## Accepted findings

`accepted-findings.txt` holds `c4` lines of the `S` tier that are still
approved. Format: `<command> | <tier> | <reason>`. Only the secondary
tier can be accepted. The test fails when a listed line is no longer
approved, so a fix removes its line.

`accepted-oracle-findings.txt` has the same format for approved lines from
`c1`, `c5`, `c6` or `c7` where the shell runs different words than
governance saw (for example brace and tilde expansion). It fails when a
listed line is no longer approved or no longer differs.

Both files read the tier and reason from the right, so a command may
contain ` | `.

## Adding a case

1. Add the line to the file whose rule matches the decision you expect.
2. Run `npm run test` from `.workflow/acp`.
3. If a `P` line is approved, fix the config or the engine.
4. If an `S` line is approved, fix it or add an accepted line with the
   reason.
5. If the oracle reports a difference, fix it or add an oracle line.

Glob cases are not in these files: the oracle runs approved lines in
bash, where the shell would expand the globs. They are in
`compound-commands.test.ts` and `default-config.test.ts`.
