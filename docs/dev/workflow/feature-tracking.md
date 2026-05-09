# FEATURE.md Tracking Reference

## Overview

FEATURE.md is a workflow artifact used to track multi-story features across their implementation lifecycle. It provides context persistence between stories and enables progress tracking.

**Location:** `.amazonq/work/FEATURE.md`

**When to use:** See `workflow/workflow-mechanics.md` - Multi-Story Feature Tracking section

---

## FEATURE.md Format

### File Structure

```markdown
# Feature: [Feature Name]

## Goal
[High-level feature objective]

## Stories
- [ ] Story 1: [Title] - Not Started
- [ ] Story 2: [Title] - Not Started
- [ ] Story 3: [Title] - Not Started

## Current Story
**Story 1: [Title]**

Status: In Progress

## Analysis Artifacts

[Optional: Links to analysis documents in .amazonq/work/]

## Progress Notes
- [Date]: [Progress update]

## Story Dependencies

[Optional: Technical dependencies between stories]
```

### Field Descriptions

**Goal:**
- High-level feature objective
- What problem does this feature solve?
- Why is this work being done?

**Stories:**
- Checkbox list of all stories in feature
- Format: `- [ ] Story N: [Title] - [Status]`
- Status: Not Started, In Progress, Complete

**Current Story:**
- Which story is actively being worked on
- Includes story number, title, and status
- Updated by Documentor after each story completion

**Analysis Artifacts:**
- Optional section for analysis documents
- Links to files in `.amazonq/work/`
- Preserved across workflow cleanup
- Provides context for all stories

**Progress Notes:**
- Chronological log of story completions
- Date + brief summary of what was completed
- Decisions or context for next story
- Added by Documentor after each story

**Story Dependencies:**
- Optional section for technical dependencies
- Explains why stories must be done in specific order
- Helps Planner and Tactician understand sequencing

---

## Update Patterns

### After Story Completion (Documentor)

When a story completes, Documentor updates FEATURE.md:

**1. Mark completed story:**
```markdown
## Stories
- [x] Story 1: Add guards to schema - Complete
- [ ] Story 2: Wire guards to resolvers - In Progress
- [ ] Story 3: Add frontend integration - Not Started
```

**2. Update Current Story section:**
```markdown
## Current Story
**Story 2: Wire guards to resolvers**

Status: In Progress
```

**3. Add progress note:**
```markdown
## Progress Notes
- 2025-01-27: Story 1 complete - guards added to schema, tests passing
- 2025-01-27: Starting Story 2 - wiring guards to resolvers
```

### Between Stories

After Documentor updates FEATURE.md and user commits:
1. User triggers: `@handoff next=Planner`
2. Planner reads FEATURE.md
3. Planner sees current story status
4. Planner writes next story or escalates if needed

### After Feature Complete

After all stories complete:
1. Retrospective cleans up FEATURE.md during workflow cleanup
2. FEATURE.md is deleted (work complete)
3. Analysis artifacts remain in `.amazonq/work/` (preserved)

---

## Example FEATURE.md Content

### Multi-Story Feature Example

```markdown
# Feature: Document Schema Migration

## Goal
Migrate Document domain from flat structure to nested Content/Summary structure with proper type safety and RSF integration.

## Stories
- [x] Story 1: Add Content Interface and nested Summary - Complete
- [ ] Story 2: Rename DocumentDetails to Document - In Progress
- [ ] Story 3: Migrate to RSF with guarded mutations - Not Started

## Current Story
**Story 2: Rename DocumentDetails to Document**

Status: In Progress

## Analysis Artifacts

**Preserved in `.amazonq/work/` for all stories:**
- `document-migration-analysis.md` - Authoritative analysis from Architect
  - Impact analysis for type structure changes
  - Change classification (structure, rename, cross-domain)
  - Phase splitting recommendations
  - Validation strategy per change type

**All stories should reference this file for detailed findings.**

## Progress Notes
- 2025-01-27: Feature created by Planner based on Architect analysis
- 2025-01-27: Story 1 complete - Content Interface added, nested Summary implemented, tests passing
- 2025-01-27: Starting Story 2 - renaming DocumentDetails to Document

## Story Dependencies

**Phase 1: Type Structure (Story 1)**
- Must be done first
- Establishes nested Content/Summary structure
- Frontend and backend must align on structure

**Phase 2: Rename (Story 2)**
- Depends on Story 1 (structure must exist first)
- Updates all references to use new name
- Affects multiple domains

**Phase 3: RSF Migration (Story 3)**
- Depends on Stories 1 and 2 (structure and naming must be stable)
- Switches to guarded mutations
- Updates saga patterns
```

### Story Status Progression

**Initial state (Planner creates FEATURE.md):**
```markdown
## Stories
- [ ] Story 1: Add Content Interface - In Progress
- [ ] Story 2: Rename DocumentDetails - Not Started
- [ ] Story 3: Migrate to RSF - Not Started

## Current Story
**Story 1: Add Content Interface**

Status: In Progress
```

**After Story 1 complete (Documentor updates):**
```markdown
## Stories
- [x] Story 1: Add Content Interface - Complete
- [ ] Story 2: Rename DocumentDetails - In Progress
- [ ] Story 3: Migrate to RSF - Not Started

## Current Story
**Story 2: Rename DocumentDetails**

Status: In Progress

## Progress Notes
- 2025-01-27: Story 1 complete - Content Interface added, tests passing
```

**After Story 2 complete (Documentor updates):**
```markdown
## Stories
- [x] Story 1: Add Content Interface - Complete
- [x] Story 2: Rename DocumentDetails - Complete
- [ ] Story 3: Migrate to RSF - In Progress

## Current Story
**Story 3: Migrate to RSF**

Status: In Progress

## Progress Notes
- 2025-01-27: Story 1 complete - Content Interface added, tests passing
- 2025-01-28: Story 2 complete - DocumentDetails renamed to Document, all references updated
```

---

## Workflow Lifecycle

### Creation (Planner)

**When:** Feature requires multiple related stories (2+)

**Steps:**
1. Planner breaks down feature into stories
2. Planner creates `.amazonq/work/FEATURE.md`
3. Planner lists all stories
4. Planner marks Story 1 as "In Progress"
5. Planner adds feature overview and context
6. Planner hands off to TestDesigner (or Tactician if complex sequencing)

**Example:**
```markdown
# Feature: Add Authorization Guards

## Goal
Implement authorization guards for all mutations to enforce permission checks.

## Stories
- [ ] Story 1: Add guards to schema - In Progress
- [ ] Story 2: Wire guards to resolvers - Not Started
- [ ] Story 3: Add frontend integration - Not Started

## Current Story
**Story 1: Add guards to schema**

Status: In Progress
```

### Updates (Documentor)

**When:** After each story completion

**Steps:**
1. Documentor reads FEATURE.md
2. Documentor marks completed story as "Complete"
3. Documentor marks next story as "In Progress"
4. Documentor updates "Current Story" section
5. Documentor adds progress note with date and summary

**Trigger:** After user commits story changes

### Cleanup (Retrospective)

**When:** After all stories complete or feature abandoned

**Steps:**
1. Retrospective checks FEATURE.md status
2. If all stories complete: Delete FEATURE.md
3. If feature abandoned: Archive or delete based on user preference
4. Analysis artifacts remain in `.amazonq/work/` (not deleted)

**Trigger:** User chooses "Done (proceed to cleanup)" in Retrospective menu

---

## FEATURE.md vs Suspended Contexts

### Use FEATURE.md When:
- Linear story progression
- All stories known upfront
- Simple tracking needed
- Stories will be completed in sequence
- Context is straightforward (story list + progress)

### Use @suspend When:
- Need to pause and work on unrelated tasks
- Complex context needs preservation
- Uncertain when work will resume
- Need to capture decisions, state, helper files
- Work may be blocked or abandoned

### Key Differences

**FEATURE.md:**
- Tracks story progression
- Updated by Documentor between stories
- Deleted after feature complete
- Simple format (stories + progress)

**Suspended Context:**
- Captures full workflow state
- Created by any profile with @suspend
- Preserved until explicitly resumed or deleted
- Rich format (decisions, state, helper files, resume instructions)

---

## Profile Responsibilities

### Planner
- Creates FEATURE.md for multi-story features
- Lists all stories
- Marks Story 1 as "In Progress"
- Adds feature overview and context

### Documentor
- Updates FEATURE.md after each story completion
- Marks completed story as "Complete"
- Marks next story as "In Progress"
- Updates "Current Story" section
- Adds progress notes

### Retrospective
- Cleans up FEATURE.md after feature complete
- Deletes FEATURE.md during workflow cleanup
- Preserves analysis artifacts in `.amazonq/work/`

### Other Profiles
- Read FEATURE.md to understand feature context
- Reference current story when making decisions
- Note dependencies from other stories
- Do NOT modify FEATURE.md (only Planner and Documentor)

---

## Best Practices

### Story Titles
- Clear and concise
- Action-oriented (Add, Update, Migrate, Remove)
- Specific enough to understand scope
- Example: "Add Content Interface and nested Summary"

### Progress Notes
- Include date
- Brief summary of what was completed
- Any decisions made
- Context for next story
- Keep concise (1-2 sentences)

### Analysis Artifacts
- Link to analysis documents in `.amazonq/work/`
- Explain what analysis contains
- Note that artifacts survive workflow cleanup
- Encourage stories to reference analysis

### Story Dependencies
- Explain technical dependencies
- Clarify why order matters
- Help future profiles understand sequencing
- Keep brief (bullet points)

---

## Common Patterns

### Phase-Based Features
```markdown
## Story Dependencies

**Phase 1: Foundation (Stories 1-2)**
- Story 1: Create base structure
- Story 2: Add core functionality

**Phase 2: Integration (Stories 3-4)**
- Story 3: Wire to backend (depends on Phase 1)
- Story 4: Add frontend (depends on Phase 1)

**Phase 3: Polish (Story 5)**
- Story 5: Add tests and docs (depends on all previous)
```

### Cross-Domain Features
```markdown
## Stories
- [ ] Story 1: Update backend schema - In Progress
- [ ] Story 2: Update Lambda functions - Not Started
- [ ] Story 3: Update frontend types - Not Started
- [ ] Story 4: Update UI components - Not Started

## Story Dependencies
- Story 2 depends on Story 1 (schema must exist first)
- Story 3 depends on Story 1 (types generated from schema)
- Story 4 depends on Story 3 (components use types)
```

### Refactoring Features
```markdown
## Stories
- [ ] Story 1: Extract shared logic - In Progress
- [ ] Story 2: Update Domain A - Not Started
- [ ] Story 3: Update Domain B - Not Started
- [ ] Story 4: Remove old code - Not Started

## Story Dependencies
- Stories 2-3 depend on Story 1 (shared logic must exist)
- Story 4 depends on Stories 2-3 (all domains migrated)
```

---

## Related Documentation

- `workflow/workflow-mechanics.md` - FEATURE.md format and decision criteria
- `profiles/planner.md` - FEATURE.md creation steps
- `profiles/documentor.md` - FEATURE.md update steps
- `profiles/retrospective.md` - FEATURE.md cleanup steps
- `docs/dev/workflow/workflow-examples.md` - Complete workflow examples
- `@_troubleshootFeatureTracking` - Troubleshooting FEATURE.md issues
