# @_cleanupAutoSuspend Prompt

## Purpose

Provides implementation details for auto-suspend lifecycle cleanup operations.

Deletes auto-suspend files, removes INDEX.md entries, and cleans up orphaned
temp files when auto-suspend lifecycle ends.

## When Profiles Load This

- **Retrospective** - During end-of-workflow cleanup
- **Any profile** - When auto-suspend file needs deletion after workflow
  completion
- **Workflow completion** - After Documentor commits
- **Manual suspend** - When `@suspend` replaces auto-suspend

## When to Use

Load this prompt when:
- Workflow completes successfully (Documentor commits)
- User runs manual `@suspend` (replaces auto-suspend)
- Retrospective performs end-of-workflow cleanup
- Auto-suspend file needs deletion

## What It Contains

**Operations:**
- Delete auto-suspend file (`auto-*.md`)
- Remove entry from INDEX.md
- Clean up orphaned temp files (`auto-*.tmp`)

**Error Handling:**
- Graceful degradation patterns
- Never fail workflow on cleanup errors

**Verification:**
- Checklist for cleanup completion

## Usage Pattern

In rules files:
```markdown
**When performing auto-suspend cleanup operations, load
`@_cleanupAutoSuspend` for implementation details.**
```

## Usage Examples

### Example 1: Workflow Completion

```typescript
// Documentor commits, workflow complete
// Clean up auto-suspend for current workflowId
const workflowId = 'wf-1738282800000';
const autoSuspendFile = 
  `.amazonq/suspended/auto-builder-story-4-5-${workflowId}.md`;

// Delete file
fsWrite({ command: 'delete', path: autoSuspendFile });

// Remove from INDEX.md
// (read INDEX.md, filter out line, write back)
```

### Example 2: Manual Suspend Replaces Auto-Suspend

```typescript
// User runs @suspend, manual suspend replaces auto-suspend
// Delete auto-suspend for current workflowId
const workflowId = getCurrentWorkflowId();
const autoSuspendFile = findAutoSuspendFile(workflowId);

// Clean up
deleteAutoSuspend(autoSuspendFile);
removeFromIndex(autoSuspendFile);
cleanupTempFiles(workflowId);
```

### Example 3: Side Trip Cleanup

```typescript
// Side trip complete, clean up side trip auto-suspend only
const sideTripWorkflowId = 'wf-002';
const sideTripFile = 
  `.amazonq/suspended/auto-enforcer-validation-${sideTripWorkflowId}.md`;

// Delete side trip auto-suspend
fsWrite({ command: 'delete', path: sideTripFile });

// Remove indented INDEX.md entry
// Parent auto-suspend remains
```

## Side Trip Handling

When cleaning up side trip auto-suspend:
- Delete only the side trip auto-suspend file
- Remove only the indented INDEX.md entry
- Preserve parent auto-suspend file and entry

**Example:**

Before:
```markdown
- **auto-builder-story-1-wf001** - Builder: Implement Story 1
  - **auto-enforcer-validation-wf002** - Enforcer: Validate (side trip)
```

After (side trip cleaned):
```markdown
- **auto-builder-story-1-wf001** - Builder: Implement Story 1
```

## Related Prompts

- **`@_autoSuspend`** - Creates and updates auto-suspend files (lifecycle
  management)
- **`@_cleanupWorkflow`** - Calls this prompt during full workflow cleanup
  (orchestration)
- **`@_cleanupSuspend`** - Handles manual suspend cleanup (different lifecycle)

## Files Referenced

- `.amazonq/suspended/auto-*.md` - Auto-suspend files
- `.amazonq/suspended/auto-*.tmp` - Temp files during write
- `.amazonq/suspended/INDEX.md` - Lists auto-suspend contexts
