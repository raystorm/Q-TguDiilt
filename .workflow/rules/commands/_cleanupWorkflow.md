When command `@_cleanupWorkflow` is received then process the following workflow cleanup operations.

# Workflow Cleanup Operations

## Operations

### 1. Delete workflow.log

```bash
rm .amazonq/workflow.log
```

### 2. Delete work/current/ Files

**Note:** Per-handoff cleanup of `work/current/` is governed by
`handoff.md`. This section cleans up the same location as part of
a full workflow reset.

```bash
# Delete all files in work/current/
rm .amazonq/work/current/*
```

**Exception:** Keep `HANDOFF.md` and files listed in it (if exists)

**Steps:**
1. Check if `HANDOFF.md` exists
2. If exists, read and extract listed files
3. Delete all files EXCEPT `HANDOFF.md` and listed files
4. If not exists, delete all files

Files typically deleted:
- `MESSAGE.md`
- `BUILDER-PROMPT.md`
- `TEST-SCENARIOS.md`
- `STORY-*.md`
- Analysis artifacts
- Temporary work files

### 3. Delete All Auto-Suspend Files

**Process `@_cleanupAutoSuspend` for each auto-suspend file.**

```bash
# Find all auto-suspend files
ls .amazonq/suspended/auto-*.md

# For each file, process @_cleanupAutoSuspend
```

Steps:
1. List all `auto-*.md` files in `.amazonq/suspended/`
2. For each file, process `@_cleanupAutoSuspend` operations
3. Verify all auto-suspend files removed

## Error Handling

Graceful degradation:
- If workflow.log doesn't exist: Log and continue
- If work/current/ empty: Skip silently
- If no auto-suspend files: Skip silently
- Never fail on cleanup errors

```typescript
try {
  fsWrite({ command: 'delete', path: '.amazonq/workflow.log' });
} catch (error) {
  console.log('workflow.log not found, skipping');
}
```

## Verification

- [ ] `.amazonq/workflow.log` deleted
- [ ] `.amazonq/work/current/` cleaned (except exceptions)
- [ ] All auto-suspend files deleted from `.amazonq/suspended/`
- [ ] All auto-suspend entries removed from INDEX.md
- [ ] No orphaned `.tmp` files remain

## HANDOFF.md Exception Handling

### When HANDOFF.md Exists

```typescript
// Read HANDOFF.md
const handoffContent = fsRead('.amazonq/work/current/HANDOFF.md');

// Extract listed files (look for file paths in content)
const listedFiles = extractFilePaths(handoffContent);

// Delete all files except HANDOFF.md and listed files
const allFiles = listDirectory('.amazonq/work/current/');
const filesToDelete = allFiles.filter(f => 
  f !== 'HANDOFF.md' && !listedFiles.includes(f)
);

filesToDelete.forEach(f => deleteFile(f));
```

### When HANDOFF.md Doesn't Exist

```typescript
// Delete all files in work/current/
const allFiles = listDirectory('.amazonq/work/current/');
allFiles.forEach(f => deleteFile(f));
```
