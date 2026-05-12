Extract the observation text from the user's message.

Read `.amazonq/workflow.log` to find the most recent workflowId.
If the log doesn't exist or is empty,
generate a new workflowId using format: `wf-` + [kebab-case-current-task].

Append to `.amazonq/workflow.log` in JSONL format:

```json
{
  "type": "event",
  "workflowId": "[current-or-new-workflow-id]",
  "timestamp": "[current-iso-timestamp]",
  "source": "user",
  "actor": "user",
  "eventType": "user_note",
  "what": "[observation text]",
  "why": "User-logged insight"
}
```

Read and follow `.workflow/rules/workflow/timestamp-method.md`
to generate the timestamp.

Use the generated timestamp in the log entry.

Respond: "Note logged"
