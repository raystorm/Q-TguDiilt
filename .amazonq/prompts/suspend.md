Save current workflow context to `.amazonq/suspended/[name].md`.

Extract profile and goal from conversation.

If no name provided, generate: `[profile]-[subject-slug].md`.

Ask user:
- Type (default: main_workflow): main_workflow | side_trip | analysis | checkup | debug | other
- Status (default: active): active | blocked | completed | abandoned
- ParentContext (optional): parent context name if nested work

Create suspend file with format:
```markdown
# Suspended: [Profile] - [Subject]

## Profile
[Profile name]

## Goal
[What was being worked on]

## Key Decisions
- [List key decisions made]

## Current State
[Where work left off]

## Helper Files
- [List any helper files with descriptions]

## Resume Instructions
[What to do when resuming]

## Metadata
- Type: [user's choice]
- Status: [user's choice]
- Suspended: [current ISO timestamp]
- Last Active: [current ISO timestamp]
- WorkflowId: [current workflowId or generate new]
- ParentContext: [if provided]
```

Update `.amazonq/suspended/INDEX.md` Active Contexts section with:
```
- **[name]** - [description] - [date]
```

Append to `.amazonq/workflow.log`:
```json
{"type":"event","workflowId":"[current-id]","timestamp":"[ISO-8601]","source":"user","actor":"user","eventType":"context_suspended","what":"[name]","why":"Workflow checkpoint"}
```

Confirm: "Suspended as: [name]"
