Load suspended workflow context from `.amazonq/suspended/[name].md`.

If no name provided:
- Read `.amazonq/suspended/INDEX.md`
- Display Active and Completed contexts
- Format: `[name] - [description] - [date]`
- Stop (wait for user to specify name)

If name provided:
- Read `.amazonq/suspended/[name].md`
- Display summary:
  - Profile
  - Goal
  - Current State
  - Resume Instructions
- Update file's Last Active timestamp to current ISO timestamp
- Update Status to active (if not already)
- Activate profile specified in file
- Load context into conversation

Append to `.amazonq/workflow.log`:
```json
{"type":"event","workflowId":"[new-id]","timestamp":"[ISO-8601]","source":"user","actor":"user","eventType":"context_resumed","what":"[name]","why":"Continue from checkpoint"}
```

Continue conversation as activated profile with loaded context.
