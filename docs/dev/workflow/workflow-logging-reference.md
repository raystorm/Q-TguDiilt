# Workflow Logging Reference

This document provides detailed examples and patterns for workflow logging.

For MANDATORY requirements and core specifications, see `.workflow/rules/workflow/logging.md`.

---

## Event Type Examples

### Workflow Start Events

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

### Profile Activation Events

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

### File Change Events

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

### User Correction Events

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

---

## Logging Implementation Patterns

### Workflow Start Logging

```typescript
fsWrite({
  command: "append",
  path: "/home/tburton/IdeaProjects/hukdzen/.amazonq/workflow.log",
  fileText: JSON.stringify({
    type: "workflow_start",
    id: "wf-" + Date.now(),
    parentId: "wf-parent-id",  // Optional: set if nested workflow
    timestamp: new Date().toISOString(),
    trigger: "user",  // or "handoff"
    profile: "ProfileName",
    goal: "extracted goal from user request"
  }) + "\n"
});
```

### Profile Activation Logging

```typescript
fsWrite({
  command: "append",
  path: "/home/tburton/IdeaProjects/hukdzen/.amazonq/workflow.log",
  fileText: JSON.stringify({
    type: "event",
    workflowId: "wf-123",
    timestamp: new Date().toISOString(),
    source: "system",
    actor: "ProfileName",
    eventType: "profile_activated",
    what: "Started ProfileName work",
    why: "Brief context about what will be done"
  }) + "\n"
});
```

### File Change Logging

```typescript
fsWrite({
  command: "append",
  path: "/home/tburton/IdeaProjects/hukdzen/.amazonq/workflow.log",
  fileText: JSON.stringify({
    type: "event",
    workflowId: "wf-123",
    timestamp: new Date().toISOString(),
    source: "system",
    actor: "ProfileName",
    eventType: "file_modified",  // or "file_created"
    what: "Modified path/to/file.ts",
    why: "Reason for change",
    context: { filePath: "/absolute/path/to/file.ts" }
  }) + "\n"
});
```

### General Event Logging

```typescript
fsWrite({
  command: "append",
  path: "/home/tburton/IdeaProjects/hukdzen/.amazonq/workflow.log",
  fileText: JSON.stringify({
    type: "event",
    workflowId: "wf-123",
    timestamp: new Date().toISOString(),
    source: "system",
    actor: "ProfileName",
    eventType: "test_failed",  // or other event type
    what: "Brief description",
    why: "Reason or context"
  }) + "\n"
});
```

---

## Complete Example Log Sequence

```jsonl
{"type":"workflow_start","id":"wf-001","timestamp":"2024-01-15T10:30:00Z","trigger":"user","profile":"Architect","goal":"update profiles to add TestDesigner"}
{"type":"event","workflowId":"wf-001","timestamp":"2024-01-15T10:31:00Z","source":"system","actor":"Architect","eventType":"file_modified","what":"Updated _PROFILES.md","why":"Replaced Tester with TestDesigner"}
{"type":"event","workflowId":"wf-001","timestamp":"2024-01-15T10:32:00Z","source":"system","actor":"Architect","eventType":"file_created","what":"Created profiles/test-designer.md","why":"Define TestDesigner behavior"}
{"type":"event","workflowId":"wf-001","timestamp":"2024-01-15T10:33:00Z","source":"user","actor":"user","eventType":"clarification_requested","what":"Asked about Gherkin format","why":"Wanted scenarios easily convertible to Gherkin"}
{"type":"event","workflowId":"wf-001","timestamp":"2024-01-15T10:34:00Z","source":"system","actor":"Architect","eventType":"file_modified","what":"Updated test-designer.md","why":"Added Gherkin-compatible output format requirement"}
```

---

## User Correction Patterns

### When to Log User Corrections

Log user corrections when:
- User corrects profile behavior or approach
- User provides direction that changes the plan
- User clarifies requirements mid-workflow
- User points out boundary violations
- User redirects work to different profile

### Why User Corrections Matter

- Captures valuable feedback for retrospective analysis
- Identifies patterns in profile behavior issues
- Documents decision points in workflow
- Helps improve prompts and rules

### User Correction Event Types

- `behavior_corrected` - User corrected profile behavior
- `direction_changed` - User changed direction or approach
- `clarification_provided` - User clarified requirements

---

## Timestamp Best Practices

**Always use current date/time:**
```typescript
timestamp: new Date().toISOString()
```

**Never:**
- Hardcode dates
- Reuse old timestamps
- Guess at dates
- Use placeholder dates

**Why:**
- Retrospective analysis depends on accurate timestamps
- Duration calculations require correct time sequencing
- Pattern identification needs real timing data
- Inaccurate timestamps make the entire log unreliable
