Write handoff for {{next}} to `.amazonq/work/current/HANDOFF.md`.

Include:
- To: {{next}}
- From: [your current profile]
- Next: [profile that should run after {{next}}, or "None" if workflow complete]
- Task: [one-line description]
- Files: [list]
- Context: [what was done]
- Action: [what next profile should do]

Any additional files needed should be created in `.amazonq/work/current/` directory only.

After writing handoff, display the contents of HANDOFF.md and any supporting files created in `.amazonq/work/current/` for user review.

Ask: "Should I proceed with this handoff?"

**STOP. Wait for explicit user confirmation. Do not proceed until user approves.**

STOP. Do not continue.

WAIT for user confirmation.

Do NOT switch profiles.
Do NOT start the next profile.
Do NOT run @start.
Do NOT infer any next action.

Your only job is to:
  1. Write the handoff file.
  2. Display it.
  3. STOP and WAIT.


On approval:
- Remove all old files from `.amazonq/work/current/` except HANDOFF.md and files listed in current handoff
- Display: "---\n**Next**: Run `/compact` then `@start` as [Profile Name from To field]"

On rejection:
- Revise handoff based on user feedback

Do not auto-activate next profile. Stay as current profile. User will run @start.
