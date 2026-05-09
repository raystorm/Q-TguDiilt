When command `@_autoSuspend` is received then process the following auto-suspend implementation patterns.

# Auto-Suspend Implementation

## Atomic Write Strategy

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

## Error Handling

```typescript
try {
  // Write to temp file
  fsWrite({
    command: "create",
    path: ".amazonq/suspended/auto-[profile]-[subject]-[workflowId].tmp",
    fileText: [content]
  });
  
  // Atomic rename
  try {
    fs.rename(
      ".amazonq/suspended/auto-[profile]-[subject]-[workflowId].tmp",
      ".amazonq/suspended/auto-[profile]-[subject]-[workflowId].md"
    );
  } catch (renameError) {
    // Log auto_suspend_failed event
    fsWrite({
      command: "append",
      path: ".amazonq/workflow.log",
      fileText: JSON.stringify({
        type: "event",
        workflowId: "[workflowId]",
        timestamp: "[timestamp]", // generated with Timestamp Generation Method
        source: "system",
        actor: "[ProfileName]",
        eventType: "auto_suspend_failed",
        what: "Failed to rename auto-suspend temp file",
        why: renameError.message,
        context: { error: renameError.message }
      }) + "\n"
    });
  }
} catch (writeError) {
  // Log auto_suspend_failed event
  fsWrite({
    command: "append",
    path: ".amazonq/workflow.log",
    fileText: JSON.stringify({
      type: "event",
      workflowId: "[workflowId]",
      timestamp: "[timestamp]", // generated with Timestamp Generation Method
      source: "system",
      actor: "[ProfileName]",
      eventType: "auto_suspend_failed",
      what: "Failed to write auto-suspend temp file",
      why: writeError.message,
      context: { error: writeError.message }
    }) + "\n"
  });
}
```

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

## Key Context Update Patterns

**Files Modified:**
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

**Last Handoff:**
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

**Validation Status:**
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

**Blockers:**
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

## INDEX.md Operations

**Add entry on creation:**
```markdown
## Auto-Suspend (Active)

- **auto-[profile]-[subject]-[workflowId]** - [Profile]: [Goal] - [timestamp]
```

**Remove entry on deletion:**
Remove the line matching the workflowId from INDEX.md.
