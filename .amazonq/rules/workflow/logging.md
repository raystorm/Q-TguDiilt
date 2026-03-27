# Workflow Logging Specification

## CRITICAL: MANDATORY for All Profiles

**All profiles that reference this file MUST:**
- Log workflow_start on activation
- Log key events (file changes, handoffs, test results, user interactions)
- Use fsWrite append to `.amazonq/workflow.log`
- Follow JSONL format specified below

**This is not optional. Logging enables retrospective analysis and workflow improvement.**

---

## Purpose

Track workflow execution to enable retrospective analysis of:
- System behavior (drift, corrections, broken tests, fixes)
- User behavior (clarification requests, information gathering)
- Improvement opportunities for both AI and user

## Log Location

`.amazonq/workflow.log` (JSONL format)

## Event Types

### 1. Workflow Start

```typescript
{
  type: "workflow_start";
  id: string;              // Auto-generated UUID
  parentId?: string;       // Set if nested workflow
  timestamp: string;       // ISO 8601
  trigger: "user" | "handoff";
  profile: string;         // Profile name
  goal: string;            // Extracted from "As Profile, [goal]"
}
```

**When to log:**
- User activates a profile with explicit goal
- Profile receives handoff from another profile

### 2. Event

```typescript
{
  type: "event";
  workflowId: string;      // Links to workflow_start.id
  timestamp: string;       // ISO 8601
  source: "system" | "user";
  actor: string;           // Profile name or "user"
  eventType: string;       // See Event Types below
  what: string;            // Brief description
  why: string;             // Reason or context
  context?: object;        // Additional structured data
}
```

## Event Types

### System Events
- `profile_activated` - Profile started work
- `file_modified` - File changed
- `file_created` - New file created
- `test_failed` - Test failure detected
- `test_fixed` - Test failure resolved
- `drift_detected` - Code doesn't follow patterns
- `drift_corrected` - Drift fixed
- `validation_failed` - Enforcer found issues
- `validation_passed` - Enforcer approved
- `handoff_sent` - Work passed to another profile
- `handoff_received` - Work received from another profile
- `escalation` - Doctor escalated issue
- `blocker` - Work blocked, needs resolution

### User Events
- `clarification_requested` - User asked for more info
- `confirmation_given` - User approved changes
- `confirmation_denied` - User rejected changes
- `direction_changed` - User changed requirements
- `information_provided` - User answered question

### User Correction Events

**When to log:**
- User corrects profile behavior or approach
- User provides direction that changes the plan
- User clarifies requirements mid-workflow
- User points out boundary violations
- User redirects work to different profile

**Event types:**
- `behavior_corrected` - User corrected profile behavior
- `direction_changed` - User changed direction or approach (also listed above)
- `clarification_provided` - User clarified requirements

**Examples:**

**User corrects boundary violation:**
```json
{
  "type": "event",
  "workflowId": "wf-1738108800000",
  "timestamp": "2025-01-28T23:21:30.000Z",
  "source": "user",
  "actor": "user",
  "eventType": "behavior_corrected",
  "what": "Corrected Builder offering to write documentation",
  "why": "Documentation is Documentor work, Builder should create DOCUMENTOR-NOTE.md"
}
```

**User changes direction:**
```json
{
  "type": "event",
  "workflowId": "wf-1738108800000",
  "timestamp": "2025-01-28T23:22:00.000Z",
  "source": "user",
  "actor": "user",
  "eventType": "direction_changed",
  "what": "Changed from implementation-first to TDD approach",
  "why": "User wants tests written before implementation"
}
```

**User clarifies requirements:**
```json
{
  "type": "event",
  "workflowId": "wf-1738108800000",
  "timestamp": "2025-01-28T23:23:00.000Z",
  "source": "user",
  "actor": "user",
  "eventType": "clarification_provided",
  "what": "Clarified that override should work in dev/prod too",
  "why": "User wants full control via environment variable"
}
```

**Why this matters:**
- Captures valuable feedback for retrospective analysis
- Identifies patterns in profile behavior issues
- Documents decision points in workflow
- Helps improve prompts and rules

## How to Log

Profiles must use `fsWrite` with `append` command to add JSONL entries to `.amazonq/workflow.log`.

### Workflow Start Logging

When a profile is activated with an explicit goal, append a workflow_start entry:

```typescript
fsWrite({
  command: "append",
  path: "/home/tburton/IdeaProjects/hukdzen/.amazonq/workflow.log",
  fileText: JSON.stringify({
    type: "workflow_start",
    id: "wf-" + Date.now(),  // Simple unique ID
    parentId: "wf-parent-id",  // Optional: set if nested workflow
    timestamp: new Date().toISOString(),
    trigger: "user",  // or "handoff"
    profile: "ProfileName",
    goal: "extracted goal from user request"
  }) + "\n"
});
```

**Examples:**

**User trigger:**
```json
{
  "type": "workflow_start",
  "id": "wf-1738095600000",
  "timestamp": "2025-01-28T19:40:00.000Z",
  "trigger": "user",
  "profile": "Architect",
  "goal": "Analyze Document domain migration"
}
```

**Handoff trigger:**
```json
{
  "type": "workflow_start",
  "id": "wf-1738095700000",
  "parentId": "wf-1738095600000",
  "timestamp": "2025-01-28T19:45:00.000Z",
  "trigger": "handoff",
  "profile": "Builder",
  "goal": "Implement GraphQL filtering improvements"
}
```

### Profile Activation Logging

Immediately after workflow_start, log profile activation:

```typescript
fsWrite({
  command: "append",
  path: "/home/tburton/IdeaProjects/hukdzen/.amazonq/workflow.log",
  fileText: JSON.stringify({
    type: "event",
    workflowId: "wf-123",  // Use current workflow ID
    timestamp: new Date().toISOString(),
    source: "system",
    actor: "ProfileName",
    eventType: "profile_activated",
    what: "Started ProfileName work",
    why: "Brief context about what will be done"
  }) + "\n"
});
```

**Example:**
```json
{
  "type": "event",
  "workflowId": "wf-1738095600000",
  "timestamp": "2025-01-28T19:40:05.000Z",
  "source": "system",
  "actor": "Builder",
  "eventType": "profile_activated",
  "what": "Started Builder work",
  "why": "Implementing schema changes and tests"
}
```

### File Change Logging

After modifying or creating files with fsWrite/fsReplace, log the change:

```typescript
fsWrite({
  command: "append",
  path: "/home/tburton/IdeaProjects/hukdzen/.amazonq/workflow.log",
  fileText: JSON.stringify({
    type: "event",
    workflowId: "wf-123",  // Use current workflow ID
    timestamp: new Date().toISOString(),
    source: "system",
    actor: "ProfileName",
    eventType: "file_modified",  // or "file_created"
    what: "Modified path/to/file.ts",  // or "Created path/to/file.ts"
    why: "Reason for change",
    context: { filePath: "/absolute/path/to/file.ts" }
  }) + "\n"
});
```

**Examples:**

**File modified:**
```json
{
  "type": "event",
  "workflowId": "wf-1738095600000",
  "timestamp": "2025-01-28T19:42:00.000Z",
  "source": "system",
  "actor": "Builder",
  "eventType": "file_modified",
  "what": "Modified amplify/data/Content.graphql",
  "why": "Added SummaryFilterInput",
  "context": { "filePath": "/home/user/project/amplify/data/Content.graphql" }
}
```

**File created:**
```json
{
  "type": "event",
  "workflowId": "wf-1738095600000",
  "timestamp": "2025-01-28T19:43:00.000Z",
  "source": "system",
  "actor": "Builder",
  "eventType": "file_created",
  "what": "Created src/NewDomain/NewDomainSlice.ts",
  "why": "New domain implementation",
  "context": { "filePath": "/home/user/project/src/NewDomain/NewDomainSlice.ts" }
}
```

### General Event Logging

For other significant events, append an event entry:

```typescript
fsWrite({
  command: "append",
  path: "/home/tburton/IdeaProjects/hukdzen/.amazonq/workflow.log",
  fileText: JSON.stringify({
    type: "event",
    workflowId: "wf-123",  // Use current workflow ID
    timestamp: new Date().toISOString(),
    source: "system",
    actor: "ProfileName",
    eventType: "test_failed",  // or other event type
    what: "Brief description",
    why: "Reason or context"
  }) + "\n"
});
```

### When to Log

**Workflow Start:**
- Profile activated with explicit goal ("As Profile, do X")
- Profile receives handoff from another profile

**Profile Activation:**
- Immediately after workflow_start
- Profile begins work

**File Changes:**
- After modifying existing file (fsReplace)
- After creating new file (fsWrite create)
- Log immediately after file operation completes

**Other Events:**
- Test failures and fixes
- Validation results
- Handoffs sent/received
- Escalations
- User clarifications
- User corrections (behavior_corrected, direction_changed, clarification_provided)
- Blockers
- Drift detection and correction

## Timestamp Accuracy

**CRITICAL:** All workflow log timestamps MUST be accurate.

**Requirements:**
- Use current date/time when generating timestamps
- Format: ISO 8601 (`new Date().toISOString()`)
- Do not hardcode dates
- Do not reuse old timestamps
- Do not guess at dates

**Why this matters:**
- Retrospective analysis depends on accurate timestamps
- Duration calculations require correct time sequencing
- Pattern identification needs real timing data
- Inaccurate timestamps make the entire log unreliable

**Violation:** Using incorrect dates or hardcoded timestamps in workflow log entries.

## Example Log Entries

```jsonl
{"type":"workflow_start","id":"wf-001","timestamp":"2024-01-15T10:30:00Z","trigger":"user","profile":"Architect","goal":"update profiles to add TestDesigner"}
{"type":"event","workflowId":"wf-001","timestamp":"2024-01-15T10:31:00Z","source":"system","actor":"Architect","eventType":"file_modified","what":"Updated _PROFILES.md","why":"Replaced Tester with TestDesigner"}
{"type":"event","workflowId":"wf-001","timestamp":"2024-01-15T10:32:00Z","source":"system","actor":"Architect","eventType":"file_created","what":"Created profiles/test-designer.md","why":"Define TestDesigner behavior"}
{"type":"event","workflowId":"wf-001","timestamp":"2024-01-15T10:33:00Z","source":"user","actor":"user","eventType":"clarification_requested","what":"Asked about Gherkin format","why":"Wanted scenarios easily convertible to Gherkin"}
{"type":"event","workflowId":"wf-001","timestamp":"2024-01-15T10:34:00Z","source":"system","actor":"Architect","eventType":"file_modified","what":"Updated test-designer.md","why":"Added Gherkin-compatible output format requirement"}
```

## Retrospective Analysis

Retro profile reads workflow.log and analyzes:
- Workflow nesting depth
- Handoff frequency
- Clarification frequency
- Fix/correction frequency
- Blocker patterns
- Decision quality

Output: Keep/Stop/Start recommendations

---

## Auto-Suspend Integration

Profiles that log workflows MUST also maintain auto-suspend files for context recovery.

**See:** `workflow/auto-suspend.md` for complete auto-suspend specification.

**Summary:**
- On workflow_start: Create auto-suspend file
- On every event: Update auto-suspend file (atomic write)
- On completion: Delete auto-suspend file

**Purpose:** Enable recovery from accidental tab closure.
