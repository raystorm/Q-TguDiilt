# @_cleanupFeature Prompt

## Purpose

Provides implementation details for FEATURE.md cleanup when all stories in a
multi-story feature are complete.

Checks story completion status and conditionally deletes FEATURE.md only when
all stories are marked complete.

## When Profiles Load This

- **Retrospective** - During cleanup, checks if feature complete
- **Feature completion** - After last story in multi-story feature

## When to Use

Load this prompt when:
- Retrospective cleanup triggered
- FEATURE.md exists
- Need to check if feature is complete

## What It Contains

**Operations:**
- Check if FEATURE.md exists
- Verify all stories complete
- Conditional deletion logic

**Error Handling:**
- Graceful degradation patterns
- Never delete FEATURE.md with incomplete stories

**Verification:**
- Checklist for cleanup completion
- Story completion patterns

## Usage Pattern

In rules files:
```markdown
**When performing cleanup operations, load `@_cleanupFeature` for
implementation details.**
```

## Usage Examples

### Example 1: All Stories Complete

```typescript
// Retrospective cleanup, all stories done
const featureContent = fsRead('.amazonq/work/FEATURE.md');

// Parse stories
const stories = parseStories(featureContent);
// [
//   { number: 1, status: 'Complete', checked: true },
//   { number: 2, status: 'Complete', checked: true },
//   { number: 3, status: 'Complete', checked: true }
// ]

const allComplete = stories.every(s => 
  s.status === 'Complete' && s.checked
);
// true

// Delete FEATURE.md
fsWrite({ command: 'delete', path: '.amazonq/work/FEATURE.md' });
console.log('FEATURE.md deleted - all 3 stories complete');
```

### Example 2: Stories Incomplete

```typescript
// Retrospective cleanup, more stories remain
const featureContent = fsRead('.amazonq/work/FEATURE.md');

// Parse stories
const stories = parseStories(featureContent);
// [
//   { number: 1, status: 'Complete', checked: true },
//   { number: 2, status: 'In Progress', checked: false },
//   { number: 3, status: 'Not Started', checked: false }
// ]

const allComplete = stories.every(s => 
  s.status === 'Complete' && s.checked
);
// false

// Keep FEATURE.md
console.log('FEATURE.md preserved - Story 2 in progress, ' +
            'Story 3 not started');
```

### Example 3: No FEATURE.md

```typescript
// Single-story feature, no FEATURE.md
const featureExists = checkFileExists('.amazonq/work/FEATURE.md');
// false

console.log('No FEATURE.md found, skipping feature cleanup');
```

## Story Completion Patterns

### Complete Story Indicators

```markdown
- [x] Story 1: Add guards to schema - Complete
- [x] Story 2: Wire guards to resolvers - Complete
```

**Patterns:**
- Checkbox marked: `[x]`
- Status: `Complete`
- Progress notes show completion date

### Incomplete Story Indicators

```markdown
- [ ] Story 3: Add frontend integration - In Progress
- [ ] Story 4: Add tests - Not Started
```

**Patterns:**
- Checkbox unmarked: `[ ]`
- Status: `In Progress`, `Not Started`, `Blocked`
- No completion date in progress notes

## Related Prompts

- **`@_cleanupWorkflow`** - Handles workflow.log and work/current/ cleanup
  (separate concern)
- **`@_cleanupAutoSuspend`** - Handles auto-suspend cleanup (called by
  cleanupWorkflow)

## Files Referenced

- `.amazonq/work/FEATURE.md` - Multi-story feature tracker
