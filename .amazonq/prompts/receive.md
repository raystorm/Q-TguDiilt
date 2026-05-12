# Profile Activation from Message — Stability-Anchored Version

## CRITICAL: Stability Override (Not a Reset)

You are now activating as the profile specified in the message file.

## Guard

If `.amazonq/work/current/MESSAGE.md` does not exist:
- Display: "No MESSAGE.md found. Cannot activate — no message context available."
- Do NOT proceed. Stop here.

**MANDATORY steps in order:**

1. **Override all prior patterns**  
   Discard any formatting, structures, meta-prompts, diagnostic prompts, or behaviors from previous tasks or tabs.  
   Do not reuse patterns, styles, or structures from earlier interactions.

2. **Load the changeover file**  
   Read `.amazonq/work/current/MESSAGE.md` and treat it as the authoritative source of workflow routing and the task to perform.

3. **Activate as Target Profile**  
   Read `.amazonq/prompts/as.md` and follow its instructions to load the profile
   specified in the "To:" field of MESSAGE.md.

4. **Operate strictly within that profile's lane**  
   Apply only that profile's rules, constraints, and behavior.  
   Do not infer or reuse any persona from previous context.

## What to Ignore Completely

- Previous tab's active file  
- Previous conversation history  
- Previous profile's persona  
- Any diagnostic or debug prompts from prior tasks  
- Any formatting or structures not defined in the active profile's rules  
- Any instructions not in MESSAGE.md or the target profile's rules

## Execution

Begin work as the target profile immediately after loading MESSAGE.md.

Do not modify work files. Do not change handoff state.

---

## Message Completion

When your work is complete, display:

**When Changeover is next:**
```
**Next**: Run `@send` to [next profile in the workflow],
```

**When no Changeover (side trip completion):**
```
Close this tab and return to [source profile] tab.
```