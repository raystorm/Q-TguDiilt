---
name: start
version: 1.1.0
description: "Activate a profile from a handoff."
---
# Profile Activation from Handoff — Stability-Anchored Version

## CRITICAL: Stability Override (Not a Reset)

You are now activating as the profile specified in the handoff file.

## Guard

Check for the file by its exact path, never with a file search, glob or
directory listing. `.amazonq/work/current/` is ignored by git, and those tools
skip ignored paths.

1. Read `.amazonq/work/current/HANDOFF.md` with the file read tool.
2. If the read fails or returns nothing, confirm with the terminal:
   - Linux and macOS: `ls -la .amazonq/work/current/HANDOFF.md`
   - Windows (cmd and PowerShell): `type .amazonq\work\current\HANDOFF.md`
3. If the terminal command also reports the file is missing, display:
   "No HANDOFF.md found. Cannot activate — no handoff context available."
   Do NOT proceed. Stop here.
4. If the two disagree, the terminal result is the authority. Use its output
   as the content (`cat` on Linux and macOS, `type` on Windows).

**MANDATORY steps in order:**

1. **Override all prior patterns**  
   Discard any formatting, structures, meta-prompts, diagnostic prompts, or behaviors from previous tasks or tabs.  
   Do not reuse patterns, styles, or structures from earlier interactions.

2. **Load the changeover file**  
   Read `.amazonq/work/current/HANDOFF.md` and treat it as the authoritative source
   of workflow routing and the task to perform.

3. **Activate as Target Profile**  
   Read `.workflow/prompts/as.md` and follow its instructions to load the profile
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

When your work is complete, write the status file per
`.workflow/rules/workflow/status-format.md`, then display:

**Next**: Run `@handoff to=[next profile in the workflow]`
