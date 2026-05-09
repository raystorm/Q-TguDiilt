# Auto-Suspend Prompt Documentation

## Purpose

The `@_autoSuspend` prompt provides implementation patterns for auto-suspend functionality.

Auto-suspend creates lightweight checkpoint files that update automatically on workflow events,
enabling recovery from accidental tab closure.

## When to Use

Load this prompt when:
- Implementing auto-suspend file creation
- Implementing auto-suspend updates
- Implementing atomic write strategy
- Implementing error handling for auto-suspend
- Need file format template
- Need key context update patterns
- Need INDEX.md operations

## What It Contains

The prompt provides:
- Atomic write strategy (temp file → rename)
- Error handling implementation
- Auto-suspend file format template
- Key context update patterns (files modified, handoffs, validation, blockers)
- INDEX.md operations (add/remove entries)

## What It Does NOT Contain

- Resume patterns (different operation - in rules)
- Side trip support (just normal behavior - in rules)
- Cleanup patterns (different operation - see cleanup prompts)
- Purpose/rationale (in this doc)
- Examples (in reference docs)

## Why Atomic Writes

Atomic writes prevent corruption:
- If write fails mid-operation, temp file is corrupted (not the real file)
- Original `.md` file remains intact and valid
- User can still resume from last successful checkpoint
- Rename is atomic on most filesystems
- Graceful degradation on errors

## Related Files

- **Rule:** `.workflow/rules/workflow/auto-suspend.md` - MANDATORY requirements and core specifications
- **Prompt:** `.amazonq/prompts/_autoSuspend.md` - Implementation patterns (load on-demand)
- **Reference:** `docs/dev/workflow/auto-suspend-implementation.md` - Detailed reference with examples
- **Cleanup:** Future cleanup prompts will handle auto-suspend deletion
