## Guard

Resolve the recipient profile (`to`) in this order:

1. If `{{to}}` is provided and identifies a profile (canonical name or alias, ignoring case),
   use it.
2. Otherwise, infer the profile from the conversation context.
3. If the context does not make the intended profile clear, ask: “Which profile should receive this handoff?”
   Wait for the user’s response before proceeding.

Treat an empty, unresolved, or literal `{{to}}` as not provided.

## Execution

Generate handoff content for {{to}}.
Follow the canonical shape defined in
`.workflow/rules/workflow/changeover-format.md`.

- Write HANDOFF.md to `.amazonq/work/current/HANDOFF.md` immediately
- Write any additional supporting files to `.amazonq/work/current/` directory only
- Clean `.amazonq/work/current/` per Change invariant
  (remove stale files, keep HANDOFF.md and listed artifacts)
- Update the status file per Change invariant (`.workflow/rules/workflow/status-format.md`)
- Display: "---\n**Next**: Open a new tab and run `@start` to continue as [Profile Name from the To field]"

Do NOT switch profiles.
Do NOT start the next profile.
Do NOT run @start.
Do NOT infer any next action, after displaying the user message.

Do not auto-activate next profile. Stay as current profile. User will run `@start`.

---

## Error Handling

**Profile not found:**
- List available profiles from _PROFILES.md
- Suggest correct spelling or alias

**File not found:**
- Report missing file path
- Continue with available files
- Warn user about incomplete rule set
