# Large-Scale Rename Prompt Documentation

## Purpose

The `@_rename` prompt provides comprehensive patterns
for large-scale rename operations across the codebase.

Large-scale renames affect multiple domains, file types, and layers
(backend schema, guards, Lambda functions, frontend domains, tests).

## When to Use

Load this prompt when:
- Implementing type renames across codebase (e.g., MyBox → Box)
- Implementing field renames across domains (e.g., MyBoxOwnerId → boxOwnerId)
- Need reference search patterns
- Need scope identification guidance
- Need implementation order guidance
- Need verification patterns

## What It Contains

The prompt provides:
- Initial reference search command (grep pattern)
- What to search (type names, field names, variations, function names)
- Where to search (source code, tests)
- What to exclude (libraries, generated code)
- Scope identification steps
- Implementation order (source → tests)
- Verification command (grep to check for remaining references)

## What It Does NOT Contain

- Purpose/rationale (in this doc)
- Why reference search first (in this doc)
- Examples of rename operations (in reference docs if needed)

## Why Reference Search First

Reference search identifies full scope before implementation:
- Prevents missing references
- Identifies all affected areas (backend, frontend, Lambda functions)
- Enables accurate scope reporting to user
- Reduces rework and fixes

## Search Scope

**What to search:**
- Type names (e.g., "MyBox")
- Field names (e.g., "MyBoxOwnerId", "boxBoxId")
- Related variations (e.g., "createdBoxId")
- Function names (e.g., "createBox", "getBox")

**Where to search:**
- source code
- tests
- mock data

**Exclude:**
- Dependencies and Libraries
- Generated code (will be regenerated)

## Related Files

- **Rule:** `.workflow/rules/profiles/builder.md` - References this prompt for large-scale renames
- **Prompt:** `.workflow/rules/commands/_rename.md` - Implementation patterns (load on-demand)
