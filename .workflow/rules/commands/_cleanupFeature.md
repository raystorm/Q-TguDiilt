When command `@_cleanupFeature` is received then process the following feature completion cleanup operations.

# Feature Completion Cleanup

## Operations

### 1. Check if FEATURE.md Exists

```bash
ls .amazonq/work/FEATURE.md
```

If doesn't exist: Skip cleanup, no action needed.

### 2. Verify All Stories Complete

```typescript
// Read FEATURE.md
const featureContent = fsRead('.amazonq/work/FEATURE.md');

// Check if all stories marked complete
// Look for:
// - [x] Story 1: ... - Complete
// - [ ] Story 2: ... - In Progress
```

**Complete story indicators:**
- Checkbox marked: `[x]`
- Status: `Complete`
- Progress notes show completion date

**Incomplete story indicators:**
- Checkbox unmarked: `[ ]`
- Status: `In Progress`, `Not Started`, `Blocked`
- No completion date

### 3. Delete FEATURE.md (Only if All Complete)

```bash
# Only delete if all stories complete
rm .amazonq/work/FEATURE.md
```

**Do NOT delete if:**
- Any story marked incomplete
- Any story marked "In Progress"
- Any story marked "Not Started"
- Uncertain about completion status

## Error Handling

Graceful degradation:
- If FEATURE.md doesn't exist: Skip silently
- If can't parse stories: Ask user before deleting
- If uncertain about completion: Keep FEATURE.md
- Never delete FEATURE.md with incomplete stories

```typescript
try {
  const featureExists = checkFileExists('.amazonq/work/FEATURE.md');
  if (!featureExists) {
    console.log('No FEATURE.md found, skipping');
    return;
  }

  const allComplete = checkAllStoriesComplete();
  if (allComplete) {
    fsWrite({ command: 'delete', path: '.amazonq/work/FEATURE.md' });
    console.log('FEATURE.md deleted - all stories complete');
  } else {
    console.log('FEATURE.md preserved - stories incomplete');
  }
} catch (error) {
  console.log('Error checking FEATURE.md, preserving file');
}
```

## Verification

- [ ] If all stories complete: FEATURE.md deleted
- [ ] If stories incomplete: FEATURE.md preserved
- [ ] Decision logged (deleted or preserved)
