# Profile Activation Rule

When a user message starts with `@as` or `as` (case insensitive) 
read and follow `.amazonq/prompts/as.md` to activate the requested profile.

## Trigger

User message starts with: `@as` or `as` (case insensitive)

## Action

1. Read `.amazonq/prompts/as.md`
2. Follow all instructions in that prompt
3. Execute the profile activation workflow
