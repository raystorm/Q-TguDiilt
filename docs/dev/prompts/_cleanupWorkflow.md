# @_cleanupWorkflow Prompt

## Purpose

Provides implementation details for end-of-workflow cleanup operations.

Deletes workflow.log, cleans work/current/ directory, and removes all
auto-suspend files when workflow or story cycle completes.

## When Profiles Load This

- **Retrospective** - When user chooses "Done (proceed to cleanup)"
- **End of story** - After commit, before next story
- **Workflow reset** - Preparing for next workflow cycle

## When to Use

Load this prompt when:
- Retrospective user chooses "Done (proceed to cleanup)"
- End of workflow/story cycle
- Need to reset workflow state for next story

## What It Contains

**Operations:**
- Delete workflow.log
- Delete work/current/ files (with HANDOFF.md exceptions)
- Delete all auto-suspend files (calls `@_cleanupAutoSuspend`)

**Error Handling:**
- Graceful degradation patterns
- Never fail on cleanup errors

**Verification:**
- Checklist for cleanup completion
- HANDOFF.md exception handling

## Usage Pattern

In rules files:
```markdown
**When performing cleanup operations, load `@_cleanupWorkflow` for
implementation details.**
```

## Usage Examples

### Example 1: Retrospective Cleanup

```typescript
// User chooses "Done (proceed to cleanup)"
// Retrospective performs full workflow cleanup

// 1. Delete workflow.log
fsWrite({ command: 'delete', path: '.amazonq/workflow.log' });

// 2. Clean work/current/ (with exceptions)
cleanWorkCurrentDirectory();

// 3. Delete all auto-suspend files
const autoSuspendFiles = listDirectory('.amazonq/suspended/')
  .filter(f => f.startsWith('auto-') && f.endsWith('.md'));

autoSuspendFiles.forEach(file => {
  // Load @_cleanupAutoSuspend for each file
  deleteAutoSuspend(file);
  removeFromIndex(file);
  cleanupTempFiles(file);
});

// 4. Verify cleanup
console.log('Cleanup complete. Workflow session closed.');
```

### Example 2: Story Complete, Next Story Pending

```typescript
// Story complete, FEATURE.md has more stories
// Clean up current story artifacts, preserve FEATURE.md

// 1. Delete workflow.log
fsWrite({ command: 'delete', path: '.amazonq/workflow.log' });

// 2. Clean work/current/ (preserve HANDOFF.md if exists)
cleanWorkCurrentDirectory();

// 3. Delete auto-suspend files
cleanupAllAutoSuspend();

// FEATURE.md stays in .amazonq/work/ (not in work/current/)
```

### Example 3: HANDOFF.md Exception Handling

```typescript
// HANDOFF.md exists with listed files
const handoffContent = fsRead('.amazonq/work/current/HANDOFF.md');
// Contains: "Builder prompt: BUILDER-PROMPT.md"
// Contains: "Test scenarios: TEST-SCENARIOS.md"

const listedFiles = ['BUILDER-PROMPT.md', 'TEST-SCENARIOS.md'];

// Delete all except HANDOFF.md and listed files
const allFiles = ['HANDOFF.md', 'MESSAGE.md', 'BUILDER-PROMPT.md', 
                  'TEST-SCENARIOS.md', 'temp-analysis.md'];
const toDelete = ['MESSAGE.md', 'temp-analysis.md'];

toDelete.forEach(f => deleteFile(f));
// Preserves: HANDOFF.md, BUILDER-PROMPT.md, TEST-SCENARIOS.md
```

## Related Prompts

- **`@_cleanupAutoSuspend`** - Called for each auto-suspend file (atomic
  operation)
- **`@_cleanupFeature`** - Handles FEATURE.md cleanup (separate concern)
- **`@_cleanupSuspend`** - Handles manual suspend cleanup (different lifecycle)

## Files Referenced

- `.amazonq/workflow.log` - Workflow event log
- `.amazonq/work/current/` - Current workflow artifacts
- `.amazonq/suspended/auto-*.md` - Auto-suspend files
