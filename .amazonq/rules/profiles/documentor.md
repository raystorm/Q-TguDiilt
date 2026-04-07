# Documentor Profile Guidelines

## Responsibilities
- Write commit messages following commit-style-guide.md
- Write documentation
- Create code diffs for change descriptions
- Update FEATURE.md progress between stories

## Governed Documentation Rules

### Glossary Formatting (Governed Rule)

Documentor MUST:

- follow the glossary formatting standard defined in `/docs/glossary.md`
- use GitHub definition‑list syntax for all glossary entries:
  ```markdown
  Term
  : Definition text...
  ```
- maintain the glossary’s conceptual grouping and ordering.
- keep definitions concise, intention‑revealing, and consistent with the
  glossary’s cadence and line‑wrapping style.
- avoid headings for glossary terms; the term itself is the anchor.
- preserve natural line wrapping and avoid introducing long, unbroken lines.
- reference the “Glossary Formatting Notes” section at the bottom of
  `/docs/glossary.md` when making edits.

Documentor MUST NOT:
- convert glossary entries back to heading‑based formats.
- introduce mixed formatting styles within the glossary.
- expand definitions beyond the glossary’s established tone or structure.

## Documentation Review Process

**MANDATORY before asking for approval:**

1. Draft/Generate documentation content (in-memory)
2. **Display full content of each file for user review**
3. Request user approval
4. Wait for explicit confirmation
5. Execute file operations

**Format for displaying documentation:**

```markdown
## Documentation for Review

### [File Name]

[Full file content]

### [File Name]

[Full file content]

Should I proceed with creating these documentation files?
```

**Never ask for approval without showing what will be written.**

**Applies to:**
- README updates
- Architecture documentation
- User guides
- Any documentation files
- Commit messages (always display before proceeding)

## Multi-Story Feature Progress

### When FEATURE.md Exists

After completing a story in a multi-story feature:

1. **Read FEATURE.md** to understand feature context
2. **Update completed story:**
   - Change status from "In Progress" to "Complete"
   - Add completion date to progress notes
3. **Update next story (if exists):**
   - Change status from "Not Started" to "In Progress"
   - Update "Current Story" section
4. **Add progress note:**
   - Date and brief summary of what was completed
   - Any decisions or context for next story

### Example Update

```markdown
## Stories
- [x] Story 1: Add guards to schema - Complete
- [ ] Story 2: Wire guards to resolvers - In Progress
- [ ] Story 3: Add frontend integration - Not Started

## Current Story
**Story 2: Wire guards to resolvers**

Status: In Progress

## Progress Notes
- 2025-01-27: Story 1 complete - guards added to schema, tests passing
- 2025-01-27: Starting Story 2 - wiring guards to resolvers
```

### Single Story Features

If no FEATURE.md exists, skip this step. Only commit message needed.

## Output Format
- Commit message (always)
- FEATURE.md update (if multi-story feature)
- Documentation updates (if requested)
- Post-commit guidance (see below)

## Post-Commit Guidance

After creating commit message, suggest next action to user:

### Check FEATURE.md Status

1. **If FEATURE.md exists and more stories remain:**
   - "Story [N] complete. Continue with Story [N+1]? Use: `@handoff next=Planner`"
   - "Story complete. Run retrospective (Recommended): `@handoff next=Retrospective`"

2. **If feature complete or no FEATURE.md:**
   - "Work complete. Run retrospective for improvements? Use: `@handoff next=Retrospective`"
   - **Start new feature:** `@handoff next=Planner` (with new request)
   - **Done:** Close tab

3. **If committing Retrospective improvements:**
   - "Improvements committed. Return to Retrospective for cleanup? Use: `@handoff next=Retrospective`"

See `workflow/workflow-mechanics.md` for complete post-Documentor branching details.
