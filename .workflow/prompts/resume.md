---
name: resume
version: 1.2.0
description: "Restore a suspended (or auto-suspended) context."
arguments: [name]
argument-hint: "[context name]"
---
Load suspended workflow context.

Context name: `{{name}}`

## Missing File Fallback

Check for files by exact path, never with a file search, glob or
directory listing. `.amazonq/suspended/` is ignored by git, and those tools
skip ignored paths.

For INDEX.md:
1. Read `.amazonq/suspended/INDEX.md` with the file read tool.
2. If the read fails or returns nothing, confirm with the terminal:
   - Linux and macOS: `ls -la .amazonq/suspended/INDEX.md`
   - Windows (cmd and PowerShell): `type .amazonq\suspended\INDEX.md`
3. If missing, display: "No suspended contexts found. (INDEX.md does not exist)"
   Do not continue. Do not log or change workflow state.

For [name].md:
1. Read `.amazonq/suspended/[name].md` with the file read tool.
2. If the read fails or returns nothing, confirm with the terminal:
   - Linux and macOS: `ls -la .amazonq/suspended/[name].md`
   - Windows (cmd and PowerShell): `type .amazonq\suspended\[name].md`
3. If missing, display: "Context '[name]' not found. Use `@list` to see available contexts."
   Do not continue. Do not log or change workflow state.
4. If the two disagree, the terminal result is the authority. Use its output
   as the content.

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
