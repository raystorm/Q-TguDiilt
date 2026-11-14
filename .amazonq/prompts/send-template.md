# Send Message Template

Write message to `.amazonq/work/current/MESSAGE.md`.

## Format

Follow the canonical changeover shape defined in
`.workflow/rules/workflow/changeover-format.md`.

A message written by a profile activated by `@receive` also follows Trip Starter in
`.workflow/rules/workflow/workflow-mechanics.md`.

## After Writing

- Update the status file per Change invariant (`.workflow/rules/workflow/status-format.md`)
- Display: "---\n**Next**: Open new tab and run `@receive`"

Do not change your current profile.
Do not clean up work directory.
