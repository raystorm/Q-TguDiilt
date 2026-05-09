# @_cleanupSuspend Prompt

## Purpose

Provides implementation details for manual suspend context cleanup.

Deletes manual suspend files, removes INDEX.md entries, and cleans up helper
files when suspended work is abandoned or completed.

## When Profiles Load This

- **User** - When explicitly abandoning or completing suspended work
- **Manual cleanup** - Removing old/stale suspend contexts

## When to Use

Load this prompt when:
- User explicitly abandons suspended work
- User completes suspended work
- Manual cleanup of old suspend contexts
- Suspend context no longer needed

## What It Contains

**Operations:**
- Delete manual suspend file
- Remove entry from INDEX.md
- Clean up helper files referenced in suspend context

**Error Handling:**
- Graceful degradation patterns
- Never fail on cleanup errors

**Verification:**
- Checklist for cleanup completion

## Usage Pattern

In rules files:
```markdown
**When performing suspend cleanup operations, load `@_cleanupSuspend` for
implementation details.**
```

## Usage Examples

### Example 1: Delete Completed Suspend

```typescript
// User completed suspended work, no longer needed
const suspendFile = 
  '.amazonq/suspended/architect-document-migration.md';

// 1. Delete suspend file
fsWrite({ command: 'delete', path: suspendFile });

// 2. Remove from INDEX.md
removeFromIndex('architect-document-migration');

// 3. Clean up helper files
const helperFiles = [
  '.amazonq/work/document-migration-analysis.md',
  '.amazonq/work/impact-assessment.md'
];
helperFiles.forEach(f => deleteFile(f));

console.log('Suspend context cleaned up - work complete');
```

### Example 2: Abandon Stale Context

```typescript
// Old suspend context, work abandoned
const suspendFile = '.amazonq/suspended/old-analysis.md';

// 1. Delete suspend file
fsWrite({ command: 'delete', path: suspendFile });

// 2. Remove from INDEX.md
removeFromIndex('old-analysis');

// 3. Delete helper files
cleanupHelperFiles(suspendFile);

console.log('Stale suspend context deleted');
```

## Helper File Patterns

Manual suspend contexts may reference:
- Analysis documents (`.amazonq/work/*-analysis.md`)
- Decision logs (`.amazonq/work/decision-log.md`)
- Temporary artifacts (`.amazonq/work/temp-*.md`)
- Work-in-progress files

**Extraction pattern:**
```typescript
// Read suspend context
const suspendContent = fsRead(suspendPath);

// Look for file paths in content
// Common patterns:
// - "Helper Files: .amazonq/work/analysis.md"
// - "See: .amazonq/work/decisions.md"
// - Referenced in markdown links: [analysis](.amazonq/work/analysis.md)

const helperFiles = extractFilePaths(suspendContent);
```

## Related Prompts

- **`@_cleanupAutoSuspend`** - Handles auto-suspend cleanup (different
  lifecycle)
- **`@_cleanupWorkflow`** - Handles workflow cleanup (doesn't touch manual
  suspends)

## Files Referenced

- `.amazonq/suspended/[profile]-[subject].md` - Manual suspend files
- `.amazonq/suspended/INDEX.md` - Lists suspend contexts
- `.amazonq/work/*` - Helper files referenced in suspend contexts
