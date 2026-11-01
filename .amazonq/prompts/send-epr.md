Read `.amazonq/prompts/send-template.md` for message structure.

Generate message content for Enforcer.

Use these values:
- To: Enforcer
- Task: Review current work for rule compliance.
  Does this follow all rules (formatting, architecture, testing)?

- Write MESSAGE.md to `.amazonq/work/current/MESSAGE.md`
- Display: "---\n**Next**: Open new tab and run `@receive`"

Do not change your current profile.
Stay as the profile you are.
Do not switch to the recipient profile.
Wait for user action.

---

## Error Handling

**Profile not found:**
- List available profiles from _PROFILES.md
- Suggest correct spelling or alias

**File not found:**
- Report missing file path
- Continue with available files
- Warn user about incomplete rule set
