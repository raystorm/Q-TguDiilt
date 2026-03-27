# User Workflow Commands

## @handoff - Create Standard Handoff

**Purpose:** User triggers profile to create handoff for passing work to next profile in linear workflow progression.

**Usage:** `@handoff`

**Behavior:**
- Current profile creates `.amazonq/work/current/HANDOFF.md`
- Profile shows summary of what's being passed
- Profile requests user confirmation
- User reviews HANDOFF.md for completeness
- User approves or requests additions
- Next profile activates with `@start`

**When to use:**
- Linear workflow progression
- Profile completes its responsibility
- Next profile needs context to continue
- Example: Architect → Tactician → PE → Builder → Enforcer → Documentor

See `workflow/workflow-mechanics.md` for detailed handoff patterns.

---

## @send - Create Side Trip Message

**Purpose:** User triggers profile to create message requesting parallel work from another profile, then return to original context.

**Usage:** `@send [ProfileName]`

**Examples:**
```
@send PE
@send Architect
@send Builder
```

**Behavior:**
- Current profile creates `.amazonq/work/current/MESSAGE.md`
- Profile indicates target profile
- User opens new chat tab
- User types `@receive` in new tab
- Target profile reads MESSAGE.md and does work
- User closes tab and returns to original profile
- Original profile continues with results

**When to use:**
- Current profile needs another profile's expertise
- Work can be done in isolation
- Non-blocking, parallel work
- Example: Retrospective creates rule draft, sends to PE for integration

See `workflow/workflow-mechanics.md` for detailed side trip patterns.

---

## @suspend - Save Workflow Context

**Purpose:** Checkpoint workflow context at any level for later resumption, enabling multi-story/multi-phase work without context loss.

**Usage:** `@suspend [optional-name]`

**Examples:**
```
@suspend
@suspend architect-document-migration
@suspend planner-story-1-backend
```

**Behavior:**
- Saves current context to `.amazonq/suspended/[name].md`
- Auto-generates name if not provided: `[profile]-[subject].md`
- Updates `.amazonq/suspended/INDEX.md` with entry
- Deletes auto-suspend file for current workflowId (manual replaces auto)
- Logs suspend event to workflow log
- Confirms: "Suspended as: [name]"

**Suspend File Format:**
```markdown
# Suspended: [Profile] - [Subject]

## Profile
[Profile name]

## Goal
[What was being worked on]

## Key Decisions
- Decision 1
- Decision 2

## Current State
[Where work left off]

## Helper Files
- [filename.md] - [description]

## Resume Instructions
[What to do when resuming]

## Metadata
- Type: [main_workflow | side_trip | analysis | checkup | debug | other]
- Status: [active | blocked | completed | abandoned]
- Suspended: [ISO timestamp]
- Last Active: [ISO timestamp]
- WorkflowId: [workflowId]
- ParentContext: [parent-context-name] (optional)
```

**Use Cases:**
- **Multi-story features:** Architect analyzes feature, suspends, Planner works on Story 1, resume for Story 2
- **Multi-phase stories:** Planner creates story, suspends, work on Phase 1, resume for Phase 2
- **Context recovery:** Accidentally close tab, resume from checkpoint

**Note:** Manual suspend replaces any auto-suspend file for the current workflow. Auto-suspends are lightweight background saves created automatically on every workflow event; manual suspends are intentional checkpoints with full context. See `workflow/auto-suspend.md` for auto-suspend details.

---

## @resume - Load Workflow Context

**Purpose:** Load previously suspended workflow context to continue work from checkpoint.

**Usage:** `@resume [name]`

**Examples:**
```
@resume
@resume architect-document-migration
@resume auto-builder-story-1-wf001
```

**Behavior:**
- If no name: Lists available suspended contexts from INDEX.md
- If name provided: Loads context from `.amazonq/suspended/[name].md`
- Displays context summary (Profile, Goal, Current State, Resume Instructions)
- Activates appropriate profile with context
- Logs resume event to workflow log
- User continues from checkpoint

**Auto-Suspend Resume:**
- Auto-suspend files use pattern: `auto-[profile]-[subject]-[workflowId].md`
- Created automatically on every workflow event (see `workflow/auto-suspend.md`)
- Enables recovery from accidental tab closure
- Contains last 5 events and key context
- Example: `@resume auto-builder-story-1-wf001`

---

## @list - Show Suspended Contexts

**Purpose:** Display all suspended workflow contexts.

**Usage:** `@list`

**Behavior:**
- Reads `.amazonq/suspended/INDEX.md`
- Displays formatted list with profile, subject, and date
- Shows manual suspends, auto-suspends, and completed contexts

**Example Output:**
```
Manual Suspends:
- architect-document-migration - Document Migration Analysis - 2025-01-27
- planner-story-1-backend - Story 1: Backend Guards - 2025-01-27

Auto-Suspend (Active):
- auto-builder-story-1-wf001 - Builder: Implement Story 1 - 2025-01-27 22:40:00
  - auto-enforcer-validation-wf002 - Enforcer: Validate changes (side trip) - 2025-01-27 22:45:00
- auto-architect-document-migration-wf003 - Architect: Analyze Document domain - 2025-01-27 23:00:00

Completed Contexts:
- architect-feature-x - Feature X Analysis - 2025-01-20
```

**Note:** Indentation shows parent/child relationships for side trips. Auto-suspends are created automatically (see `workflow/auto-suspend.md`).

---

## Suspended Directory Structure

```
.amazonq/suspended/
  README.md                           # Explains folder (version controlled)
  INDEX.md                            # Lists contexts (git ignored)
  .gitignore                          # Ignores all except README.md
  architect-document-migration.md     # Suspended context (git ignored)
  architect-document-migration-analysis.md  # Helper file (git ignored)
  planner-story-1-backend.md          # Suspended context (git ignored)
```

**File Naming:**
- Context files: `[profile]-[subject-slug].md`
- Helper files: `[context-name]-[helper-name].md`
- Flat structure initially, subdirectories if helpers become numerous

**INDEX.md Format:**
```markdown
# Suspended Contexts

## Manual Suspends

- **architect-document-migration** - Document Migration Analysis - 2025-01-27
- **planner-story-1-backend** - Story 1: Backend Guards - 2025-01-27

## Auto-Suspend (Active)

- **auto-builder-story-1-wf001** - Builder: Implement Story 1 - 2025-01-27 22:40:00
  - **auto-enforcer-validation-wf002** - Enforcer: Validate changes (side trip) - 2025-01-27 22:45:00
- **auto-architect-document-migration-wf003** - Architect: Analyze Document domain - 2025-01-27 23:00:00

## Completed Contexts

- **architect-feature-x** - Feature X Analysis - 2025-01-20 (completed)
```

**.gitignore Content:**
```
# Ignore all files in suspended/
*

# Except README.md and .gitignore
!README.md
!.gitignore
```

---

## @note - Log User Observations

**Purpose:** Capture user insights and observations during workflow execution for retrospective analysis.

**Usage:** `@note [observation text]`

**Examples:**
```
@note Builder missed the schema import, had to fix manually
@note PE prompt was incomplete, missing wiring step
@note This workflow felt too nested
@note Tests passed but runtime broke, need integration test
@note Enforcer validated wrong pattern, didn't check recent changes
```

**Behavior:**
- Extracts observation text from message
- Appends to `.amazonq/workflow.log` with proper JSONL format
- Uses current workflowId (or creates new one if none active)
- Uses accurate current timestamp (ISO 8601)
- Confirms "Note logged" to user

**Log Format:**
```json
{
  "type": "event",
  "workflowId": "current-workflow-id",
  "timestamp": "2025-01-27T18:46:00.000Z",
  "source": "user",
  "actor": "user",
  "eventType": "user_note",
  "what": "[observation text]",
  "why": "User-logged insight"
}
```

**Guidelines:**
- Keep notes short (one sentence preferred)
- Capture insights in the moment
- Focus on what happened and why it matters
- No need for detailed explanations

**Good notes:**
- "Builder missed X, had to fix manually"
- "Prompt incomplete, missing Y"
- "Workflow too nested, lost context"
- "Tests passed but runtime broke"

**Avoid:**
- Long paragraphs
- Detailed technical explanations
- Duplicate information already in system logs

**Benefits:**
- Captures real-time user insights during work
- Provides user perspective alongside system events
- Identifies patterns user notices that system doesn't log
- Enriches retrospective analysis with human observations
- Simple, low-friction logging mechanism

**Retrospective Integration:**
Retrospective profile analyzes user_note events to:
- Identify recurring user pain points
- Spot patterns in manual fixes
- Understand workflow friction points
- Validate system event accuracy
- Generate targeted improvements
