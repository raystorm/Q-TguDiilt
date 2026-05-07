# Profile Activation Rule

When a user message starts with `@as` or `as` (case insensitive) 
read and follow `.amazonq/prompts/as.md` to activate the requested profile.

## Trigger

User message starts with: `@as` or `as` (case insensitive)

## Guard

If the text after `@as`/`as` is empty or whitespace-only:
1. Read `.workflow/rules/_PROFILES.md`
2. Display: "No profile specified. Usage: `@as [Profile] [optional task]`"
3. List available profile names from _PROFILES.md
4. Do NOT proceed to Action steps

## Action

1. Read `.amazonq/prompts/as.md`
2. Follow all instructions in that prompt
3. Execute the profile activation workflow
