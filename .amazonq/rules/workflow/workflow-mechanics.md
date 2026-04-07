# Workflow Mechanics

## Purpose

Define workflow mechanics in one central reference:
- Changeovers (parent concept for all profile-to-profile workflow progression)
- Standard Handoffs (Linear Changeover)
- Side Trips (Parallel Changeover)
- Profile Completion rules (before Changeover)
- Reviewable handoffs (prevent incomplete information)
- Standard workflow steps (expectations for all profiles)

---

## Changeovers (Parent Concept)

A **Changeover** is a governed workflow operation transferring control and context
between profiles. All Changeovers follow the same invariant:

**user-triggered → summarized → confirmed → approved → written**

Changeovers have **three phases**:
1. **Profile Completion and Confirmation(Before Changeover)**  
2. **Change (Initiating a Changeover)**  
3. **Begin (Activating a Changeover)**

### Changeover Confirmation

**CRITICAL - MANDATORY FOR ALL PROFILES:** Profiles must NOT auto-create Changeovers.
  User triggers Changeover creation with `@handoff` or `@send` commands.
**This applies to ALL profiles that create Changeovers:**

**Why:**
- Catches incomplete information
- Validates Changeover quality
- Prevents cascade of incomplete work
- Gives user control over workflow progression

### Profile Completion and User Work Confirmation (Before Changeover)

Profiles must follow these rules when they believe their work is complete,
*before* any Changeover is initiated.

#### Single Message Completion Rule

To clearly and safely finish a profile's execution—while minimizing unnecessary
back-and-forth—profiles must provide: completion, summary, and the next-step
instruction in a **single message**.

This completion summary is **not** the Changeover summary.  
Profiles must **never** execute the proposed command.  
Only the user may trigger `@handoff` or `@send`.

**Example:**
```
[Profile] [Task] complete.
[Summary of results]
Ready to continue? Use: `@handoff` (or `@send [Profile]`)
```

*The message MUST appear as one message, with no pause, no STOP, and no wait.*

#### Do Not Initiate Changeover Early

- Do **not** create HANDOFF.md or MESSAGE.md early  
- Do **not** ask “Should I proceed?” before the user triggers a Change command  
- Do **not** split summary and instruction into separate messages  

**What NOT to do:**
- ❌ Print summary, then stop, then wait for user, then ask about handoff (double interaction)
- ❌ "Work complete. [Summary]." [stops] ... [user types something] ... "Should I proceed?"

**What to do "Single Message":**
- ✅ "Work complete. [Summary]. Ready to hand off? Use: `@handoff`" (single message)

#### Key Principle

- Summary + next action instruction = **one message**  
- Wait for the user to trigger `@handoff` or `@send`


### Change (Initiating a Changeover)

**Change** is a rule-facing categorization that groups the commands which
initiate a Changeover:
- `@handoff` (linear)  
- `@send` (parallel)  

When the user triggers a Change command, profiles must:
1. Generate the proposed Changeover file in memory
2. Show a Changeover summary:
   - What is being passed  
   - What the receiving profile will do  
   - What information is included  
3. Request explicit user confirmation  
4. **Wait for approval before completing Changeover**  
5. **Never complete Changeover without explicit user approval**  
6. After approval, Write the Changeover file  
7. After approval, Display the next user command

**What counts as explicit confirmation:**
- "Yes", "Yes, proceed", "Go ahead", "Approved"
- "LGTM", "Looks good", "Proceed"

**What does NOT count:**
- Clarifying questions  
- Acknowledging understanding  
- General agreement without explicit approval

**Example Changeover summary:**
```
Created handoff to [Profile] with:
- [Artifact 1]: [description]
- [Artifact 2]: [description]
- [Context]: [key decisions/information]

Receiving profile will: [expected action]

Should I proceed with handoff?

[After user confirms]

Next command: Open new tab and type `'@start' to run as [Profile]
```

### Begin (Activating a Changeover)

**Begin** is a rule-facing categorization that groups the commands which
activate a Changeover:
- `@start` (linear)  
- `@receive` (parallel)  

When the user triggers a Begin command, profiles must:
1. Read the Changeover file
2. Load context
3. Begin workflow responsibilities

### Types of Changeovers

- **Handoff** — Linear Changeover (Main Thread progression)
- **Side Trip** — Parallel Changeover (temporary branch)

Both types follow the **Profile Completion**, **Change**, and **Begin**
invariants defined above.

---

## Standard Handoffs (Linear Changeover)

**Handoffs are Linear Changeovers.**  
They follow the **Change** and **Begin** invariants defined in the Changeover section.

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
Profile A shows summary and requests confirmation
  ↓
User approves handoff
  ↓
Profile A creates HANDOFF.md (after confirmation)
  ↓
User triggers Profile B with @start
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
- Example: Architect → Planner → PE → Builder → Enforcer → Documentor

---

## Reviewable Handoffs

Reviewable Handoffs are simply **Handoffs with additional completeness checks**.
They still follow the **Change** invariant.

### Problem

Incomplete handoffs propagate through workflow.
Example: TestDesigner passes only test scenarios to PE, 
but PE needs full story requirements (schema, guards, wiring).

### Solution

Make handoffs explicit, reviewable, and governed by the Change invariant.

### Reviewable Handoff Pattern

**Profile creating handoff:**
1. user types `@handoff`
2. Generate the proposed HANDOFF content
3. **Show summary of what's being passed:**
   - "Passing to PE: test scenarios + story requirements (schema, guards, wiring)"
4. Request user confirmation
5. **Wait for approval before completing handoff**
6. Create HANDOFF.md
7. **Never complete handoff without explicit user approval**

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

**From Architect to Planner:**
- [ ] Impact analysis complete
- [ ] Change classification clear
- [ ] Phase recommendations included

**From Planner to PE:**
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

## Side Trips (Parallel Changeover)

**Side Trips are Parallel Changeovers.**  
They follow the **Change** and **Begin** invariants defined in the Changeover section.

### What Are Side Trips?

Parallel work where the current profile needs another profile to do work in isolation,
then return to the original context.

**Pattern:**
```
Profile A working
  ↓
Profile A needs Profile B for side task
  ↓
User triggers @send
  ↓
Profile A creates MESSAGE.md (after confirmation)
  ↓
User opens new tab
  ↓
User types @receive
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

### Workflow ID Generation

When a workflow begins, the mechanics generate a unique workflowId.
The workflowId must be included in all workflow artifacts, logs, suspends,
and auto-suspend checkpoints for the lifetime of the workflow.

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

**Profiles require confirmation before modifying any workflow artifact.**

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
- User activates Planner: `@handoff next=Planner`
- Planner reads FEATURE.md, sees current story complete
- Planner writes next story or escalates to Architect if needed

**2. Run Retrospective (Workflow Improvement)**
- After completing story or feature
- User triggers: `@handoff next=Retrospective`
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
   - "Story [N] complete. Continue with Story [N+1]? Use: `@handoff next=Planner`"
3. **If feature complete or no FEATURE.md:**
   - "Work complete. Run retrospective for improvements? Use: `@handoff next=Retrospective`"
4. Wait for user decision

### Decision Tree

```
Documentor commits
    ↓
User decides:
    ├─ More stories in feature? → @handoff next=Planner (next story)
    ├─ Want workflow improvements? → @handoff next=Retrospective
    ├─ New feature? → @handoff next=Planner (new feature)
    └─ Done? → Close tab
```

### Example Flows

**Multi-Story Feature:**
```
Story 1: Planner → TestDesigner → PE → Builder → Enforcer → Documentor
    ↓ (user commits)
Documentor: "Story 1 complete. Continue with Story 2? Use: `@handoff next=Planner`"
User: "@handoff next=Planner"
Story 2: Planner → TestDesigner → PE → Builder → Enforcer → Documentor
    ↓ (user commits)
Documentor: "Feature complete. Run retrospective? Use: `@handoff next=Retrospective`"
User: "@handoff next=Retrospective"
Retrospective analyzes and offers improvements
```

**Single Story with Retrospective:**
```
Story: Planner → TestDesigner → PE → Builder → Enforcer → Documentor
    ↓ (user commits)
Documentor: "Work complete. Run retrospective? Use: `@handoff next=Retrospective`"
User: "@handoff next=Retrospective"
Retrospective analyzes and offers improvements
```

**Single Story, No Retrospective:**
```
Story: Planner → TestDesigner → PE → Builder → Enforcer → Documentor
    ↓ (user commits)
Documentor: "Work complete. Run retrospective? Use: `@handoff next=Retrospective`"
User: (closes tab, done)
```

---

## Workflow Identity

Every workflow execution receives a unique **Workflow ID** when it begins.
This ID is generated automatically by the system and remains stable for the lifetime of the workflow.
It ties together all workflow artifacts—handoffs, messages, suspends, auto‑suspends,
and logs, allowing the system to maintain continuity, traceability,
and isolation across workflow steps.

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

Inquiry Mode is a **workflow safety state** that allows questions without
triggering workflow commands, state transitions, file creation,
or workflow execution. Normal reasoning and analysis are allowed.

### Usage

`@inquiry [question]`

**Example:**
`@inquiry What files were modified in the last workflow?`

### Behavior

When `@inquiry` is used:
- No workflow commands processed (@handoff, @send, @suspend, etc.)
- No workflow files created (HANDOFF.md, MESSAGE.md)
- No profile activation
- Conversational Q&A only

### Exit Inquiry Mode

Start a new message without `@inquiry`.

---

## Commands Reference

### Placeholder Semantics

`{{label}}`  
A literal placeholder that may be supplied by the user or inferred by the AI.  
May remain literal until resolved. Must be resolved before execution.

`[label]`  
A value that must be supplied by the AI.  
Must not remain literal. Must be resolved before execution.

For full behavioral details, see the prompt files that use these placeholders.  
`../../prompts/`

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

### Profile Activation

- `Act as [Profile]` - Explicit profile activation
- `As [Profile]` - Shorthand activation
- `@[Profile]` - Mention (does NOT activate)

---

## Folder and File Locations

### Workflow Folders

- `.amazonq/` - Base folder for all AI facing context and control files
- `.amazonq/prompts/` - synced repo local copy of installed prompts
- `.amazonq/rules/` - AI rules files that, comprise and control the workflow
- `.amazonq/suspended/` - Saved context capsules 
- `.amazonq/work/` - technical AI-facing workflow artifacts
- `.amazonq/work/current/` - current work cycle

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
4. Hands off to TestDesigner

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
Architect: "Analysis complete.
Created feature breakdown with 3 stories:
  1. Story A — Ingestion pipeline extension for new event type
  2. Story B — Validation layer updates with cross-profile constraints
  3. Story C — Coordination logic for downstream workflow triggers
Recommended phased rollout based on dependency ordering.
Ready to continue? Use: @handoff"
  ↓
User: "@handoff"
  ↓
Architect creates HANDOFF.md:
  "Handoff to Planner with:
   - Feature breakdown (3 stories)
   - Impact analysis (cross-domain, 50+ files)
   - Phase recommendations
   Should I proceed?"
  ↓
User reviews HANDOFF.md
User: "Yes, proceed"
  ↓
Architect: "Handoff complete. Next command: Open new tab and type `@start' to run as Planner"
  ↓
User opens new tab: "@start"
  ↓
Planner reads HANDOFF.md
Planner sequences stories
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
TestDesigner: "Handoff complete. Next command: Open new tab and type `'@start' to run as PE"
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
