_# Auto-Suspend Implementation Reference

This document provides detailed implementation patterns for auto-suspend functionality.

For MANDATORY requirements and core specifications, see `.workflow/rules/workflow/auto-suspend.md`.

---

## Atomic Write Strategy

### Implementation Pattern

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

### Why Atomic Writes?

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

### Error Handling Implementation

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

## Auto-Suspend File Format Template

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

### Field Annotations

**Profile:** Name of the active profile (Builder, Enforcer, etc.)

**Goal:** Extracted from workflow_start event, describes what the workflow is trying to accomplish

**Recent Events:** Last 5 events from workflow.log, provides immediate context for resume

**Files Modified:** List of files changed during this workflow, extracted from file_modified and file_created events

**Last Handoff:** Most recent handoff_sent or handoff_received event, shows workflow progression

**Validation Status:** Extracted from validation_passed or validation_failed events

**Blockers:** Extracted from escalation or blocker events

**WorkflowId:** Unique identifier linking to workflow.log entries

**ParentContext:** Set for side trips, links to parent workflow

---

## Key Context Update Patterns

### Files Modified Updates

```typescript
// On file_modified event
if (event.eventType === "file_modified") {
  keyContext.filesModified.push(event.context.filePath);
}

// On file_created event
if (event.eventType === "file_created") {
  keyContext.filesModified.push(event.context.filePath);
}
```

### Last Handoff Updates

```typescript
// On handoff_sent event
if (event.eventType === "handoff_sent") {
  keyContext.lastHandoff = `Sent to ${event.context.targetProfile}`;
}

// On handoff_received event
if (event.eventType === "handoff_received") {
  keyContext.lastHandoff = `Received from ${event.context.sourceProfile}`;
}
```

### Validation Status Updates

```typescript
// On validation_passed event
if (event.eventType === "validation_passed") {
  keyContext.validationStatus = "Passed";
}

// On validation_failed event
if (event.eventType === "validation_failed") {
  keyContext.validationStatus = "Failed";
}
```

### Blockers Updates

```typescript
// On escalation event
if (event.eventType === "escalation") {
  keyContext.blockers.push(event.why);
}

// On blocker event
if (event.eventType === "blocker") {
  keyContext.blockers.push(event.what);
}
```

---

## Resume Pattern

### Resume Command

```
@resume auto-[profile]-[subject]-[workflowId]
```

### Resume Implementation

1. Read auto-suspend file
2. Extract profile, goal, recent events, key context
3. Display context summary to user
4. Activate profile with context
5. Continue from last action

### Resume Output Example

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

## Side Trip Support

### Side Trip File Naming

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

## Cleanup Patterns

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

### Cleanup of Temp Files

**Orphaned .tmp files:**
- If rename fails, `.tmp` file left behind
- Retrospective cleanup removes all `.tmp` files
- Next auto-suspend attempt removes old `.tmp` before writing new one
