# Auto-Suspend Background Logging

## File Naming

**Format:** `auto-[profile]-[subject]-[workflowId].md`

**Temp files during write:** `auto-[profile]-[subject]-[workflowId].tmp`

---

## When to Create/Update/Delete

### On `workflow_start` Event (MANDATORY)

1. Generate workflowId (e.g., `wf-` + kebabe-case-task-title)
2. Extract profile and goal from workflow_start
3. Generate subject slug from goal (lowercase, hyphenated)
4. Create initial auto-suspend file: `auto-[profile]-[subject]-[workflowId].md`
5. Add entry to `.amazonq/suspended/INDEX.md` under "Auto-Suspend (Active)"

### On Every `handoff_sent` Event (MANDATORY)

Auto-suspend MUST update on every `handoff_sent` event.

1. Write updated content to temp file: `auto-[profile]-[subject]-[workflowId].tmp`
2. Atomic rename temp to final: `.tmp` → `.md` (overwrites existing)
3. Update "Last Active" timestamp
4. Keep last 5 events in "Recent Events" (drop oldest)
5. Update "Key Context" based on event type

### On Other Events (Optional)

Auto-suspend MAY update on any other event if:
- Something important happened that should be checkpointed
- Large change occurred that warrants a recovery point
- Profile determines the event is significant enough to preserve

**Common optional checkpoint events:**
- `file_created` - When creating critical files
- `validation_passed` - After successful validation
- `test_fixed` - After resolving test failures
- `escalation` - Before escalating to another profile

**For complete event type list, see:** `workflow/logging.md` - Event Types section


### On workflow completion

1. Log completion event
2. Delete auto-suspend file

---

## Atomic Write Strategy

**When performing auto-suspend operations, process `@_autoSuspend` for implementation details.**

---

## Auto-Suspend File Format

**When performing auto-suspend operations, process `@_autoSuspend` for file format template.**

---

## Key Context Updates

**When performing auto-suspend operations, process `@_autoSuspend` for update patterns.**

---

## Side Trip Support

### Behavior

Each workflowId gets its own auto-suspend file. Side trips do not overwrite main thread.

---

## Auto-Suspend vs Manual Suspend

### Auto-Suspend

**Created:** Automatically on workflow start
**Updated:** On every workflow event
**Naming:** `auto-[profile]-[subject]-[workflowId].md`
**Content:** Lightweight (last 5 events, key context)
**Type:** Always `auto_suspend`
**Status:** Always `active`

### Manual Suspend

**Created:** By user with `@suspend` command
**Updated:** Never (snapshot at suspend time)
**Naming:** `[profile]-[subject].md` (user-defined)
**Content:** Full context (decisions, state, helper files)
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

**When performing auto-suspend cleanup operations, process `@_cleanupAutoSuspend` for implementation details.**

### When to Delete Auto-Suspend

**Automatic cleanup:**
1. Workflow completes successfully (Documentor commits)
2. User runs manual `@suspend` (manual suspend replaces auto-suspend)
3. Retrospective cleanup (delete all auto-suspend files)

**Keep auto-suspend when:**
- Tab accidentally closed (enables resume)
- Side trip paused (can resume later)
- Workflow still active

---

## Resume from Auto-Suspend

**When performing auto-suspend operations, process `@_autoSuspend` for resume patterns.**

---

## File Locations

- `.amazonq/suspended/auto-[profile]-[subject]-[workflowId].md` - Auto-suspend files
- `.amazonq/suspended/auto-[profile]-[subject]-[workflowId].tmp` - Temp files during write
- `.amazonq/suspended/INDEX.md` - Lists manual and auto-suspend contexts
- `.amazonq/workflow.log` - Source of events for auto-suspend updates
