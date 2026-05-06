# Commit Message Standards

## Project-Specific Extensions

Projects adopting Q‑TguDiilt should place stack-specific examples in:

```
.workflow/rules/communication/commit-messages-project.md
```

Examples may include:
- What to write for commit messages
- How to format/write commit messages
- How to link commits to stories/issues

---

## Critical Rule
- ALWAYS follow the commit style guide in `docs/dev/commit-style-guide.md`
- Use plain language, imperative headers, and semantic bullets
- Order bullets by importance (production logic, tests, docs, formatting)
- Group related changes conceptually
- Wrap file names and code objects in backticks
- Use domain vocabulary consistently
- All commit messages MUST be concise and distilled

## Bullet System
- `+` Added
- `*` Changed/Updated/Improved
- `-` Removed

## Bullet Semantic Integrity
- `+` bullets MUST use additive language (added, new, created, introduced)
- `-` bullets MUST use subtractive language (removed, deleted, dropped)
- `*` bullets for changes that aren't pure additions or removals

## Examples

### Verbose vs Concise

**❌ Too verbose (lists implementation details):**
```
  + added Return Type Specification to TestDesigner Output Format
    * conditional guidance: only when scenario depends on structure
    * Gherkin example format with property paths
```

**✅ Concise (distills to essential change):**
```
  + added return type specification to TestDesigner (conditional on scenario needs)
```

### Semantic Bullet Integrity

**`+` bullets MUST use additive language:**

**❌ Wrong (not additive):**
```
  + TestDesigner specifies return type structure when scenario depends on it
```

**✅ Correct (additive language):**
```
  + added return type specification to TestDesigner (conditional on scenario needs)
```

**Additive language:**
- ✅ added, new, created, introduced
- ❌ specifies, validates, checks (not additive)

**`-` bullets MUST use subtractive language:**

**❌ Wrong (not subtractive):**
```
  - validation no longer checks for empty fields
```

**✅ Correct (subtractive language):**
```
  - removed empty field validation
```

**Subtractive language:**
- ✅ removed, deleted, dropped
- ❌ no longer uses, stops checking (not subtractive)

**`*` bullets for changes:**
- ✅ changed, updated, improved, modified
- ❌ added (use `+` instead), removed (use `-` instead)

## Renames
- Use arrow syntax (`->`) for renames in summary line and bullets
- Example summary: `oldName -> newName for consistency`
- Example bullet: `* AlertMessage -> AlertView`

## Handoff Context vs Commit Style
- Handoffs may contain detailed implementation notes for context
- Documentor must distill handoff details into concise commit format
- Group enumerated items conceptually (don't list all 8 actions, say "added Success/Failure actions")
- Ignore implementation details that don't belong in commit history (like specific helper function names)
- Focus on what changed and why, not how it was implemented

## Example Format
```
Add searchRunner Lambda with OpenSearch integration

  + new `searchRunner` Lambda queries OpenSearch with permission filtering
    * admin users search all boxes, non-admin filtered to accessible boxes
    * updated field selection: keywords default, 'all' option, specific field
    + added pagination with limit/from/nextToken
    * uses relevance ranking by default, optional custom sort
  + added GSIs: byUser, byOwner, byBox, byEmail, byCollection
  + added `SearchResults` and `SearchResultItem` types in schema
  + added comprehensive tests with nested describe blocks
  * `ingest-trigger` -> `ingestTrigger` for camelCase consistency
```
