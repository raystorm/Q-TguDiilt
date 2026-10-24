# ACP Service Boundary

The ACP Service Boundary lets a JetBrains IDE run the Q-TguDiilt
workflow engine over the Agent Client Protocol (ACP). The boundary
**terminates** ACP at the protocol layer and translates ACP session turns to
and from the existing provider-neutral driver layer. LLM providers stay
ACP-agnostic — they are reached only through a driver.

Source lives under `.workflow/acp/protocol/`.

## Architecture

The official ACP SDK (`@agentclientprotocol/sdk`) owns the protocol:
transport and JSON-RPC framing, method dispatch, version negotiation,
and unknown-method handling. The boundary owns translation and session
lifecycle.

```
JetBrains IDE
   │  ACP (JSON-RPC 2.0 over stdio)
   ▼
@agentclientprotocol/sdk        ← transport, framing, dispatch
   │  typed handler calls
   ▼
protocol/agent.ts               ← ACP ⇄ driver translation seam
   │  driver.execute(...)
   ▼
drivers/ (Kiro, Copilot, ...)   ← provider-neutral driver layer
   │
   ▼
LLM provider (ACP-agnostic)
```

Entry point `protocol/index.ts` assembles the SDK stdio transport, the
translation agent (`createAgent`), a session store, the Driver Catalog
and dispatch resolver built from the driver registry, the governance
engine, and a file logger, then serves the ACP client. The governance
config and the registry are each loaded once at startup, and the catalog
is built before the server connects. A missing or malformed config, or a
registry or catalog that fails (missing file, unknown key, entry without
`module`, empty `drivers:`, every driver failing, defaults that select no
working driver), fails closed before any request is served. The registry
failure is logged at error level as `registry_startup_failed` with the
registry path, and the process exits non-zero. The registry path comes
from one lookup function (`protocol/registry-location.ts`): `registry.yaml`
in the drivers folder, found from the service's own files, with no
launch-time setting.

## Transport

stdio, JSON-RPC 2.0, newline-delimited JSON (`ndJsonStream` from the
SDK). A JetBrains IDE launches the entry point as a subprocess via
`~/.jetbrains/acp.json`. The entry point wires SDK methods
(`initialize`, `session/new`, `session/load`, `session/prompt`,
`session/cancel`) to boundary handlers; on stdin EOF it disconnects.

## Translation seam (`agent.ts`)

The seam is deliberately narrow: **one `session/prompt` turn maps to
exactly one `driver.execute(...)`**.

- Inbound ACP prompt content (text blocks) is concatenated into a single
  command string.
- `driver.execute(command, options)` runs the step on the session's
  driver (`catalog.get(record.driver)`), with the session's model in
  `options.model` (`auto` included). If the session has a prior driver
  session, its id is passed via `options.sessionId`; a session keeps one
  driver, so the id is only ever used with the driver that issued it.
- `DriverResult.text` → ACP response content (streamed as a
  `session/update` chunk before the final response).
- `DriverResult.sessionId` → stored on the session record for
  continuity across turns.
- `options.onToolCall` is supplied on every turn: the first, a later
  one, and a resumed session. It answers each tool call the driver
  reports through governance (see "Tool-call governance"). A driver
  that does not declare tool-call governance support is rejected before
  any work.
- `options.signal` is supplied on every turn. It aborts when the client
  cancels the turn or the connection ends (see "Cancel and wind-down").
  A driver may honor it; a driver that ignores it still conforms.
- Each turn streams at least one `session/update` before returning its
  stop reason (`end_turn`, or `cancelled` after a cancel).

An empty prompt (no text content) is rejected with a clear error.

## Session lifecycle & mapping

The session store (`session-store.ts`) maps **each ACP session to
exactly one `workflowId`** and tracks:

- `workflowId` — generated on `session/new`; distinct sessions get
  distinct workflows.
- `driverSessionId` — the driver's continuity id, updated after each
  turn.
- `driver` and `model` — resolved once when the session opens.
- `endedNormally` — true once a turn of the session has ended with
  `end_turn`.
- `activeTurn` — the per-session in-flight flag.
- `abort` — the abort controller of the in-flight turn; set and cleared
  together with `activeTurn`.

Lifecycle:

- `initialize` — marks the connection initialized.
- `session/new` — resolves the driver and model (registry defaults, no
  profile), then creates a session record with a fresh `workflowId`. A
  resolution failure rejects the call and leaves no record.
- `session/load` — re-establishes a session bound to a supplied
  `workflowId` (resume), resolved the same way as a new one. A loaded
  session starts with no driver continuity id.
- `session/cancel` — aborts the active turn; the only interrupt. It does
  not free the session (see "Cancel and wind-down"). A cancel with no
  active turn, an unknown session, or a second cancel is an idempotent
  no-op.
- disconnect (stdin EOF or a termination signal) — aborts every active
  turn, closes every driver in the catalog, then releases all mappings
  (`closeAll`), so nothing leaks.

### Concurrency: reject-with-retry

Only one turn runs per session at a time, and that holds through a
cancel. A second prompt while a turn is in flight, or still winding down
after a cancel, throws `TurnInProgressError` (`retryable: true`); the
in-flight turn is unaffected and the client may retry after it
completes. A session never runs two turns at once.

### Driver selection and the notice

The session store does not choose the driver. `newSession` and
`loadSession` call `resolver.resolve()` once, with no profile, before any
record exists. Prompts do not resolve again, so the answer cannot change
under a running session. If the catalog has no driver of that name,
`prompt` rejects before the turn starts and the session stays free.

When the catalog has a notice (the preferred driver or model cannot be
used), the first `agent_message_chunk` of a turn carries it, before the
progress update, for new and reopened sessions alike. It repeats on every
turn until one turn of that session ends normally (`end_turn`). A
cancelled, failed or rejected turn does not count. Opening a session sends
nothing. Without a notice the updates are unchanged.

### Cancel and wind-down

`prompt` creates an `AbortController` when it sets the active-turn flag
(after the rejection checks) and passes its `signal` to the driver. The
controller lives on the session record, set and cleared with the flag.

`session/cancel` with an active turn aborts it once and logs
`cancel_requested`. It does **not** free the session: the flag and
controller are cleared only when `driver.execute` settles. Until then a
new prompt gets the retryable `TurnInProgressError`.

When the turn settles after an abort:

- The turn is cancelled if the driver result says so or the signal is
  aborted, whatever the result holds. Non-empty partial text is
  streamed, `turn_cancelled` is logged, and the prompt returns
  `stopReason: 'cancelled'`. The session stays usable.
- The driver session id is stored only when it is non-empty (a turn
  cancelled before a downstream session existed has none).
- A driver that throws after the abort is also a cancel: the prompt
  returns `stopReason: 'cancelled'` and `turn_cancelled` is logged with
  `failureKind`. Without an abort a throw is unchanged (`prompt_failed`,
  the error surfaces).

After the abort the tool-call handler denies at once: no governance
evaluation, no detail update, no approval request. An ask that is
already open ends as a deny however it ends (a late Allow, Reject, a
cancelled answer, or a failed or invalid ask), and nothing waits for an
unanswered ask. A cancel never rolls anything back: a call that already
ran stays done.

A driver that ignores the signal still conforms. A cancel on it leaves
the session busy until `execute` settles.

### Disconnect

Stdin end, SIGTERM, SIGINT or SIGHUP, whichever comes first, runs
`onDisconnect` once through the shutdown handler
(`protocol/shutdown.ts`). The service then exits: 0 after a clean
disconnect, 1 when the disconnect failed or took longer than 10 seconds
(`DISCONNECT_BOUND_MS`). Signal handling on Windows is best effort and
untested.

In order, `onDisconnect` aborts every active turn, awaits
`catalog.closeAll()`, releases all session mappings, and logs
`disconnect`. `closeAll()` tries every driver, so one failing `close` does
not stop the others, and it rethrows the first failure. That failure is
logged as `close_failed` with `failureKind` only, the sessions are still
released, there is no retry, and `onDisconnect` then rethrows that error,
which gives the non-zero exit.
Calling it twice is harmless.

A session has no end event of its own. The client runs one service
process per chat, so closing the chat is the disconnect, and a session's
agent runs until then. Stop sends `session/cancel` and ends the turn
only. If a client ever shares one connection across chats, a
session-scoped release would be the planned extension.

### Before-initialize guard

The stable ACP SDK does not enforce initialize ordering, so the boundary
rejects any request that arrives before `initialize`. Throwing inside a
handler becomes a JSON-RPC error response, not a server crash.

## Tool-call governance

`prompt` builds a handler per turn over that turn's session and client
context, so concurrent reports share no state. Each report gets a
`callId` and is evaluated by the governance engine:

- `approve` — the driver is told approve; the user is not asked.
- `deny` — the driver is told deny; the user is not asked.
- `ask` — the ask flow below. Allow is approve; anything else is deny.

An allow covers that one report only; nothing is remembered.

## Ask flow (governance approvals)

Governance asks are surfaced to the IDE user as **two messages, in
order**:

1. A detail `session/update` (`tool_call`, `status: 'pending'`) carrying
   the full specifics — command, file paths, diff/patch, tool
   parameters — as an `AskDetails` payload. It also carries `kind`,
   `agentTitle` (the agent's title, labelled as display text and never
   used as a command), and `note` when governance could not evaluate.
2. The approval request (`session/request_permission`) with allow/reject
   options.

The user MUST see the specifics (message 1) before the approval request
(message 2). The default Kiro+ACP ask presentation is insufficient (no
command/paths/diff) and is not relied on to carry the specifics.

`AskDetails` is the governance ⇄ boundary contract (`shared/types.ts`):
governance produces it, the boundary delivers it.

The user's answer is one of `allow`, `reject`, `cancelled`, or `invalid`
(a missing outcome or an unknown option). Only `allow` approves.

### Failure handling

Anything but an explicit allow denies, and the session stays usable:

| Situation                               | Result                    | Logged reason      |
| --------------------------------------- | ------------------------- | ------------------ |
| User rejects                            | deny                      | none               |
| IDE answers cancelled                   | deny                      | `cancelled`        |
| Answer missing or unrecognized          | deny                      | `invalid_answer`   |
| Detail update or approval request fails | deny; no approval request | `ask_failed`       |
|                                         | follows a failed detail   |                    |
| Governance evaluation throws            | ask, with a `note`; deny  | `evaluation_error` |
|                                         | if the ask fails          |                    |

There is no timeout and no retry. The IDE's error text is never logged.

After a cancel, failures are part of the cancel:

| Situation                               | Result                  | Logged                                   |
| --------------------------------------- | ----------------------- | ---------------------------------------- |
| Driver throws after the abort           | `stopReason: cancelled` | `turn_cancelled` with `failureKind`      |
| Open ask ends after the abort           | deny                    | `governance_outcome`, reason `cancelled` |
| Ask fails or answer invalid after abort | deny                    | same, with `cause`                       |
| Partial text cannot be streamed         | error surfaces          | `prompt_failed`                          |
| `close` fails on disconnect             | sessions still released | `close_failed` with `failureKind`        |

### Outcome logging

After an ask or a failure the handler writes a `governance_outcome`
entry: `sessionId`, `callId`, `action`, `answeredBy` (`user`, `failure`
or `cancel`), and `reason` when there is one. It shares `sessionId` and
`callId` with the engine's `governance_decision` entry for the same
report. A report decided by a rule writes only the decision entry.

## Error model

The ACP `PromptResponse.stopReason` enum has no `error` value, so
mid-turn failures are surfaced as **JSON-RPC errors** (the SDK converts a
thrown error into an error response the client sees, without crashing the
server). The boundary owns a small error taxonomy (`errors.ts`) with a
distinct `kind` on each, keeping outcomes actionable and resumable:

| Error                  | `kind`             | Notes                                  |
| ---------------------- | ------------------ | -------------------------------------- |
| `TurnInProgressError`  | `turn_in_progress` | Backpressure; `retryable: true`        |
| `ProviderQuotaError`   | `provider_quota`   | Quota / rate limit; resolve and retry  |
| `ProviderAuthError`    | `provider_auth`    | Re-login required; resolve and retry   |
| `SessionCollapseError` | `session_collapse` | Session expired / context overflow     |

`boundaryErrorKind(err)` maps quota/auth/collapse to their `kind`;
anything else is treated as generic `internal`. Transport,
malformed-message, unknown-method, and protocol-version errors are
handled by the SDK, not the boundary.

Model **refusal is a normal successful turn**, not an error. No secrets
or raw prompt text are written to logs.

## Logging

Logging is an injected `Logger` seam (`shared/logger.ts`).
`createFileLogger` appends JSONL to `.workflow/work/acp.log` with
ordered, circular-safe serialization and error-cause chains, and falls
back to stderr. The backend is swappable behind the `Logger` interface.
Connection lifecycle (connect, disconnect, session mapping) and errors
(with context) are logged; secrets and raw prompt text are not.

### Log rule

The service log (`.workflow/work/acp.log`) may hold text from our own ACP
layer, such as start-up and configuration messages (the `reason` of
`driver_failed`, for example). Text from the provider or the agent never
goes in it; it goes in the diagnostic log. Neither log holds the user's
content: prompt text, the agent's reply text, tool titles, diffs or raw
tool input. The canary tests (`protocol/__tests__/canary-sweep.test.ts`,
`drivers/acp-driver-core/__tests__/lost-process.test.ts`) enforce this for
the service log.

The shared writer passes every string value that contains a space or a
line break through `redact()` (`shared/redact.ts`), in both logs. A string
with no space or line break (an id, a path, a name, a kind) is written
unchanged, including a 32-character hex session id that `redact()` alone
would replace. A secret stored alone as a whole field value is not caught;
this is accepted.

### Diagnostic log

`.workflow/work/acp-diagnostic.log` sits beside the service log. The entry
point creates it with `createDiagnosticLog` (`shared/diagnostic-log.ts`)
before it builds the driver catalog, and the catalog hands it to every
driver. It is always on; no setting turns it off.

- One JSON line per failure, event `agent_failure`, level `error`. The file
  is created owner-only (`0600`; not checked on Windows).
- Capped at 1 MiB. When the next record would pass the cap, the file is
  renamed to `acp-diagnostic.log.1`, replacing any earlier copy. At most
  those two files exist. A record larger than the cap is written alone
  after the rename.
- At start-up the service logs the path once (`diagnostic_log_ready`, field
  `path`). If the file cannot be opened, the service still starts, logs one
  warning in the service log (`diagnostic_log_unavailable`, field `code`)
  and writes no records. A later write failure is logged once
  (`diagnostic_log_write_failed`, field `code`) and does not affect the
  turn. Nothing goes to stderr.
- A record is one JSON line. The fields are:

  | Field            | Meaning                                                 |
  | ---------------- | ------------------------------------------------------- |
  | `ts`             | When the record was written (ISO 8601)                  |
  | `level`          | Always `error`                                          |
  | `event`          | Always `agent_failure`                                  |
  | `kind`           | What failed; one of the kinds below                     |
  | `message`        | The error text the user saw, without the agent's output |
  | `driver`         | The driver's name                                       |
  | `pid`            | The agent's process id, when a process started          |
  | `agentSessionId` | The agent's session id, once the agent has named one    |
  | `exitCode`       | The exit code, when the agent exited with one           |
  | `signal`         | The signal, when a signal ended the agent               |
  | `tail`           | The last lines the agent printed, redacted              |
  | `model`          | The model the agent reports as selected, once known     |

- The kinds are the `AGENT_FAILURE_KIND` constants
  (`drivers/acp-driver-core/errors.ts`):

  | Kind               | Failure                                              |
  | ------------------ | ---------------------------------------------------- |
  | `exited`           | The agent exited or crashed                          |
  | `protocol`         | The agent broke the protocol or closed its output    |
  | `requestError`     | The agent answered a request with an error           |
  | `authRequired`     | The agent needs a login                              |
  | `setupTimeout`     | A start-up step did not answer in time               |
  | `notStarted`       | The command was not found or could not be started    |
  | `refused`          | The service refused the agent (a check or a setting) |
  | `modelUnavailable` | The agent does not offer the model (new session)     |
  | `handlerFailed`    | Handling a request from the agent failed             |
  | `cancelTimeout`    | The agent did not stop within the cancel deadline    |

- A record joins to the service log through `agent_session_linked` (IDE
  session id and agent session id) and `agent_process_ended` (pid and agent
  session id). A failure before the agent names a session joins by pid and
  time.

### Cancel logging

| Event                | Level | Fields                                           |
| -------------------- | ----- | ------------------------------------------------ |
| `cancel_requested`   | info  | `sessionId`; only when an active turn is aborted |
| `turn_cancelled`     | info  | `sessionId`; `failureKind` when the driver threw |
| `close_failed`       | warn  | `failureKind` only                               |

After an abort, `governance_outcome` is always `action: deny`,
`reason: cancelled`, at info level. `answeredBy` is `cancel` when the
call was refused at once or the ask itself failed or came back invalid,
and `user` for a late answer. `cause` (`ask_failed` or `invalid_answer`)
is added only when the ask itself failed.

`failureKind` is one of `provider_quota`, `provider_auth`,
`session_collapse`, `internal`. No prompt text, partial text, error
messages, diffs or titles appear in any of these entries.

`.workflow/work/acp.log` is transient runtime state and is not
version-controlled.
