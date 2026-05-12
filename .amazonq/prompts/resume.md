Load suspended workflow context.

## Missing File Fallback
If any `.amazonq/suspended/` file needed below does not exist:
- INDEX.md missing → display: "No suspended contexts found. (INDEX.md does not exist)"
- [name].md missing → display: "Context '[name]' not found. Use `@list` to see available contexts."
- Do not continue. Do not log or change workflow state.

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

Read and follow `.workflow/rules/workflow/timestamp-method.md`
to generate the timestamp.

Append to `.amazonq/workflow.log`:
```json
{"type":"event","workflowId":"[new-id]","timestamp":"[ISO-8601]","source":"user","actor":"user","eventType":"context_resumed","what":"[name]","why":"Continue from checkpoint"}
```

Continue conversation as activated profile with loaded context.
