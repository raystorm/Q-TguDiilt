# Send Message Template

## Format

Follow the canonical changeover shape defined in
`.workflow/rules/workflow/changeover-format.md`.

Use heading: `# Message to [Profile]`

## Procedure

1. Generate MESSAGE.md content in memory
2. Display for user review
3. Request confirmation
4. Wait for explicit approval
5. Write to `.amazonq/work/current/MESSAGE.md`

Do not change your current profile. Do not clean up work directory.
