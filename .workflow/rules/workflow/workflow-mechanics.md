# Workflow Mechanics

## Changeovers (Parent Concept)

A **Changeover** is a governed workflow operation transferring control and context
between profiles. All Changeovers follow the same invariant:

**user-triggered → summarized → confirmed → approved → written**

See foundation/terms.md for complete Changeover definitions.

Changeovers have **three phases**:
1. **Profile Completion and Confirmation(Before Changeover)**  
2. **Change (Initiating a Changeover)**  
3. **Begin (Activating a Changeover)**

### Changeover Confirmation

**CRITICAL - MANDATORY FOR ALL PROFILES:** Profiles must NOT auto-create Changeovers.
  User triggers Changeover creation with `@handoff` or `@send` commands.
**This applies to ALL profiles that create Changeovers:**

### Profile Completion and User Work Confirmation (Before Changeover)

Profiles must follow these rules when they believe their work is complete,
*before* any Changeover is initiated.

#### Single Message Completion Rule

To clearly and safely finish a profile's execution—while minimizing unnecessary
back-and-forth—profiles must provide: completion, summary, and the next-step
instruction in a **single message**.

This completion summary is **not** the Changeover summary.  
Profiles must **never** execute the proposed command.  
Only the user may trigger `@handoff`, `@send`, or close the tab.

**When Changeover is next:**
```
[Profile] [Task] complete.
[Summary of results]
**Next**: Run `@handoff` to [next profile in the workflow] (or `@send [next profile in the workflow]`)
```

**When no Changeover (side trip completion):**
```
[Profile] [Task] complete.
[Summary of results]
Close this tab and return to [source profile] tab.
```

*The message MUST appear as one message, with no pause, no STOP, and no wait.*

#### Do Not Initiate Changeover Early

- Do **not** create HANDOFF.md or MESSAGE.md early  
- Do **not** ask “Should I proceed?” before the user triggers a Change command  
- Do **not** ask "are we done?" when side trip work is complete
- Do **not** split summary and instruction into separate messages  

**What NOT to do:**
- ❌ Print summary, then stop, then wait for user, then ask about handoff (double interaction)
- ❌ "Work complete. [Summary]." [stops] ... [user types something] ... "Should I proceed?"

**What to do "Single Message":**
- ✅ "Work complete. [Summary]. Ready to hand off? Use: `@handoff`" (single message)

#### Key Principle

- Summary + next action instruction = **one message**  
- Wait for the user to trigger `@handoff`, `@send`, or close tab


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
7. **If handoff**
   After approval, Remove stale files from `.amazonq/work/current/`
   (all files except the newly written `HANDOFF.md` and it's listed artifacts)
8. After approval, Display the next user command

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

#### Context Status Output (MANDATORY)

Immediately after profile activation *FROM* a changeover file,
profile MUST output a Context Status block
and then perform any other profile activation triggers.

See foundation/terms.md for a full definition of changeover file.

```
=== Context Status ===
Profile: [ProfileName]
WorkflowId: [workflowId]
Rules Loaded: [count] files
Context: [percentage]%
======================
```

**Fields:**
- **Profile:** Name of activated profile
- **WorkflowId:** Current workflow ID from HANDOFF.md or MESSAGE.md
- **Rules Loaded:** Count of rule files loaded (approximate, e.g., "12 files")
- **Context:** Percentage of context window used (e.g., "45%")

### Types of Changeovers

- **Handoff** — Linear Changeover (Main Thread progression)
- **Side Trip** — Parallel Changeover (temporary branch)

Both types follow the **Profile Completion**, **Change**, and **Begin**
invariants defined above.

### Changeover File Format

Both HANDOFF.md and MESSAGE.md use the same canonical shape.
See `workflow/changeover-format.md` for the authoritative definition.

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

## Doctor Integration in Stories

When Doctor fixes issues during story implementation, Doctor's changes are part of the story scope.

**Story scope includes:**
- Builder's initial implementation
- Doctor's troubleshooting and fixes (via side trip)
- All changes needed to make the story work

Enforcer validates all changes together (Builder + Doctor) as one story completion.
Documentor commits all changes together with single commit message.

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

### @as Activation (No Changeover)

When activated via `@as` (no changeover file involved):
- Do NOT output Context Status block (no changeover file to report)
- Follow standard Profile Activation Sequence from general.md
  (skipping Context Status, which requires a changeover)

### Work Execution

1. Profile performs its responsibility
2. Profile follows its rules and boundaries
3. Profile creates artifacts (code, docs, prompts, etc.)

### Confirmation Requirements

**CRITICAL:** Profiles follow the confirmation sequence defined in
`workflow/agentic-confirmation.md`. All modifications to persistent workflow
artifacts require the standard confirmation sequence.

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
4. Profile generates proposed HANDOFF.md content
5. Profile shows summary of what's being passed
6. Profile requests explicit user confirmation
7. **Profile waits for approval**
8. User approves
9. Profile writes HANDOFF.md (only after confirmation)
10. Next profile activates with `@start`

---

## Post-Documentor Branching

### Decision Points After Commit

After Documentor creates commit message and user commits, user chooses next action:

**1. Continue to Next Story (Multi-Story Feature)**
- If FEATURE.md exists and more stories remain
- If next story is fully specified (acceptance criteria, routing,
  and dependencies defined in FEATURE.md):
  - User may hand off directly to the first profile in the
    story's routing (skipping Planner)
- If next story needs refinement, routing is unspecified,
  or dependencies have changed:
  - User activates Planner: `@handoff to=Planner`
  - Planner reads FEATURE.md, refines story, and hands off

**2. Run Retrospective (Workflow Improvement)**
- After completing story or feature
- User triggers: `@handoff to=Retrospective`
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
   - If next story is fully specified with routing:
     "Story [N] complete. Next story routes to [first profile].
      Use: `@handoff to=[first profile]` or `@handoff to=Planner`
      if refinement needed."
   - If next story needs refinement:
     "Story [N] complete. Continue with Story [N+1]? Use: `@handoff to=Planner`"
3. **If feature complete or no FEATURE.md:**
   - "Work complete. Run retrospective for improvements? Use: `@handoff to=Retrospective`"
4. Wait for user decision

### Decision Tree

```
Documentor commits
    ↓
User decides:
    ├─ More stories in feature? → @handoff to=Planner (next story)
    ├─ Want workflow improvements? → @handoff to=Retrospective
    ├─ New feature? → @handoff to=Planner (new feature)
    └─ Done? → Close tab
```

---

## Workflow Identity

Every workflow execution receives a unique **Workflow ID** when it begins.

**Format:** `wf-[human-readable-kebab-case]`
- Derived from goal or feature name
- Lowercase, hyphen-separated, 2–5 words

This ID is generated automatically by the system and remains stable for the lifetime of the workflow.
It ties together all workflow artifacts—handoffs, messages, suspends, auto‑suspends,
and logs, allowing the system to maintain continuity, traceability,
and isolation across workflow steps.

The workflowId is carried in changeover files as a top-level field.
See `workflow/changeover-format.md` for the canonical shape.

---

## Inquiry Mode

### What is Inquiry Mode?

Inquiry Mode is a **workflow safety state** that allows questions without
triggering workflow commands, state transitions, file creation,
or workflow execution. Normal reasoning and analysis are allowed.

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
- No profile activation
- Conversational Q&A only

### Exit Inquiry Mode

Start a new message without `@inquiry`.

---

## Commands Reference

### User Commands

- `@as [Profile]` - Explicit profile rule loading and activation
                    command. Not a Changeover command — does not read or create
                    changeover files. Activates from user intent alone.
- `@handoff` - Trigger current profile to create HANDOFF.md for linear workflow progression
- `@send [Profile]` - Trigger current profile to create MESSAGE.md for side trip work
- `@start` - Read HANDOFF.md and activate profile
- `@receive` - Read MESSAGE.md and activate profile
- `@suspend [name]` - Save workflow context for later
- `@resume [name]` - Load saved workflow context
- `@list` - Show all suspended contexts
- `@note [text]` - Log user observation to workflow log
- `@inquiry [question]` - Ask questions without triggering workflow commands

### Command Argument Syntax

Commands accept `key=value` arguments on the same line:

    @handoff to=Profile
    @send to=Profile task="validate the test plan"

Rules:
- Arguments are optional for the user unless stated otherwise
- When omitted, the AI infers the value from workflow context
- Each argument maps to a `{{key}}` template variable in the
  corresponding prompt file

### Arguments by Command

| Command  | Argument     | Required | User-Supplied | Description                  |
| -------- | ------------ | -------- | ------------- | ---------------------------- |
| @handoff | to           | Yes      | Optional      | Target profile for handoff   |
| @send    | to           | Yes      | Optional      | Target profile for side trip |
| @send    | task         | No       |               | Short description of task    |
| @suspend | [positional] | No       |               | Name for suspended context   |
| @resume  | [positional] | No       |               | Name of context to restore   |
| @note    | [positional] | Yes      | Yes           | Text to log                  |
| @inquiry | [positional] | Yes      | Yes           | Question text                |
| @as      | [positional] | Yes      | Yes           | Profile name                 |
| @as      | [rest]       | No       |               | Task description             |
| @start   | (none)       |          |               |                              |
| @receive | (none)       |          |               |                              |
| @list    | (none)       |          |               |                              |

---

## Folder and File Locations

### Workflow Folders

- `.workflow/` - Base folder for all AI workflow rules files
- `.workflow/rules/` - AI rules files that, comprise and control the workflow
- `.amazonq/` - Base folder for all AI facing context and control files
- `.amazonq/rules/` - AI workflow/profile activation rules
- `.amazonq/prompts/` - synced repo local copy of installed prompts
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
4. Hands off to next profile

**Between stories:**
1. Documentor updates FEATURE.md after story completion
2. Marks completed story as "Complete"
3. Marks next story as "In Progress"
4. Adds progress notes

**After all stories:**
1. Retrospective cleans up FEATURE.md

**FEATURE.md Format:**

```markdown
# Feature: [Feature Name]

## Goal
[High-level feature objective]

## Stories
- [ ] Story 1: [Title] - Not Started
- [ ] Story 2: [Title] - Not Started
- [ ] Story 3: [Title] - Not Started

## Current Story
**Story 1: [Title]**

Status: In Progress

## Analysis Artifacts

[Optional: Links to analysis documents in .amazonq/work/]

## Progress Notes
- [Date]: [Progress update]

## Story Dependencies

[Optional: Technical dependencies between stories]
```

For troubleshooting FEATURE.md issues, process `@_troubleshootFeatureTracking`.

### FEATURE.md vs Suspended Contexts

**Use FEATURE.md when:**
- Linear story progression
- All stories known upfront
- Simple tracking needed

**Use @suspend when:**
- Need to pause and work on unrelated tasks
- Complex context needs preservation
- Uncertain when work will resume


