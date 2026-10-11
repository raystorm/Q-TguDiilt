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
translation agent (`createAgent`), a session store, a placeholder driver
(no governed driver is wired yet), the governance engine, and a file
logger, then serves the ACP client. The governance config is loaded at
startup; a missing or malformed config fails closed before any request
is served.

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
- `driver.execute(command, options)` runs the step. If the session has a
  prior driver session, its id is passed via `options.sessionId`.
- `DriverResult.text` → ACP response content (streamed as a
  `session/update` chunk before the final response).
- `DriverResult.sessionId` → stored on the session record for
  continuity across turns.
- `options.onToolCall` is supplied on every turn: the first, a later
  one, and a resumed session. It answers each tool call the driver
  reports through governance (see "Tool-call governance"). A driver
  that does not declare tool-call governance support is rejected before
  any work.
- Each turn streams at least one `session/update` before returning
  `stopReason: 'end_turn'`.

An empty prompt (no text content) is rejected with a clear error.

## Session lifecycle & mapping

The session store (`session-store.ts`) maps **each ACP session to
exactly one `workflowId`** and tracks:

- `workflowId` — generated on `session/new`; distinct sessions get
  distinct workflows.
- `driverSessionId` — the driver's continuity id, updated after each
  turn.
- `activeTurn` — the per-session in-flight flag.

Lifecycle:

- `initialize` — marks the connection initialized.
- `session/new` — creates a session record with a fresh `workflowId`.
- `session/load` — re-establishes a session bound to a supplied
  `workflowId` (resume).
- `session/cancel` — clears the active-turn flag; the only interrupt. A
  cancel with no active turn is an idempotent no-op.
- disconnect / stdin EOF — releases all mappings (`closeAll`), so
  nothing leaks.

### Concurrency: reject-with-retry

Only one turn runs per session at a time. A second prompt while a turn
is in flight throws `TurnInProgressError` (`retryable: true`); the
in-flight turn is unaffected and the client may retry after it
completes.

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

### Outcome logging

After an ask or a failure the handler writes a `governance_outcome`
entry: `sessionId`, `callId`, `action`, `answeredBy` (`user` or
`failure`), and `reason` when there is one. It shares `sessionId` and
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

`.workflow/work/acp.log` is transient runtime state and is not
version-controlled.
