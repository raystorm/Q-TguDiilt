# Connecting a JetBrains IDE over ACP

The Q-TguDiilt workflow engine can run as an **ACP service** that a
JetBrains IDE connects to and drives. The IDE speaks the Agent Client
Protocol (ACP); the engine terminates ACP at its service boundary and
runs your workflow. No LLM provider needs to speak ACP.

## Prerequisites

- A JetBrains IDE with ACP client support
- Node.js available on your PATH
- A `registry.yaml` in `.workflow/acp/drivers/` (copy
  `registry.example.yaml` there once); the service does not start without
  it. See `docs/user/model-dispatch.md`
- The executable of the agent the registry prefers on your PATH and
  logged in (`kiro-cli` for the shipped example); see
  `docs/user/acp-agents.md`
- This repository present in your project

## Configure the connection

JetBrains launches the ACP service as a subprocess. Point it at the
service entry point by creating `~/.jetbrains/acp.json`:

```json
{
  "command": "node",
  "args": [
    ".workflow/acp/protocol/index.ts"
  ]
}
```

Notes:

- The service is launched from your project directory; the operational
  log is written under `.workflow/work/` in that project.
- Adjust `command`/`args` to match how your environment runs the entry
  point (for example, a compiled `index.js` or a TypeScript runner).

## Transport

The service communicates over **stdio** using JSON-RPC 2.0, framed as
newline-delimited JSON. This is provided by the official ACP SDK
(`@agentclientprotocol/sdk`); you do not configure it beyond the
`acp.json` above.

## What a session looks like

From your side, a session follows this lifecycle:

1. **Connect** — the IDE starts the service and initializes the
   connection.
2. **New session** — each session maps to exactly one workflow.
3. **Prompt turns** — you send a prompt; the service shows progress and
   returns a response. One prompt turn runs one workflow step.
4. **Disconnect** — closing the connection releases all sessions.

Only one prompt turn runs at a time per session. If you send a second
prompt while one is still running, the service rejects it and asks you
to retry once the current turn finishes. To interrupt a running turn,
use your IDE's cancel action (ACP `session/cancel`); see "Stopping a
turn".

## Approvals

When a step needs your approval, the service first shows you the
**specifics** of the action — the command, file paths, diff, and any
tool parameters — and then presents the approval request. You always
see what you are approving before you approve it.

## Stopping a turn

Use your IDE's stop (cancel) action to end a running turn. The service
passes the stop on to the provider, shows any text produced so far, and
ends the turn as cancelled. The session stays usable.

- **Winding down:** the session stays busy until the provider has
  finished. A new prompt sent right after Stop can be rejected as "turn
  in progress"; wait a moment and retry.
- **Pending approvals:** an approval you have not answered yet is denied
  when you stop. Answering it afterwards, even with Allow, changes
  nothing and the action does not run.
- **Nothing is rolled back:** an action that already ran stays done.
- **Slow to stop:** if the agent does not answer the stop within 5
  seconds, the service ends that agent. Your next message starts a fresh
  agent, and the old session is gone (the service says so). Nothing is
  lost silently.
- **Disconnect:** closing the chat, or the IDE, ends that chat's service
  and its agent: every running turn stops, the agent is shut down, and
  all sessions are released. With Kiro this takes about a second, and the
  service exits within 10 seconds. A terminate, interrupt or hangup
  signal does the same. The exit status is 0 after a clean end and 1
  otherwise.

## Logs

The service writes two logs in `.workflow/work/`, both JSONL. Neither is
version-controlled.

- **`acp.log`** is the operational log. It records connection lifecycle
  events (connect, disconnect, session mapping), stops (`cancel_requested`,
  `turn_cancelled`) and errors with context. It can hold text from the
  service itself, such as start-up and configuration messages. It never
  holds text from an agent or a provider, or your prompts, replies, titles,
  diffs or tool input.
- **`acp-diagnostic.log`** is the diagnostic log. When an agent fails, the
  service writes one record about it: why it failed, the exit code or
  signal, and the last lines the agent printed. A failure is an agent that
  exits or crashes, breaks the protocol, answers a request with an error,
  needs a login, times out while starting, or cannot be started. The error
  in the chat ends with `full record: <path>`, naming this file.

The diagnostic log is always on and has no setting. It can contain output
from the agent, so read it before you share it. The service removes text
that looks like a secret, but this is a safeguard, not a guarantee. A
secret stored alone as a whole value, such as a message that is exactly
`key=secret`, is not caught.

Only the user can read the file (not enforced on Windows). It is capped at
1 MiB: when the next record would pass the cap, the file is renamed to
`acp-diagnostic.log.1`, replacing the earlier copy, and a new file starts.
To clear the log, delete both files.

If the diagnostic log cannot be opened when the service starts, the service
still runs. `acp.log` gets one warning, and no records and no
`full record:` line are written.

## Troubleshooting

- **The IDE cannot start the service** — verify `command`/`args` in
  `~/.jetbrains/acp.json` and that Node.js is on your PATH.
- **The service stops at start** — the registry is missing or unusable.
  `.workflow/work/acp.log` has a `registry_startup_failed` entry naming
  the file and the problem; see `docs/user/model-dispatch.md`.
- **A reply starts with a notice about the preferred driver or model** —
  the registry's preference cannot be used, and the notice says what is
  used instead. See "When the preferred driver or model cannot be used"
  in `docs/user/model-dispatch.md`.
- **Prompts fail immediately with "before initialize"** — the IDE sent
  a request before the connection finished initializing; reconnect.
- **A prompt is rejected as "turn in progress"** — a previous turn is
  still running or still winding down after a stop; wait for it to
  finish or cancel it, then retry.
- **The session stays busy after Stop** — the driver in use cannot be
  interrupted, so the turn ends only when the driver finishes its
  current work. Wait, then retry. The log shows `cancel_requested` when
  the stop reached the service and `turn_cancelled` when the turn ended.
- **Provider quota / authentication errors** — these surface as clear,
  actionable errors; resolve the provider issue (quota or re-login) and
  retry the turn.
- **The agent will not start, or fails the first turn** — see "When
  something goes wrong" in `docs/user/acp-agents.md`.
- **Check the logs** — `.workflow/work/acp.log` records what the service
  did and any errors encountered. `.workflow/work/acp-diagnostic.log`
  records why an agent failed; the chat error names it.
