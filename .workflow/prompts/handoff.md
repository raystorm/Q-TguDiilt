---
name: handoff
version: 1.2.1
description: "Linear progression to the next profile."
arguments: [to]
argument-hint: "[profile]"
---
## Guard

Resolve the recipient profile (`to`) in this order:

1. If `{{to}}` is provided and identifies a profile (canonical name or alias, ignoring case),
   use it.
2. Otherwise, infer the profile from the conversation context.
3. If the context does not make the intended profile clear, ask: “Which profile should receive this handoff?”
   Wait for the user’s response before proceeding.

Treat an empty value, or placeholder text that was not replaced, as not provided.

## Execution

Generate handoff content for {{to}}.
Follow the canonical shape defined in
`.workflow/rules/workflow/changeover-format.md`.

**Steps in order:**

1. Write `.amazonq/work/current/HANDOFF.md`, plus any supporting files in
   that folder only.
2. Verify it by reading the exact path with the file read tool. If the read
   fails or returns nothing, confirm with the terminal:
   - Linux and macOS: `ls -la <path>`
   - Windows (cmd and PowerShell): `type <path>`, with backslashes

   If the two disagree, the terminal result is the authority.
3. Clean `.amazonq/work/current/`: remove stale files (all files except
   the newly written `HANDOFF.md` and its listed artifacts). Then run the
   Handoff Sweep (`status-format.md`).
4. Log `handoff_sent` once, with the timestamp method. The line carries
   `actor` (the sending profile) and `context: { sourceProfile, targetProfile }`
   with canonical names.
5. Update the auto-suspend file (`auto-suspend.md`, on `handoff_sent`).
6. Write the status file: `complete`, with `next` `{ command: handoff, to:
   <Target> }`. This is the last write.
7. Display: "---\n**Next**: Open a new tab and run `@start` to continue as
   [Profile Name from the To field]". Users read this line.

**Failure path:**

If step 1 to 5 fails or is refused, stop at that step.
Do not do the later steps, and do not log `handoff_sent` when step 1 or 2 failed.
Write `waiting` with no `next`. Show no **Next** line.
Show one line that names the step and says "Run `@handoff to=<Target>` to try again."

A write that failed with an error keeps the two retries of `Handoff Write Verification`.
A refused call is not retried in the same turn.

Do NOT switch profiles.
Do NOT start the next profile.
Do NOT run @start.
Do NOT infer any next action after displaying the user message.

Do not auto-activate next profile. Stay as current profile. User will
run `@start`.

---

## Error Handling

**Profile not found:**
- List available profiles from _PROFILES.md
- Suggest correct spelling or alias

**File not found:**
- Report missing file path
- Continue with available files
- Warn user about incomplete rule set
