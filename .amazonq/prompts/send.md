Read `.amazonq/prompts/send-template.md` for message structure.

Generate message content for {{to}} (do NOT write to disk yet).

Use these values:
- To: {{to}}
- Task: {{task}}

Display the proposed MESSAGE.md content for user review.

Ask: "Should I proceed with this message?"

**STOP. Wait for explicit user confirmation. Do not proceed until user approves.**

On approval:
- Write MESSAGE.md to `.amazonq/work/current/MESSAGE.md`
- Display: "---\n**Next**: Open new tab and run `@receive`"

On rejection:
- Revise message based on user feedback
- Do NOT write any files

Do not change your current profile. Stay as the profile you are.
Do not switch to the recipient profile. Wait for user action.

---

## Error Handling

**Profile not found:**
- List available profiles from _PROFILES.md
- Suggest correct spelling or alias

**File not found:**
- Report missing file path
- Continue with available files
- Warn user about incomplete rule set

