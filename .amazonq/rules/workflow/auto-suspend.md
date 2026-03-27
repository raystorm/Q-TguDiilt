# Auto-Suspend Background Logging

## Purpose

Enable recovery from accidental tab closure
by automatically maintaining current workflow state in background.

## Overview

Auto-suspend creates lightweight checkpoint files that update automatically,
on stable workflow events like `handoff_sent`.
If user accidentally closes a tab, they can resume from the last state.

---

## File Naming

**Format:** `auto-[profile]-[subject]-[workflowId].md`

**Examples:**
- `auto-builder-story-1-wf001.md`
- `auto-enforcer-validation-wf002.md`
- `auto-architect-document-migration-wf003.md`

**Temp files during write:** `auto-[profile]-[subject]-[workflowId].tmp`

---

## When to Create/Update/Delete

### On workflow_start Event (MANDATORY)

1. Generate workflowId (e.g., `wf-` + short timestamp)
2. Extract profile and goal from workflow_start
3. Generate subject slug from goal (lowercase, hyphenated)
4. Create initial auto-suspend file: `auto-[profile]-[subject]-[workflowId].md`
5. Add entry to `.amazonq/suspended/INDEX.md` under "Auto-Suspend (Active)"

### On Every handoff_sent Event (MANDATORY)

Auto-suspend MUST update on every `handoff_sent` event

1. Write updated content to temp file: `auto-[profile]-[subject]-[workflowId].tmp`
2. Atomic rename temp to final: `.tmp` → `.md` (overwrites existing)
3. Update "Last Active" timestamp
4. Keep last 5 events in "Recent Events" (drop oldest)
5. Update "Key Context" based on event type

This ensures a stable recovery point after a profile has finished its work.

### On Every Subsequent Event (Optional)

Auto‑suspend MAY update if the workflow is stable and a significant change has been made, but is not required.


### On workflow completion

1. Log completion event
2. Delete auto-suspend file

---

## Atomic Write Strategy

### Implementation

**Step 1: Write to temp file**
```typescript
fsWrite({
  command: "create",
  path: ".amazonq/suspended/auto-[profile]-[subject]-[workflowId].tmp",
  fileText: [updated content]
});
```

**Step 2: Atomic rename**
```typescript
fs.rename(
  ".amazonq/suspended/auto-[profile]-[subject]-[workflowId].tmp",
  ".amazonq/suspended/auto-[profile]-[subject]-[workflowId].md"
);
```

### Benefits

**Prevents corruption:**
- If write fails mid-operation, temp file is corrupted (not the real file)
- Original `.md` file remains intact and valid
- User can still resume from last successful checkpoint

**Atomic operation:**
- Rename is atomic on most filesystems
- File is either old version or new version, never partial/corrupted
- No race conditions

**Graceful degradation:**
- If temp write fails: old auto-suspend remains valid
- If rename fails: old auto-suspend remains valid, temp file left behind
- Workflow continues regardless

### Error Handling

```typescript
try
{ // Write to temp file
  fsWrite create .tmp file
  
  // Atomic rename
  try { fs.rename .tmp to .md }
  catch (renameError)
  { // Rename failed, log it
    // Old .md file still valid
    // Clean up .tmp file if possible
    log auto_suspend_failed event
  }  
}
catch (writeError)
{ // Write failed, log it
  // Old .md file still valid (if exists)
  log auto_suspend_failed event
}
```

### Error Logging

If auto-suspend write fails, log to workflow.log:

```json
{
  "type": "event",
  "workflowId": "wf-001",
  "timestamp": "2025-01-27T23:00:00.000Z",
  "source": "system",
  "actor": "ProfileName",
  "eventType": "auto_suspend_failed",
  "what": "Failed to write auto-suspend file",
  "why": "Disk full / Permission denied / etc.",
  "context": {"error": "error message"}
}
```

---

## Auto-Suspend File Format

```markdown
# Auto-Suspend: [Profile] - [Subject]

## Profile
[Profile name]

## Goal
[Extracted from workflow_start]

## Recent Events (Last 5)
- [timestamp] [actor] [eventType]: [what]
- [timestamp] [actor] [eventType]: [what]
- [timestamp] [actor] [eventType]: [what]
- [timestamp] [actor] [eventType]: [what]
- [timestamp] [actor] [eventType]: [what]

## Key Context

**Files Modified:**
- [file path 1]
- [file path 2]

**Last Handoff:** [handoff info or "None"]

**Validation Status:** [status or "Not started"]

**Blockers:** [blocker list or "None"]

## Resume Instructions
Review recent events above and continue from last action.
Check `.amazonq/work/current/` for active artifacts (HANDOFF.md, MESSAGE.md, etc.)

## Metadata
- Type: auto_suspend
- Status: active
- Last Active: [ISO timestamp]
- WorkflowId: [workflowId]
- ParentContext: [parent-workflowId] (optional, for side trips)
```

---

## Key Context Updates

Event types that update Key Context sections:

**Files Modified:**
- `file_modified` → Add file path to list
- `file_created` → Add file path to list

**Last Handoff:**
- `handoff_sent` → Update with "Sent to [Profile]"
- `handoff_received` → Update with "Received from [Profile]"

**Validation Status:**
- `validation_passed` → Update to "Passed"
- `validation_failed` → Update to "Failed"

**Blockers:**
- `escalation` → Add escalation reason
- `blocker` → Add blocker description

---

## Side Trip Support

### Behavior

Each workflowId gets its own auto-suspend file. Side trips do not overwrite main thread.

**Main thread:**
- WorkflowId: `wf-001`
- File: `auto-builder-story-1-wf001.md`
- ParentContext: (none)

**Side trip:**
- WorkflowId: `wf-002`
- File: `auto-enforcer-validation-wf002.md`
- ParentContext: `wf-001`

### INDEX.md Representation

```markdown
## Auto-Suspend (Active)

- **auto-builder-story-1-wf001** - Builder: Implement Story 1 - 2025-01-27 22:40:00
  - **auto-enforcer-validation-wf002** - Enforcer: Validate changes (side trip) - 2025-01-27 22:45:00
- **auto-architect-document-migration-wf003** - Architect: Analyze Document domain - 2025-01-27 23:00:00
```

Indentation shows parent/child (side trip) relationships.

---

## Auto-Suspend vs Manual Suspend

### Auto-Suspend

**Created:** Automatically on workflow start
**Updated:** On every workflow event
**Naming:** `auto-[profile]-[subject]-[workflowId].md`
**Content:** Lightweight (last 5 events, key context)
**Purpose:** Recovery from accidental closure
**Type:** Always `auto_suspend`
**Status:** Always `active`

### Manual Suspend

**Created:** By user with `@suspend` command
**Updated:** Never (snapshot at suspend time)
**Naming:** `[profile]-[subject].md` (user-defined)
**Content:** Full context (decisions, state, helper files)
**Purpose:** Intentional checkpoint for multi-phase work
**Type:** User-defined (main_workflow, side_trip, analysis, etc.)
**Status:** User-defined (active, blocked, completed, abandoned)

### Key Differences

**Auto-Suspend has:**
- Recent Events (Last 5)
- Key Context (extracted from events)
- Always active status
- Automatically updated

**Manual Suspend has:**
- Key Decisions
- Current State
- Helper Files
- User-defined status
- Static snapshot

**Both have:**
- Profile
- Goal
- Resume Instructions
- Metadata (WorkflowId, Last Active, ParentContext)

---

## Cleanup

### When to Delete Auto-Suspend

**Automatic cleanup:**
1. Workflow completes successfully (Documentor commits)
   - Delete auto-suspend for that workflowId
   - Remove from INDEX.md
2. User runs manual `@suspend`
   - Delete auto-suspend for current workflowId
   - Manual suspend replaces auto-suspend
3. Retrospective cleanup
   - Delete all auto-suspend files
   - Clean up orphaned `.tmp` files

**Keep auto-suspend when:**
- Tab accidentally closed (enables resume)
- Side trip paused (can resume later)
- Workflow still active

### Cleanup of Temp Files

**Orphaned .tmp files:**
- If rename fails, `.tmp` file left behind
- Retrospective cleanup removes all `.tmp` files
- Next auto-suspend attempt removes old `.tmp` before writing new one

---

## Resume from Auto-Suspend

### Command

`@resume auto-[profile]-[subject]-[workflowId]`

**Example:**
```
@resume auto-builder-story-1-wf001
```

### Behavior

1. Read auto-suspend file
2. Extract profile, goal, recent events, key context
3. Display context summary to user
4. Activate profile with context
5. Continue from last action

### Resume Output

```
Resuming: Builder - Implement Story 1

Last Active: 2025-01-27 22:45:00

Recent Events:
- 22:45:00 Builder file_modified: Updated Collection schema
- 22:43:00 Builder handoff_received: Received from PE
- 22:40:00 user confirmation_given: Approved approach
- 22:38:00 Builder profile_activated: Started implementation
- 22:35:00 PE handoff_sent: Handoff to Builder

Files Modified:
- amplify/data/Collection/Collection.graphql
- amplify/data/Collection/CollectionInput.graphql

Continuing as Builder...
```

---

## Benefits

**Prevents context loss:**
- Accidental tab closure recoverable
- Always have last 5 events
- Key context preserved

**Low friction:**
- Automatic, no user action required
- Lightweight (last 5 events only)
- Doesn't interfere with manual suspends

**Robust:**
- Atomic writes prevent corruption
- Graceful degradation on errors
- Workflow continues even if auto-suspend fails

**Hygiene:**
- Auto-cleanup on completion
- Separate from manual suspends
- Clear naming convention
- Temp files cleaned up

---

## File Locations

- `.amazonq/suspended/auto-[profile]-[subject]-[workflowId].md` - Auto-suspend files
- `.amazonq/suspended/auto-[profile]-[subject]-[workflowId].tmp` - Temp files during write
- `.amazonq/suspended/INDEX.md` - Lists manual and auto-suspend contexts
- `.amazonq/workflow.log` - Source of events for auto-suspend updates
