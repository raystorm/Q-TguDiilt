# Workflow Commands Reference

Complete reference for all workflow commands in the AI Workflow System.

For MANDATORY workflow mechanics, see `.workflow/rules/workflow/workflow-mechanics.md`.

---

## Placeholder Semantics

### `{{label}}`
A literal placeholder that may be supplied by the user or inferred by the AI.
May remain literal until resolved. Must be resolved before execution.

### `[label]`
A value that must be supplied by the AI.
Must not remain literal. Must be resolved before execution.

For full behavioral details, see the prompt files that use these placeholders: `~/.aws/amazonq/prompts/`

---

## User Commands

### @handoff
Trigger current profile to create HANDOFF.md for linear workflow progression.

**Usage:**
```
@handoff
```

**Behavior:**
- Current profile generates HANDOFF.md content
- Shows summary of what's being passed
- Requests user confirmation
- Waits for approval
- Writes HANDOFF.md after approval
- Displays next command for user

**Example:**
```
User: "@handoff"
Profile: "Created handoff to Builder with:
  - Test scenarios (27 scenarios)
  - Story requirements (schema, guards, wiring)
  Should I proceed?"
User: "Yes"
Profile: "Handoff complete. Next command: Open new tab and type `@start' to run as Builder"
```

---

### @send [Profile]
Trigger current profile to create MESSAGE.md for side trip work.

**Usage:**
```
@send PE
@send Architect
```

**Behavior:**
- Current profile generates MESSAGE.md content
- Shows summary of what's being sent
- Requests user confirmation
- Waits for approval
- Writes MESSAGE.md after approval
- Current profile remains active
- User opens new tab for side trip

**Example:**
```
User: "@send PE"
Retrospective: "Created message to PE with:
  - Rule draft for review
  - Integration instructions
  Should I proceed?"
User: "Yes"
Retrospective: "Message complete. Open new tab and type `@receive' to run as PE"
```

---

### @start
Read HANDOFF.md and activate profile specified in "To:" field.

**Usage:**
```
@start
```

**Behavior:**
- Reads `.amazonq/work/current/HANDOFF.md`
- Extracts profile from "To:" field
- Activates that profile
- Displays Context Status block (MANDATORY)
- Loads context and begins work
- Ignores prior conversation history

**Example:**
```
User: "@start"

=== Context Status ===
Profile: Builder
WorkflowId: wf-1738190400000
Rules Loaded: 12 files
Context: 42%
Logging: ENABLED
Confirmation: ENABLED
======================

Reading HANDOFF.md...
Task: Implement schema changes
Proceeding with implementation...
```

---

### @receive
Read MESSAGE.md and activate profile specified in "To:" field.

**Usage:**
```
@receive
```

**Behavior:**
- Reads `.amazonq/work/current/MESSAGE.md`
- Extracts profile from "To:" field
- Activates that profile
- Displays Context Status block (MANDATORY)
- Loads context and begins work
- Used in new chat tab for isolated work

**Example:**
```
User: "@receive"

=== Context Status ===
Profile: PromptEngineer
WorkflowId: wf-1738190500000
Rules Loaded: 10 files
Context: 38%
Logging: ENABLED
Confirmation: ENABLED
======================

Reading MESSAGE.md...
Task: Review and integrate rule draft
Proceeding with review...
```

---

### @suspend [name]
Save workflow context for later resumption.

**Usage:**
```
@suspend feature-x-phase-2
@suspend analysis-blocked
```

**Behavior:**
- Creates `.amazonq/suspended/[name].md`
- Saves current profile, goal, context, decisions
- Updates `.amazonq/suspended/INDEX.md`
- Enables multi-phase work without context loss

**Example:**
```
User: "@suspend document-migration-phase-2"
Profile: "Context saved to .amazonq/suspended/document-migration-phase-2.md
Resume with: @resume document-migration-phase-2"
```

---

### @resume [name]
Load previously suspended workflow context.

**Usage:**
```
@resume feature-x-phase-2
@resume
```

**Behavior:**
- If name provided: loads that specific context
- If no name: lists available contexts
- Activates appropriate profile
- Continues work from checkpoint

**Example:**
```
User: "@resume document-migration-phase-2"

Resuming: Architect - Document Migration Phase 2

Last Active: 2025-01-27 22:45:00

Key Decisions:
- Split into 3 phases
- Phase 1 complete
- Phase 2: Rename DocumentDetails → Document

Continuing as Architect...
```

---

### @list
Display all suspended workflow contexts.

**Usage:**
```
@list
```

**Behavior:**
- Reads `.amazonq/suspended/INDEX.md`
- Shows active vs completed contexts
- Displays last active timestamp
- Shows profile and goal for each

**Example:**
```
User: "@list"

Suspended Contexts:

Active:
- document-migration-phase-2 (Architect) - 2025-01-27 22:45:00
- search-optimization (Builder) - 2025-01-26 15:30:00

Completed:
- auth-refactor (Documentor) - 2025-01-25 10:00:00
```

---

### @note [text]
Log user observation to workflow log.

**Usage:**
```
@note Builder forgot to add tests
@note This approach seems overly complex
```

**Behavior:**
- Appends to `.amazonq/workflow.log` with accurate timestamp
- Captures user insights during workflow execution
- Enriches retrospective analysis with human observations
- Does not change workflow state

**Example:**
```
User: "@note Builder implementation looks good but missing edge case handling"

Logged to workflow.log:
{
  "type": "event",
  "workflowId": "wf-1738190400000",
  "timestamp": "2025-01-28T23:45:00.000Z",
  "source": "user",
  "actor": "user",
  "eventType": "user_note",
  "what": "Builder implementation looks good but missing edge case handling",
  "why": "User observation during workflow"
}
```

---

### @inquiry [question]
Ask questions without triggering workflow commands.

**Usage:**
```
@inquiry What files were modified in the last workflow?
@inquiry Should I suspend here or continue?
@inquiry What would happen if I handoff to Architect?
```

**Behavior:**
- No workflow commands processed (@handoff, @send, @suspend, etc.)
- No workflow files created (HANDOFF.md, MESSAGE.md)
- No profile activation
- Conversational Q&A only
- Normal reasoning and analysis allowed

**Exit Inquiry Mode:**
Start a new message without `@inquiry`.

**Example:**
```
User: "@inquiry What would happen if I handoff to Architect now?"
Profile: "Architect would receive the current context and analyze the architectural implications. However, since Builder hasn't completed implementation yet, Architect would have incomplete information. Better to complete Builder work first."

User: "Thanks. Continue with implementation."
Profile: [Continues normal workflow]
```

---

## Profile Activation

### Act as [Profile]
Explicit profile activation.

**Usage:**
```
Act as Builder
Act as Architect
```

**Behavior:**
- Activates specified profile
- Profile follows its rules and boundaries
- Requires explicit goal or task
- Does not read HANDOFF.md or MESSAGE.md

**Example:**
```
User: "Act as Architect. Analyze the Document domain migration."
Architect: [Begins analysis]
```

---

### As [Profile]
Shorthand profile activation.

**Usage:**
```
As Builder, implement the schema changes
As Enforcer, validate the implementation
```

**Behavior:**
- Same as "Act as [Profile]"
- More concise syntax
- Activates profile with goal

**Example:**
```
User: "As TestDesigner, create test scenarios for the new guards."
TestDesigner: [Creates test scenarios]
```

---

### @[Profile]
Mention (does NOT activate).

**Usage:**
```
@Builder should implement this
@Architect needs to review
```

**Behavior:**
- Mentions profile in conversation
- Does NOT activate the profile
- Does NOT switch profiles
- Used for discussion only

**Example:**
```
User: "I think @Architect should review this before we proceed."
CurrentProfile: "Agreed. Would you like to handoff to Architect?"
User: "@handoff next=Architect"
```

---

## Command Combinations

### Handoff with Next Profile

**Usage:**
```
@handoff next=Planner
@handoff next=Builder
```

**Behavior:**
- Creates HANDOFF.md with specified next profile
- Useful when next profile is known
- Still requires user confirmation

---

### Send with Purpose

**Usage:**
```
@send PE {{purpose}}
@send Architect {{purpose}}
```

**Behavior:**
- Creates MESSAGE.md with specified purpose
- Clarifies intent of side trip
- Still requires user confirmation

---

## Edge Cases

### Multiple Handoffs in Same Session

**Behavior:**
- Each handoff overwrites previous HANDOFF.md
- Only most recent handoff is active
- Previous handoffs are lost

**Recommendation:**
- Complete handoff before creating new one
- Use @suspend if need to pause

---

### Handoff Without Confirmation

**Behavior:**
- Profile MUST request confirmation
- Profile MUST wait for approval
- Profile MUST NOT write HANDOFF.md without approval

**Violation:**
- If profile writes HANDOFF.md without confirmation, user should correct

---

### Start Without HANDOFF.md

**Behavior:**
- @start requires HANDOFF.md to exist
- If missing, profile should inform user
- User should create handoff first

---

### Receive Without MESSAGE.md

**Behavior:**
- @receive requires MESSAGE.md to exist
- If missing, profile should inform user
- User should create message first

---

## Command Workflow Patterns

### Linear Workflow (Handoff)
```
Profile A: "@handoff"
User confirms
Profile A writes HANDOFF.md
User opens new tab
User: "@start"
Profile B reads HANDOFF.md
Profile B continues work
```

---

### Parallel Workflow (Send/Receive)
```
Profile A: "@send ProfileB"
User confirms
Profile A writes MESSAGE.md
Profile A stays active
User opens new tab
User: "@receive"
Profile B reads MESSAGE.md
Profile B does work
User closes tab
User returns to Profile A tab
Profile A continues
```

---

### Suspend/Resume Workflow
```
Profile A working
User: "@suspend feature-x"
Profile A saves context
[Later]
User: "@resume feature-x"
Profile A loads context
Profile A continues work
```

---

## Common Mistakes

### Mistake 1: Using @handoff without confirmation
**Wrong:**
```
Profile: "@handoff"
[Profile writes HANDOFF.md immediately]
```

**Correct:**
```
User: "@handoff"
Profile: "Created handoff to Builder. Should I proceed?"
User: "Yes"
Profile: [Writes HANDOFF.md]
```

---

### Mistake 2: Mentioning profile activates it
**Wrong:**
```
User: "I think @Builder should handle this"
[Builder activates]
```

**Correct:**
```
User: "I think @Builder should handle this"
CurrentProfile: "Would you like to handoff to Builder?"
User: "Act as Builder"
[Builder activates]
```

---

### Mistake 3: Using @start in same tab
**Wrong:**
```
Profile A: "@handoff"
User: "@start" [in same tab]
```

**Correct:**
```
Profile A: "@handoff"
User opens new tab
User: "@start" [in new tab]
```

---

## Reference

For complete workflow mechanics, see:
- `.workflow/rules/workflow/workflow-mechanics.md` - MANDATORY mechanics
- `docs/dev/workflow/workflow-examples.md` - Detailed examples
