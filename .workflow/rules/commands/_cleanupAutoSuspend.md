When command `@_cleanupAutoSuspend` is received then process the following auto-suspend cleanup operations.

# Auto-Suspend Cleanup Operations

## Operations

### 1. Delete Auto-Suspend File

```bash
# Pattern: auto-[profile]-[subject]-[workflowId].md
rm .amazonq/suspended/auto-builder-story-1-wf001.md
```

### 2. Remove Entry from INDEX.md

Find line containing the auto-suspend filename and delete entire line (including indentation if present).

Example line to remove:
```markdown
- **auto-builder-story-1-wf001** - Builder: Implement Story 1 - 2025-01-27 22:40:00
```

Preserve other INDEX.md content.

### 3. Clean Up Orphaned Temp Files

```bash
# Pattern: auto-[profile]-[subject]-[workflowId].tmp
rm .amazonq/suspended/auto-*.tmp
```

Check for:
- Temp files matching the workflowId
- Orphaned temp files from failed writes
- Any `.tmp` files in `.amazonq/suspended/`

## Error Handling

Graceful degradation:
- If auto-suspend file doesn't exist: Log and continue
- If INDEX.md entry not found: Log and continue
- If temp files don't exist: Skip silently
- Never fail workflow on cleanup errors

```typescript
try {
  fsWrite({ command: 'delete', path: autoSuspendPath });
} catch (error) {
  console.log(`Auto-suspend file not found: ${autoSuspendPath}`);
}
```

## Verification

- [ ] Auto-suspend file deleted from `.amazonq/suspended/`
- [ ] INDEX.md entry removed
- [ ] No orphaned `.tmp` files remain
- [ ] Other auto-suspend files unaffected (if multiple exist)
