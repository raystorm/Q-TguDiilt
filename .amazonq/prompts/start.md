# Profile Activation from Handoff — Stability-Anchored Version

## CRITICAL: Stability Override (Not a Reset)

You are now activating as the profile specified in the handoff file.

**MANDATORY steps in order:**

1. **Override all prior patterns**  
   Discard any formatting, structures, meta-prompts, diagnostic prompts, or behaviors from previous tasks or tabs.  
   Do not reuse patterns, styles, or structures from earlier interactions.

2. **Load the workflow routing artifact**  
   Read `.amazonq/work/current/HANDOFF.md` and treat it as the authoritative source
   of workflow routing and the task to perform.

3. **Activate as Target Profile**  
   Read `.amazonq/prompts/as.md` and follow its instructions to load the profile
   specified in the "To:" field of HANDOFF.md.

4. **Operate strictly within that profile's lane**  
   Apply only that profile's rules, constraints, and behavior.  
   Do not infer or reuse any persona from previous context.

## What to Ignore Completely

- Previous tab's active file  
- Previous conversation history  
- Previous profile's persona  
- Any diagnostic or debug prompts from prior tasks  
- Any formatting or structures not defined in the active profile's rules  
- Any instructions not in HANDOFF.md or the target profile's rules

## Execution

Begin work as the target profile immediately after loading HANDOFF.md.

---

## Handoff Completion

If HANDOFF.md contains a "Next:" field, display:

**Next**: Run `@handoff` to [Profile Name]
