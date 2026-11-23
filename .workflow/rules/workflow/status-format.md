# Status File Format

Single canonical format for profile status files. Other rules point here and
do not repeat it.

## Location

- Folder: `.amazonq/work/status/`. Create it if missing.
- Marker: the folder holds an empty `.gitkeep`. Never delete it.
- File: `<profile>-<workflowId>.json`, one per profile instance.
  `<profile>` is the canonical profile name.
- A status file is a Transient Workflow Artifact: no confirmation, no classification
  block, no `git add`.
- Do NOT log status file writes.

## Canonical Shape

```json
{
  "schema": 1,
  "profile": "[Profile]",
  "workflowId": "[wf-kebab-case-id]",
  "status": "[status]",
  "next": {
    "command": "[command]",
    "to": "[Profile]"
  }
}
```

## Field Definitions

| Field        | Required    | Description                                       |
| ------------ | ----------- | ------------------------------------------------- |
| schema       | Yes         | Always `1`                                        |
| profile      | Yes         | Canonical profile name                            |
| workflowId   | Yes         | Resolved as `workflow/logging.md` resolves it     |
| status       | Yes         | One of the Status Values                          |
| next         | By status   | Object. Present or omitted, as Status Values says |
| next.command | With `next` | `handoff` or `send`                               |
| next.to      | With `next` | Canonical profile name of the target              |

- The file carries data only: a profile name, never a command line or a path.
- No timestamp. Freshness is the file's modification time.
- Write the whole file on each write. Write only your own file.

## Status Values

| Status   | Meaning                                            | `next` field                  |
| -------- | -------------------------------------------------- | ----------------------------- |
| started  | Activated and working                              | Omitted                       |
| waiting  | Blocked on the user, or on a side trip             | Omitted                       |
| ready    | Changeover file written and verified               | Present: `handoff` or `send`  |
| complete | All post-handoff work done (logging, suspend, etc) | Kept from `ready`, or omitted |

- `next` omitted on `started` or `waiting`: no next step is known yet.
- `next` omitted on `complete`: nothing follows, and the user closes the tab.
- `ready` is written immediately after HANDOFF.md/MESSAGE.md is verified.
- `complete` is written only after ALL post-handoff work finishes (logging, suspend updates, cleanup).

## When to Write

| Event                                                           | Write                      |
| --------------------------------------------------------------- | -------------------------- |
| Activation (`@as`, `@start`, `@receive`), before task work      | `started`; `next` omitted  |
| Turn asks for review, confirmation, a decision or information   | `waiting`; `next` omitted  |
| `@send`: MESSAGE.md written and verified                        | `waiting`; `next` omitted  |
| `@handoff`: HANDOFF.md written and verified, after the sweep    | `ready`; `next` present    |
| All post-handoff work done (logging, suspend, cleanup)          | `complete`; `next` kept    |
| Completion message is "close this tab" with no next handoff     | `complete`; `next` omitted |

- `ready` is the first write after changeover file verification. Its `next` agrees with
  the `**Next**` line or completion block target.
- After `ready`, the profile does remaining work (logging event, auto-suspend update, etc).
- Once all work completes, write `complete` to signal the handoff is fully finished.

## Constraints

- With `@as` and no task, the workflowId is unknown until the user's first message.
  Write `started` once it is resolved.
- A changeover file that fails verification leaves the status unchanged.
- A status write that fails or is declined does not stop the work. Tell the user
  in one line and do not retry.

## Handoff Sweep

The Handoff Sweep runs after HANDOFF.md is written and verified, before `@start` can fire:

1. Read each other file in the folder whose name ends with `-<workflowId>.json`.
2. Delete it **only** when its `status` is `complete`.
3. Leave `ready` files untouched (they represent handoffs in progress).
4. Leave `started` and `waiting` files untouched (they represent parallel/side work).
5. Leave unreadable files.
6. Never touch files of other workflows.

**Key Point**: The sweep deletes only `complete` files, not `ready` files. A `ready` file
means the handoff was verified but post-handoff work is still pending. `@start` cannot fire
until the status transitions to `complete`.
