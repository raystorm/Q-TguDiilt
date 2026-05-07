# Context Gathering

## MANDATORY Context Gathering (Doctor, Enforcer)

Before diagnosis or validation, profiles MUST gather context to validate against actual changes.

### Context Gathering Steps

1. **Check for FEATURE.md** - Multi-story feature context
   - Check if `.amazonq/work/FEATURE.md` exists
   - If exists, read to understand which story is being worked on
   - Note dependencies from other stories

2. **Read workflow log** - Recent events for current workflow chain
   - Read `.amazonq/workflow.log`
   - If file does not exist, skip to next step
   - Parse entries matching current `workflowId` and `parentId` chain
   - Understand what work was just completed or attempted

3. **Check git diff** - Actual code changes
   - Run `git diff` to see uncommitted changes
   - Identify what files and lines changed
   - Understand precise modifications made

4. **Validate context alignment**
   - Compare: Do recent changes match what workflow log says was done?
   - **Check for Doctor events in workflow chain** (same workflowId or parentId)
   - **If Builder + Doctor both modified files** → Validate all changes together as part of story
   - **If changes match workflow log** → Proceed with diagnosis/validation
   - **If changes don't match workflow log** → Prompt user: "Recent changes don't match workflow log. Were there manual edits or other changes I should know about?"

## Profile-Specific Behavior

### Doctor

After gathering context, Doctor:
- Diagnoses failures based on actual changes
- Traces causal chains to root cause
- Applies minimal safe fixes when appropriate
- Escalates when issues exceed scope

### Enforcer

After gathering context, Enforcer:
- Validates implementation against actual changes
- Checks formatting, architecture, pattern compliance
- Asks user to run tests if code/tests were changed
- Reports issues or applies fixes when appropriate

---

## Test Validation (Enforcer Only)

After gathering context, Enforcer MUST check if tests need validation:

**If code changed OR tests created/updated:**
- Pause validation
- Ask user to run test suite
- Wait for explicit confirmation that tests have been run
- Wait for confirmation that tests passed
- Then proceed with validation

**If no code/test changes:**
- Skip test validation
- Proceed with other validation checks

---

## FEATURE.md Context (All Profiles)

When `.amazonq/work/FEATURE.md` exists:
- Read to understand multi-story feature context
- Identify which story is current
- Note dependencies from other stories
- Use context to inform decisions

**Profiles that check FEATURE.md:**
- Builder (before implementation)
- Enforcer (before validation)
- Doctor (before diagnosis)
- Tactician (when planning workflow)
- Documentor (when updating progress)

---

## Reference

For complete workflow mechanics, see:
- `.workflow/rules/workflow/workflow-mechanics.md` - MANDATORY mechanics
