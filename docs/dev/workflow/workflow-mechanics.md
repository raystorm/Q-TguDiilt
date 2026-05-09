# Workflow Mechanics Rationale

## Purpose

This document explains the design decisions behind the workflow mechanics system.

### Centralized Workflow Mechanics

The workflow mechanics are defined in one central reference to:
- Provide single source of truth for Changeovers
- Clarify distinction between Standard Handoffs (Linear) and Side Trips (Parallel)
- Define Profile Completion rules before Changeover
- Establish Reviewable handoffs to prevent incomplete information
- Set standard workflow step expectations for all profiles

### Changeover Confirmation

Profiles must NOT auto-create Changeovers. User triggers Changeover creation with `@handoff` or `@send` commands.

**Why:**
- Catches incomplete information
- Validates Changeover quality
- Prevents cascade of incomplete work
- Gives user control over workflow progression

### Context Status Output

The Context Status block appears immediately after profile activation from a changeover file.

**Purpose:**
- Proves profile loaded rules correctly
- Proves mandatory behaviors are active
- Enables user detection of context collapse
- Provides immediate visual feedback
- Shows context window usage for compaction planning

**Why This Works:**
- No rules needed for detection (user's eyes detect missing block)
- Can't be hidden by prompt reminders
- Binary signal: present or absent
- Simple recovery mechanism
- Immediate feedback

**Example Output:**

```
=== Context Status ===
Profile: Builder
WorkflowId: wf-1738190400000
Rules Loaded: 12 files
Context: 42%
======================

Reading HANDOFF.md...
Task: Implement frontend search saga nested Summary updates
Proceeding with TDD approach...
```

**User Detection:**
- Profile activates but no Context Status block appears = context collapse detected
- User should close tab, open new tab, retry @start or @receive
- Verify Context Status block appears on retry

**Recovery Pattern:**
1. User triggers @start or @receive
2. No Context Status block appears
3. User closes current tab
4. User opens new tab
5. User retries @start or @receive
6. Context Status block appears = context loaded correctly


### Reviewable Handoffs

Handoffs are made explicit and reviewable to prevent incomplete information from propagating through the workflow.

**Problem:** TestDesigner might pass only test scenarios to PE, but PE needs full story requirements (schema, guards, wiring).

**Solution:** Make handoffs explicit, reviewable, and governed by the Change invariant.

### Impact

- All profiles follow consistent workflow patterns
- Handoffs are explicit and reviewable
- Incomplete information caught early
- Clear reference for workflow mechanics
- Reduces workflow errors and rework
