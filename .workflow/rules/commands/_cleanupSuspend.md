When command `@_cleanupSuspend` is received then process the following manual suspend context cleanup operations.

# Manual Suspend Context Cleanup

## Operations

### 1. Delete Manual Suspend File

```bash
# Pattern: [profile]-[subject].md (user-defined name)
rm .amazonq/suspended/architect-document-migration.md
```

### 2. Remove Entry from INDEX.md

Find line containing the suspend filename and delete entire line.

Example line to remove:
```markdown
- **architect-document-migration** - Architect: Analyze Document domain - 2025-01-27 - active
```

Preserve other INDEX.md content.

### 3. Clean Up Helper Files

Manual suspend contexts may reference helper files:
- Analysis documents
- Decision logs
- Temporary artifacts
- Work-in-progress files

**Steps:**
1. Read suspend context file
2. Extract referenced helper files (look for file paths)
3. Delete helper files
4. Verify no orphaned files remain

## Error Handling

Graceful degradation:
- If suspend file doesn't exist: Log and continue
- If INDEX.md entry not found: Log and continue
- If helper files don't exist: Skip silently
- Never fail on cleanup errors

```typescript
try {
  fsWrite({ command: 'delete', path: suspendPath });
} catch (error) {
  console.log(`Suspend file not found: ${suspendPath}`);
}
```

## Verification

- [ ] Suspend file deleted
- [ ] INDEX.md entry removed
- [ ] Helper files cleaned up
- [ ] No orphaned artifacts remain

## Helper File Cleanup

```typescript
// Read suspend context
const suspendContent = fsRead(suspendPath);

// Extract helper files
const helperFiles = extractHelperFiles(suspendContent);
// [
//   '.amazonq/work/document-migration-analysis.md',
//   '.amazonq/work/impact-assessment.md'
// ]

// Delete each helper file
helperFiles.forEach(file => {
  try {
    fsWrite({ command: 'delete', path: file });
  } catch (error) {
    console.log(`Helper file not found: ${file}`);
  }
});
```
