# Workflow Mechanics

## Purpose

Define workflow mechanics in one central reference:
- Standard handoffs (linear workflow progression)
- Side trips (parallel work with send/receive)
- Reviewable handoffs (prevent incomplete information)
- Standard workflow steps (expectations for all profiles)

---

## Standard Handoffs

### What Are Handoffs?

Linear workflow progression where one profile completes work and passes to the next profile.

**Pattern:**
```
Profile A completes work
  ↓
Profile A informs user work is complete
  ↓
User triggers @handoff
  ↓
Profile A creates HANDOFF.md
  ↓
Profile A shows summary and requests confirmation
  ↓
User approves handoff
  ↓
Profile B activates with @start
  ↓
Profile B reads HANDOFF.md
  ↓
Profile B continues work
```

### HANDOFF.md Location

`.amazonq/work/current/HANDOFF.md`

### HANDOFF.md Format

```markdown
# Handoff to [Profile]

## From
[Source Profile]

## Task
[What needs to be done]

## Context
[Background and decisions made]

## Artifacts
[Files created or modified]

## Expected Outcome
[What the receiving profile should produce]
```

### When to Use Handoffs

- Profile completes its responsibility
- Next profile needs context to continue
- Linear workflow progression
- Example: Architect → Tactician → PE → Builder → Enforcer → Documentor

### Handoff Confirmation

**CRITICAL - MANDATORY FOR ALL PROFILES:** Profiles must NOT auto-create handoffs. User triggers handoff creation with `@handoff` command.

**This applies to ALL profiles that create handoffs:**
- Architect, Tactician, PromptEngineer, Builder, TestDesigner, Enforcer, Documentor, Doctor

**Why:**
- Catches incomplete information
- Validates handoff quality
- Prevents cascade of incomplete work
- Gives user control over workflow progression

**Profile behavior when work is complete:**
1. Inform user that work is complete
2. Summarize what was accomplished
3. Tell user how to proceed in the SAME message: "Ready to hand off to [NextProfile]? Use: `@handoff`"
4. **Do NOT stop after summary - include the handoff instruction immediately**
5. **Wait for user to trigger `@handoff` command**
6. **Do NOT create HANDOFF.md until user requests it with `@handoff`**

**Example completion message (all in one):**
```
[Profile]: "Work complete. [Summary of what was accomplished].

Ready to hand off to [NextProfile]? Use: `@handoff`"
```

**What NOT to do:**
- ❌ Print summary, then stop, then wait for user, then ask about handoff (double interaction)
- ❌ "Work complete. [Summary]." [stops] ... [user types something] ... "Should I proceed?"
- ✅ "Work complete. [Summary]. Ready to hand off? Use: `@handoff`" (single message)

**For side trips (when profile needs another profile's help):**
```
[Profile]: "Need [OtherProfile] to [task description].

Send to [OtherProfile]? Use: `@send [OtherProfile]`"
```

**Key principle:**
- Summary + next action instruction = ONE message
- Don't stop after summary and wait for user input
- Tell user the command in the same message as the summary

**Profile creating handoff (after user triggers `@handoff`):**
1. Create HANDOFF.md with complete context
2. Show handoff summary to user:
   - What's being passed (artifacts, decisions, context)
   - What receiving profile will do
   - What information is included
3. Request explicit user confirmation
4. **Wait for approval before completing handoff**
5. **Never complete handoff without explicit user approval**
6. After approval, display next command for user

**Example handoff summary:**
```
Created handoff to [Profile] with:
- [Artifact 1]: [description]
- [Artifact 2]: [description]
- [Context]: [key decisions/information]

Receiving profile will: [expected action]

Should I proceed with handoff?

[After user confirms]

Next command: Open new tab and type `@start as [Profile]`
```

**What counts as explicit confirmation:**
- "Yes", "Yes, proceed", "Go ahead", "Approved"
- "LGTM", "Looks good", "Proceed"

**What does NOT count:**
- Clarifying questions
- Acknowledging understanding
- General agreement without explicit approval

**User reviewing handoff:**
1. Check HANDOFF.md content
2. Verify completeness
3. Ask: "Is everything needed for next profile included?"
4. Approve or request additions

---

## Reviewable Handoffs

### Problem

Incomplete handoffs propagate through workflow. Example: TestDesigner passes only test scenarios to PE, but PE needs full story requirements (schema, guards, wiring).

### Solution

Make handoffs explicit and reviewable.

### Reviewable Handoff Pattern

**Profile creating handoff:**
1. Create HANDOFF.md
2. **Show summary of what's being passed:**
   - "Passing to PE: test scenarios + story requirements (schema, guards, wiring)"
3. Request user confirmation
4. **Wait for approval before completing handoff**
5. **Never complete handoff without explicit user approval**

**User reviewing handoff:**
1. Check HANDOFF.md content
2. Verify completeness
3. Ask: "Is everything needed for next profile included?"
4. Approve or request additions

**Example:**
```
TestDesigner: "Created handoff to PE with:
- 27 test scenarios for guards
- Story requirements: schema creation, guard implementation, wiring
- Validation checklist

Should I proceed with handoff?"

User: [Reviews HANDOFF.md]
User: "Yes, proceed"
```

### What to Check in Handoffs

**From Architect to Tactician:**
- [ ] Impact analysis complete
- [ ] Change classification clear
- [ ] Phase recommendations included

**From Tactician to PE:**
- [ ] Execution strategy defined
- [ ] Profile sequence clear
- [ ] Validation checkpoints identified

**From TestDesigner to PE:**
- [ ] Test scenarios complete
- [ ] Story requirements included (not just test scenarios)
- [ ] All acceptance criteria covered

**From PE to Builder:**
- [ ] All story requirements in prompt
- [ ] Anchoring to existing patterns
- [ ] Validation checklist included
- [ ] Confirmation requirement specified

**From Builder to Enforcer:**
- [ ] All changes made
- [ ] Tests created alongside
- [ ] Validation checklist provided

**From Enforcer to Documentor:**
- [ ] Validation results
- [ ] Files modified
- [ ] Context for commit message

---

## Side Trips (Send/Receive)

### What Are Side Trips?

Parallel work where current profile needs another profile to do work in isolation, then return to original context.

**Pattern:**
```
Profile A working
  ↓
Profile A needs Profile B for side task
  ↓
Profile A creates MESSAGE.md with @send
  ↓
User opens new tab
  ↓
User types @receive in new tab
  ↓
Profile B reads MESSAGE.md
  ↓
Profile B does work in isolation
  ↓
User closes tab
  ↓
User returns to Profile A tab
  ↓
Profile A continues with results
```

### MESSAGE.md Location

`.amazonq/work/current/MESSAGE.md`

### MESSAGE.md Format

```markdown
# Message to [Profile]

## From
[Source Profile]

## Task
[What needs to be done]

## Context
[Background]

## Artifact Location
[Files to review]

## Expected Outcome
[What should be produced]
```

### When to Use Side Trips

- Current profile needs another profile's expertise
- Work can be done in isolation
- Non-blocking, parallel work
- Example: Retrospective creates rule draft, sends to PE for integration

### Side Trip vs Handoff

**Handoff:**
- Linear progression
- Original profile done
- Next profile continues main workflow

**Side Trip:**
- Parallel work
- Original profile paused
- Returns to original profile after

---

## Standard Workflow Steps

### Profile Activation

1. Profile receives handoff or message
2. Profile reads context (HANDOFF.md or MESSAGE.md)
3. Profile gathers additional context if needed:
   - Workflow log (for Dr/Enforcer)
   - Git diff (for Dr/Enforcer)
   - Existing patterns (for Builder)

### Work Execution

1. Profile performs its responsibility
2. Profile follows its rules and boundaries
3. Profile creates artifacts (code, docs, prompts, etc.)

### Confirmation Requirements

**Profiles requiring confirmation before file changes:**
- Builder
- Doctor
- Enforcer

**Pattern:**
1. Show what will be changed (code diffs)
2. Explain why
3. Request explicit confirmation
4. Wait for approval
5. Execute changes

See `workflow/agentic-confirmation.md` for detailed confirmation rules.

### Validation Checkpoints

**After implementation:**
- Builder hands off to Enforcer
- Enforcer validates against checklist
- Enforcer approves or escalates

**After validation:**
- Enforcer hands off to Documentor
- Documentor creates commit message

### Handoff/Completion

1. Profile completes work
2. Profile informs user work is complete
3. User triggers `@handoff` (if continuing workflow)
4. Profile creates HANDOFF.md
5. Profile shows what's being passed
6. Profile requests user confirmation
7. **Profile waits for approval**
8. User approves
9. Next profile activates with `@start`

---

## Post-Documentor Branching

### Decision Points After Commit

After Documentor creates commit message and user commits, user chooses next action:

**1. Continue to Next Story (Multi-Story Feature)**
- If FEATURE.md exists and more stories remain
- User activates Planner: `Act as Planner`
- Planner reads FEATURE.md, sees current story complete
- Planner writes next story or escalates to Architect if needed

**2. Run Retrospective (Workflow Improvement)**
- After completing story or feature
- User triggers: `Act as Retrospective`
- Retrospective analyzes workflow.log
- Retrospective offers improvements (rules, prompts, architecture, docs)

**3. Start New Feature (New Work)**
- User activates Planner with new feature request
- Planner creates story or FEATURE.md
- Standard workflow begins

**4. Done (No Further Work)**
- User commits and closes tab
- No further workflow needed

### Documentor Behavior After Commit

After creating commit message, Documentor should:

1. Check if FEATURE.md exists
2. **If FEATURE.md exists and stories remain:**
   - "Story [N] complete. Continue with Story [N+1]? Use: `Act as Planner`"
3. **If feature complete or no FEATURE.md:**
   - "Work complete. Run retrospective for improvements? Use: `Act as Retrospective`"
4. Wait for user decision

### Decision Tree

```
Documentor commits
    ↓
User decides:
    ├─ More stories in feature? → Act as Planner (next story)
    ├─ Want workflow improvements? → Act as Retrospective
    ├─ New feature? → Act as Planner (new feature)
    └─ Done? → Close tab
```

### Example Flows

**Multi-Story Feature:**
```
Story 1: Planner → TestDesigner → PE → Builder → Enforcer → Documentor
    ↓ (user commits)
Documentor: "Story 1 complete. Continue with Story 2? Use: `Act as Planner`"
User: "Act as Planner"
Story 2: Planner → TestDesigner → PE → Builder → Enforcer → Documentor
    ↓ (user commits)
Documentor: "Feature complete. Run retrospective? Use: `Act as Retrospective`"
User: "Act as Retrospective"
Retrospective analyzes and offers improvements
```

**Single Story with Retrospective:**
```
Story: Planner → TestDesigner → PE → Builder → Enforcer → Documentor
    ↓ (user commits)
Documentor: "Work complete. Run retrospective? Use: `Act as Retrospective`"
User: "Act as Retrospective"
Retrospective analyzes and offers improvements
```

**Single Story, No Retrospective:**
```
Story: Planner → TestDesigner → PE → Builder → Enforcer → Documentor
    ↓ (user commits)
Documentor: "Work complete. Run retrospective? Use: `Act as Retrospective`"
User: (closes tab, done)
```

---

## Workflow Logging

All profiles that reference `workflow/logging.md` MUST log:
- Workflow start on activation
- Key events (file changes, handoffs, validations)
- Use fsWrite append to `.amazonq/workflow.log`
- Follow JSONL format

See `workflow/logging.md` for detailed logging specification.

---

## Inquiry Mode

### What is Inquiry Mode?

Inquiry mode allows asking questions without triggering workflow commands or actions.

**Purpose:**
- Ask clarifying questions about workflow state
- Explore ideas without committing to actions
- Understand context without triggering next steps
- Think through decisions before proceeding

### Usage

`@inquiry [question]`

**Examples:**
```
@inquiry What files were modified in the last workflow?
@inquiry Should I suspend here or continue?
@inquiry What would happen if I handoff to Architect?
@inquiry Why did Builder use a helper function?
```

### Behavior

When `@inquiry` is used:
- No workflow commands processed (@handoff, @send, @suspend, etc.)
- No workflow files created (HANDOFF.md, MESSAGE.md)
- No workflow logging
- No profile activation
- Conversational Q&A only

### Exit Inquiry Mode

Start a new message without `@inquiry`.

### When to Use

**Use inquiry mode when:**
- Uncertain about next step
- Need to understand current state
- Want to explore options
- Thinking through decisions

**Don't use inquiry mode when:**
- Ready to take action
- Want to trigger workflow commands
- Need to create workflow artifacts

---

## Commands Reference

### User Commands

- `@handoff` - Trigger current profile to create HANDOFF.md for linear workflow progression
- `@send [Profile]` - Trigger current profile to create MESSAGE.md for side trip work
- `@start` - Read HANDOFF.md and activate profile
- `@receive` - Read MESSAGE.md and activate profile
- `@suspend [name]` - Save workflow context for later
- `@resume [name]` - Load saved workflow context
- `@list` - Show all suspended contexts
- `@note [text]` - Log user observation to workflow log
- `@inquiry [question]` - Ask questions without triggering workflow commands

See `workflow/user-commands.md` for detailed command documentation.

### Profile Activation

- `Act as [Profile]` - Explicit profile activation
- `As [Profile]` - Shorthand activation
- `@[Profile]` - Mention (does NOT activate)

---

## File Locations

### Workflow Files

- `.amazonq/work/FEATURE.md` - Multi-story feature tracker
- `.amazonq/work/current/HANDOFF.md` - Standard handoffs
- `.amazonq/work/current/MESSAGE.md` - Side trip messages
- `.amazonq/workflow.log` - Workflow event log (JSONL)

### Context Preservation

- `.amazonq/suspended/` - Suspended workflow contexts
- `.amazonq/suspended/INDEX.md` - List of suspended contexts
- `.amazonq/suspended/README.md` - Folder documentation

---

## Multi-Story Feature Tracking

### When to Use FEATURE.md

Create `.amazonq/work/FEATURE.md` when:
- Feature requires multiple related stories
- Stories must be implemented in sequence
- Need to track progress across story chain
- Context needs to persist between stories

### FEATURE.md Workflow

**Planner creates FEATURE.md:**
1. Breaks down feature into stories
2. Creates FEATURE.md with story list
3. Marks Story 1 as "In Progress"
4. Hands off to Tactician

**Between stories:**
1. Documentor updates FEATURE.md after story completion
2. Marks completed story as "Complete"
3. Marks next story as "In Progress"
4. Adds progress notes

**After all stories:**
1. Retrospective cleans up FEATURE.md

### FEATURE.md vs Suspended Contexts

**Use FEATURE.md when:**
- Linear story progression
- All stories known upfront
- Simple tracking needed

**Use @suspend when:**
- Need to pause and work on unrelated tasks
- Complex context needs preservation
- Uncertain when work will resume

---

## Examples

### Example 1: Standard Handoff

```
Architect completes feature analysis
  ↓
Architect: "Analysis complete. Created feature breakdown with 3 stories."
  ↓
User: "@handoff"
  ↓
Architect creates HANDOFF.md:
  "Handoff to Tactician with:
   - Feature breakdown (3 stories)
   - Impact analysis (cross-domain, 50+ files)
   - Phase recommendations
   Should I proceed?"
  ↓
User reviews HANDOFF.md
User: "Yes, proceed"
  ↓
Architect: "Handoff complete. Next command: Open new tab and type `@start as Tactician`"
  ↓
User opens new tab: "@start as Tactician"
  ↓
Tactician reads HANDOFF.md
Tactician sequences stories
```

### Example 2: Side Trip

```
Retrospective analyzing workflows
  ↓
Retrospective creates rule draft
  ↓
Retrospective: "@send PE"
  ↓
Retrospective creates MESSAGE.md:
  "Message to PE: Review and integrate rule draft"
  ↓
User opens new tab: "@receive"
  ↓
PE reads MESSAGE.md
PE integrates rule draft
PE closes tab
  ↓
User returns to Retrospective tab
Retrospective continues analysis
```

### Example 3: Reviewable Handoff Catches Issue

```
TestDesigner creates test scenarios
  ↓
TestDesigner: "Test scenarios complete. Created 27 scenarios for guards."
  ↓
User: "@handoff"
  ↓
TestDesigner creates HANDOFF.md:
  "Handoff to PE with:
   - 27 test scenarios for guards
   Should I proceed?"
  ↓
User reviews HANDOFF.md
User: "Wait, this is missing story requirements. PE needs schema, guards, AND wiring requirements, not just test scenarios."
  ↓
TestDesigner updates HANDOFF.md with full requirements
  ↓
User: "Yes, proceed"
  ↓
TestDesigner: "Handoff complete. Next command: Open new tab and type `@start as PE`"
  ↓
PE receives complete requirements
```

---

## Rationale

- Centralized workflow mechanics documentation
- Clear distinction between handoffs and side trips
- Reviewable handoffs prevent incomplete information
- Standard workflow steps ensure consistency
- Reduces confusion and improves workflow quality

## Impact

- All profiles follow consistent workflow patterns
- Handoffs are explicit and reviewable
- Incomplete information caught early
- Clear reference for workflow mechanics
- Reduces workflow errors and rework
