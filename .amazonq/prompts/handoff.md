Generate handoff content for {{next}} (do NOT write to disk yet).

Include:
- To: {{next}}
- From: [your current profile]
- Next: [profile that should run after {{next}}, or "None" if workflow complete]
- Task: [one-line description]
- Files: [list]
- Context: [what was done]
- Action: [what next profile should do]

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
- Remove all old files from `.amazonq/work/current/` except HANDOFF.md and files listed in current handoff
- Display: "---\n**Next**: Run `/compact` then `@start` as [Profile Name from To field]"

On rejection:
- Revise handoff based on user feedback
- Do NOT write any files

Do not auto-activate next profile. Stay as current profile. User will run @start.
