# Auto-Suspend - Purpose and Benefits

## Purpose

Enable recovery from accidental tab closure by automatically maintaining current workflow state in background.

## Overview

Auto-suspend creates lightweight checkpoint files that update automatically, on stable workflow events like `handoff_sent`. If user accidentally closes a tab, they can resume from the last state.

## Benefits

**Prevents context loss:**
- Accidental tab closure recoverable
- Always have last 5 events
- Key context preserved

**Low friction:**
- Automatic, no user action required
- Lightweight (last 5 events only)
- Doesn't interfere with manual suspends

**Robust:**
- Atomic writes prevent corruption
- Graceful degradation on errors
- Workflow continues even if auto-suspend fails

**Hygiene:**
- Auto-cleanup on completion
- Separate from manual suspends
- Clear naming convention
- Temp files cleaned up
