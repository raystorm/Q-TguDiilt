## Guard

If `{{to}}` is empty, unresolved, or literal "{{to}}":
- Ask user: "Which profile should receive this handoff?"
- Wait for response before proceeding.

## Execution

Generate handoff content for {{to}} (do NOT write to disk yet).
Follow the canonical shape defined in
`.workflow/rules/workflow/changeover-format.md`.

Display the proposed HANDOFF.md content for user review.

Ask: "Should I proceed with this handoff?"

**STOP. Wait for explicit user confirmation. Do not proceed until user approves.**

STOP. Do not continue.

WAIT for user confirmation.

Do NOT switch profiles.
Do NOT start the next profile.
Do NOT run @start.
Do NOT infer any next action.

Your only job is to:
  1. Generate the handoff content in memory.
  2. Display it for review.
  3. STOP and WAIT for confirmation.


On approval:
- Write HANDOFF.md to `.amazonq/work/current/HANDOFF.md`
- Write any additional supporting files to `.amazonq/work/current/` directory only
- Clean `.amazonq/work/current/` per Change invariant (remove stale files, keep HANDOFF.md and listed artifacts)
- Display: "---\n**Next**: Open a new tab and run `@start` to continue as [Profile Name from the To field]"

On rejection:
- Revise handoff based on user feedback
- Do NOT write any files

Do not auto-activate next profile. Stay as current profile. User will run @start.

---

## Error Handling

**Profile not found:**
- List available profiles from _PROFILES.md
- Suggest correct spelling or alias

**File not found:**
- Report missing file path
- Continue with available files
- Warn user about incomplete rule set
