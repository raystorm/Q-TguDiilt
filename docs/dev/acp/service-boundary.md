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
config, the profile names and the registry are each loaded once at startup,
in that order, and the catalog is built before the server connects. A
missing or malformed config, a profile names file that fails, or a registry
or catalog that fails (missing file, unknown key, entry without `module`,
profile entry without `model`, empty `drivers:`, every driver failing,
defaults that select no working driver), fails closed before any request is
served. The registry failure is logged at error level as
`registry_startup_failed` with the registry path, and the process exits
non-zero. The registry path comes from one lookup function
(`protocol/registry-location.ts`): `registry.yaml` in the drivers folder,
found from the service's own files, with no launch-time setting.

The profile names come from `.workflow/rules/_PROFILES.md`, found the same
way by `profilesPath()` in `protocol/profiles-location.ts`. A test replaces
that function, as it does the registry lookup. A names file that is missing,
cannot be read, or lists an alias twice (capitals ignored) throws
`ProfileError`. It is logged at error level as `profile_names_startup_failed`
(`filePath`, `problem`) before the registry is read, and the process exits
non-zero. After the registry loads, each `profiles:` key that is not an exact,
case-sensitive canonical name logs one warn `profile_key_unknown` (`key`);
an alias or a different case warns too, and the service keeps starting. The
agent reads the changeover files under `process.cwd()`, which the entry point
passes as `workDir`.

## Transport

stdio, JSON-RPC 2.0, newline-delimited JSON (`ndJsonStream` from the
SDK). A JetBrains IDE launches the entry point as a subprocess via
`~/.jetbrains/acp.json`. The entry point wires SDK methods
(`initialize`, `session/new`, `session/load`, `session/prompt`,
`session/cancel`) to boundary handlers; on stdin EOF it disconnects.

## Translation seam (`agent.ts`)

The seam is deliberately narrow: **one turn maps to exactly one
`driver.execute(...)`**. A `session/prompt` runs one turn, or several when
changeover steps follow (see "Changeover step").

- Inbound ACP prompt content (text blocks) is concatenated into a single
  command string.
- `driver.execute(command, options)` runs the step on the session's
  driver (`catalog.get(record.driver)`), with the session's model in
  `options.model` (`auto` included). If the session has a prior driver
  session, its id is passed via `options.sessionId`. A profile activation
  that changes the driver drops the id first (see "Profile activation"), so
  the id is only ever used with the driver that issued it.
- `options.onUpdate` is supplied on every turn. The agent's text and tool
  calls reach the client as the driver reports them (see "Streaming" and
  "Tool-call cards"). `DriverResult.text` is sent once at the end only
  when the driver streamed no text.
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
- A turn returns its stop reason (`end_turn`, `cancelled` after a cancel,
  or an abnormal-end reason, see "How a turn ends") only after every
  update was delivered. A turn with no text and no tool calls sends no
  update.

An empty prompt (no text content) is rejected with a clear error.

## Streaming

Agent text and tool calls reach the client while the turn runs. `prompt`
gives the driver an `onUpdate` callback (the driver side is in
`acp-driver-core.md`) and sends each update as a `session/update`.

- **Order.** Every `session/update` the service sends in a prompt goes
  through one update sink (`update-sink.ts`), created per prompt. Sends
  leave in the order they were queued and each waits for the one before
  it to settle, so a slow client cannot reorder them. Nothing the service
  writes itself (an ask detail, an outcome) overtakes an earlier agent
  update.
- **Asks keep their place.** When the driver reports a tool call, the
  handler takes its place in the sink's order at once. Agent updates that
  arrive while governance and the user decide leave after the ask detail
  and the approval request, not before.
- **Fallback.** A driver that never calls `onUpdate` still conforms: its
  `DriverResult.text` is sent once, at the end. Text a driver streamed is
  never sent again. A turn with no text sends no text chunk.
- **Flush.** `prompt` returns or rejects only after every queued update
  was delivered or dropped, so a failure reaches the client after what
  the turn produced.
- **Delivery failure.** The first failed send in a prompt is logged once
  as `update_delivery_failed` (warn; `sessionId` and `failureKind` only,
  never the error text), and every later send in that prompt is dropped.
  The turn carries on to its end, and a failed send no longer fails the
  prompt. If the detail of an ask cannot be sent, the approval request is
  not sent and the call is denied (`ask_failed`).
- **After the turn.** The sink closes when the prompt ends. An update a
  driver sends after `execute` settled is ignored.
- **Warnings.** The warning for an unsafe setting is part of the turn
  text. Found between turns, it is the first text of the next turn; found
  during a turn, it appears where it happened.
- **No placeholder.** The `Working on it...` message is gone. A reply
  starts with the notice, if there is one, or with the agent's first
  update.

Updates and cards write no log entries of their own.

## How a turn ends

`DriverResult.end` says why the agent ended the turn; absent reads as
`completed`. The service maps it to the stop reason the IDE receives:

- `completed` → `end_turn`.
- `output_limit` → `max_tokens`, after the line "The agent stopped because
  it reached its output limit; the reply may be cut off."
- `request_limit` → `max_turn_requests`, after the line "The agent stopped
  because it reached its limit on requests in one turn; the work may be
  unfinished."
- `refused` → `refusal`, after the line "The agent refused to continue
  this turn."

The line is sent after the turn's text and before the response, and the
end is logged as `turn_ended_abnormally` (info; `sessionId` and `end`
only). The session stays usable.

- **Cancel wins.** A turn that was cancelled and also ended abnormally
  returns `cancelled`, sends no line, and logs both entries.
- **Normal end.** A normal end is a `completed` turn that was not
  cancelled. Only a normal end clears the record's `notice`, which stops
  it from leading the next replies. An abnormal end, a cancel and a
  failure keep the notice.
- **The agent stops by itself.** An agent that cancels a turn we did not
  cancel, or ends it with a stop reason the driver does not know, makes
  the driver throw `AgentStopReasonError`, naming the reason. The prompt
  fails like any driver failure (`prompt_failed`), the text already shown
  stays, and the session stays usable.

## Tool-call cards

Every tool call the driver reports through `onUpdate` is a card in the
chat, in order with the text, including calls that never ask (read,
search, think) and calls a rule decides. `cards.ts` keeps the card state
for one turn and drops it when the turn ends, so nothing crosses turns.

- **Announce and update.** The first update for a call is an ACP
  `tool_call`; later ones are `tool_call_update`s that carry only what
  the driver update carried. A report for a call whose card was never
  sent announces the card first. The card id combines the service's turn
  counter with the agent's call id, so an agent that reuses a call id in
  a later turn, or in a new downstream session, gets a different card.
- **What a card shows.** The kind, the agent's title (`Tool call` when it
  has none), the status (`running` is sent as `in_progress`), and for a
  command or file call the command (as `rawInput: { command }`) or the
  paths (as locations). That is what governance matched, so a title that
  says something else cannot hide it. A card never carries a diff, other
  raw input or content blocks.
- **Outcome.** When governance has finished with a call, the card's title
  becomes `<agent title> - <outcome>`, in one update that carries only
  the title and, for a failure, the status:
  - `approved by governance`: a rule approved the call.
  - `denied by governance`: a rule denied it, or the report was unusable.
    The status is `failed`.
  - `allowed by you`, `rejected by you`: the user's answer to an ask. A
    rejection sets the status `failed`.
  - `cancelled`: the turn was cancelled, or the IDE answered the ask
    cancelled.
  - `Approval process errored: request denied`: the answer was not
    understood or the ask failed, so the call was denied. The status is
    `failed`.
- A later title from the agent keeps the outcome, once. The outcome never
  goes into the card's content, which would erase what the IDE shows. If
  the sink is dead (see "Delivery failure"), the outcome is not seen.
- **The ask.** See "Ask flow". The detail goes on the call's card and the
  approval request names it.

## Session lifecycle & mapping

The session store (`session-store.ts`) maps **each ACP session to
exactly one `workflowId`** and tracks:

- `workflowId` — generated on `session/new`; distinct sessions get
  distinct workflows.
- `driverSessionId` — the driver's continuity id, updated after each
  turn.
- `driver` and `model` — resolved when the session opens, and again by each
  profile activation.
- `profile` — the canonical name of the profile the last applied activation
  found. A new or reopened session has none until one is applied.
- `notice` — the one chat line the next turn leads with. Cleared when a turn
  ends normally (see "How a turn ends").
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
completes. A session never runs two turns at once. The flag is set before
a profile activation is resolved and cleared after the turn, so resolution,
the release of an old driver session and the turn are one step.

### Driver selection and the notice

The session store does not choose the driver. `newSession` and
`loadSession` call `resolver.resolve()` with no profile, before any record
exists. Only a prompt that holds a profile activation resolves again (see
"Profile activation"), so the driver and model change under a session only
through an activation. If the catalog has no driver of that name, `prompt`
rejects before the turn starts and the session stays free.

When the catalog has a notice (the preferred driver or model cannot be
used), the first `agent_message_chunk` of a turn carries it, before any
other update, for new and reopened sessions alike. It repeats on every
turn until one turn of that session ends normally (see "How a turn
ends"). A cancelled, failed, rejected or abnormally ended turn does not
count. Opening a session sends nothing. Without a notice the updates are
unchanged. A profile activation sets the notice again, as described next.

### Profile activation

`applyActivation(record, command)` in `agent.ts` applies the profile a
prompt activates. `prompt` calls it after the active-turn flag is set and
before it fetches the driver; it does not touch the flag. The user's text
reaches the driver unchanged.

- **Finding.** `detectActivation` (`protocol/workflow-command.ts`) looks for
  a command: the whole word `@name` or `/name` anywhere in the text, or
  plain `as` at the start of the text. The commands are `as`, `dr`, `epr`,
  `start` and `receive`. The first one found decides, and case is ignored.
  After `as`, the next word minus one trailing `,.:;` is the name. Any other
  word is ignored without a log entry.
- **Shortcuts.** `@dr` is Doctor and `@epr` is Enforcer, from a two-entry
  table (`SHORTCUT_PROFILES`) in `workflow-command.ts`. Each shortcut is a
  saved prompt that activates one fixed profile, and the service cannot see
  inside the prompt. With the changeover commands, this table is the only
  fixed workflow vocabulary in the service. A new profile-activating prompt
  needs a new entry.
- **Changeover.** `@start` reads `HANDOFF_PATH` and `@receive` reads
  `MESSAGE_PATH`, two constants in `workflow-command.ts`
  (`.amazonq/work/current/HANDOFF.md` and `MESSAGE.md`), under `workDir`.
  `readChangeoverTarget` returns the first non-empty line under an exact
  `## To` heading, read at every command and never cached. It never throws:
  a missing file or no such line finds no profile. The path never comes
  from the command text.
- **Names.** `ProfileNames.resolve` returns the canonical spelling of a name
  or alias, ignoring case, from the file loaded at startup. A word that is
  not a name, or no target, logs `profile_unknown` and changes nothing.
- **Applying.** The resolver is called with the canonical name. A throw
  leaves the record as it was, and the prompt fails with an error that
  begins `profile "<name>": `. Otherwise, a different driver releases the
  old driver session first (`release`, awaited) and drops the continuity id;
  the new driver starts a session with this turn. The same driver keeps the
  id, and the model switches on the existing session. A release that fails
  is logged as `release_failed` and the turn goes on. Then the record gets
  the driver, model and profile. A model the agent does not offer fails the
  turn with the existing `ModelUnavailableError`, and the record keeps the
  new choice.
- **Notice.** Every resolution sets `notice`. A result with a `substitution`
  gets one line: `Profile "<p>" asks for [driver "<d>", ]model "<m>"; using
  driver "<d2>", model "<m2>" (<reason>).` A result that matches its entry
  has none. A profile with no entry resolves to the registry defaults and
  gets the catalog's notice again. The line leads the next replies until a
  turn ends normally; a new resolution replaces it.

Profile events, all in `.workflow/work/acp.log` and logged after the
activation was applied. The prompt text is never logged; an unknown name is
redacted and cut to 64 characters.

| Event                          | Level | Fields                                  |
| ------------------------------ | ----- | --------------------------------------- |
| `profile_unknown`              | info  | `sessionId`, `source`, `reason`, `word` |
| `profile_activated`            | info  | `sessionId`, `profile`, `source`        |
| `profile_reactivated`          | warn  | `sessionId`, `profile`, `previous`      |
| `profile_switched`             | warn  | `sessionId`, `profile`, `previous`      |
| `release_failed`               | warn  | `sessionId`, `failureKind`              |
| `profile_names_startup_failed` | error | `filePath`, `problem`                   |
| `profile_key_unknown`          | warn  | `key`                                   |

- `profile_unknown`: `source` is `prompt` or `changeover`; `reason` is
  `unknown name` or `no target`; `word` is set for an unknown name only.
- `profile_activated`: logged for a changeover activation only, with
  `source: changeover`. The switches `@start` and `@receive` make are
  expected, so they log nothing else.
- `profile_reactivated`: a user activation while the session already has a
  profile; `previous` is that profile. `profile_switched` is added when the
  new profile differs. A first user activation logs neither.

Every resolution is also logged by the resolver (`dispatch_resolved`, with
the profile and the source).

### Changeover step

After a turn that ended normally, the service can move the workflow to the next profile on its
own. That is a changeover step. `prompt` wraps its turns in `runLoop` (`agent.ts`), which
repeats steps until one cannot be taken. `runTurn` runs one turn: the notice, one
`driver.execute`, and the text the driver did not stream. All steps of a prompt run under the
prompt's one active-turn flag, abort signal and update sink, so the IDE sees one long prompt.
The steps keep no state of their own, and there is no off switch and no hop cap.

After each turn:

- A turn that was cancelled stops the steps (`cancelled`). A turn that ended abnormally stops
  them (`abnormal_end`). A failed delivery to the IDE stops them (`failed`), because they
  would otherwise run unseen. The abort signal is read after every wait.
- If the last command was a handoff (typed by the user, found by `detectHandoff`, or sent by
  the service), `checkHandoff` runs, then `applyActivation(record, '@start', { fresh: true })`.
  `@start` always runs in a fresh downstream session. The old one is released after the
  profile is resolved. A profile that cannot be resolved keeps the old session.
- Otherwise `parseCompletionBlock` reads the turn's text. One distinct known target sends
  `@handoff to=<Profile>` (canonical name) in the same session. Anything else stops.

Each command the service sends is shown first as its own paragraph, "Changeover: sending
`<command>`", and reaches the provider as plain prompt text. The service gives no approvals.
An ask uses the existing ask flow and the service waits for the user.

**Completion block.** The block is the last line that begins with `**Next**` at its first
character, and every line after it. Lines between triple-backtick fences are ignored. Only
single-backtick code spans are read; text outside a span, bold and headings are never read.

- A span is a handoff suggestion when it starts with `@handoff` or `/handoff` (any case, whole
  word). It is a side trip when it starts with `@send` or `/send`. Side-trip spans never
  continue the steps.
- The profile name is what follows `to=` (any case), or the rest of the span when there is no
  `to=`. `@handoff Planner` and `@handoff to=Planner` are the same suggestion. One trailing
  `,` `.` `:` or `;` is removed. Names match profile names and aliases exactly, ignoring case.
  There is no fuzzy matching.
- Stop reasons, in order of testing: no handoff and no send span is `no_suggestion`. Send
  spans only is `no_target`. Two or more distinct suggestions is `several_suggestions`; a bare
  span counts as one. One bare span is `no_target`. One unknown name is `unknown_profile`.

**Handoff check.** Before `@start`, `checkHandoff` (`protocol/handoff-check.ts`) requires that
the file was modified at or after the start of the handoff turn (modification time only), that
`## To` names a known profile, and, for a handoff the service sent, that it is that profile.
A typed prompt counts as a handoff when `@handoff` or `/handoff` is a whole word anywhere in
it. Its arguments are not read.

**Stop reasons.** One vocabulary in code, chat and log: `no_suggestion`, `several_suggestions`,
`no_target`, `unknown_profile`, `handoff_not_written`, `abnormal_end`, `failed`, `cancelled`.
The first four come from the completion block.

- `several_suggestions`, `no_target`, `unknown_profile` and `handoff_not_written` each send one
  chat line. The unknown name is shown as the agent wrote it, cut at 64 characters.
- `abnormal_end` and `failed` send "The changeover loop stopped." only when the service sent a
  command in the prompt, or the prompt was a typed handoff.
- `no_suggestion`, `cancelled` and a failed delivery send no line.

**Profile hop.** `profileHop` counts profile changes. A `@handoff` and its `@start` share one
number. A typed handoff's `@start` is hop 1.

| Event             | Level | Fields                                             |
| ----------------- | ----- | -------------------------------------------------- |
| `changeover_sent` | info  | `sessionId`, `from`, `to`, `trigger`, `profileHop` |
| `loop_stopped`    | info  | `sessionId`, `reason`, `profileHop`, `word`        |

`changeover_sent` is logged once per command sent; `from` is left out when the chat has no
profile yet, and `trigger` is `handoff` or `start`. `loop_stopped` is logged once per prompt
that reached its first turn; `word` is set for an unknown profile, redacted and cut at 64
characters. Neither holds agent text.

**Late tool calls.** A tool call a driver reports after its turn ended is denied without
evaluation and logged as `governance_outcome` with `reason: turn_ended` (see "Failure
handling").

**Extension points.**

- `protocol/completion-block.ts`: the grammar above (`parseCompletionBlock`).
- `protocol/handoff-check.ts`: the check before `@start` (`checkHandoff`).
- `detectHandoff` in `protocol/workflow-command.ts`: what counts as a typed handoff.
- `runLoop`, `runTurn` and `applyActivation` in `protocol/agent.ts`: the steps.

The parser and the check take the profile names from the same source as profile activation.
The service sends plain prompt text, so a skill or custom tool is reached through the agent
(which expands the saved prompt) or through a driver (see `extending-drivers.md`). The steps
need no change for either.

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
  aborted, whatever the result holds. Text already shown stays and is not
  repeated; partial text a driver did not stream is sent once.
  `turn_cancelled` is logged, and the prompt returns
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

1. A detail `session/update` carrying the full specifics — command, file
   paths, diff/patch, tool parameters — as an `AskDetails` payload. It
   also carries `kind`, `agentTitle` (the agent's title, labelled as
   display text and never used as a command), and `note` when governance
   could not evaluate. For a call with an id it is a `tool_call_update`
   on the call's card, with no title or status, so the card keeps its
   title. For a report with no id it is a `tool_call` of its own, with an
   id the service makes (`status: 'pending'`, titled with the command, or
   `Requested action`); that card gets no outcome, and a report with no
   id that a rule decides gets no card.
2. The approval request (`session/request_permission`) with allow/reject
   options. It names the card (`toolCall.toolCallId`), so the IDE ties the
   question to the call. The exported `ask()` helper sends the card of its
   own without an id, and its request names no card.

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
| Tool call after the turn ended          | deny; not evaluated       | `turn_ended`       |

There is no timeout and no retry. The IDE's error text is never logged.
A tool call reported after its turn ended is logged at info level with `answeredBy: failure`.

After a cancel, failures are part of the cancel:

| Situation                               | Result                  | Logged                                   |
| --------------------------------------- | ----------------------- | ---------------------------------------- |
| Driver throws after the abort           | `stopReason: cancelled` | `turn_cancelled` with `failureKind`      |
| Open ask ends after the abort           | deny                    | `governance_outcome`, reason `cancelled` |
| Ask fails or answer invalid after abort | deny                    | same, with `cause`                       |
| An update cannot be delivered           | turn carries on         | `update_delivery_failed`                 |
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

`ProfileError` (`errors.ts`) is a start-up error with no `kind`: the profile
names file is missing, cannot be read, or lists an alias twice. Its message
says which, and names the file.

`boundaryErrorKind(err)` maps quota/auth/collapse to their `kind`;
anything else is treated as generic `internal`. Transport,
malformed-message, unknown-method, and protocol-version errors are
handled by the SDK, not the boundary.

A model **refusal is not an error**: the turn returns `stopReason:
'refusal'` after a chat line (see "How a turn ends"). No secrets or raw
prompt text are written to logs.

## Known limits

- **One handoff file.** There is one `HANDOFF.md` per working folder. Two chats that take
  changeover steps at the same time share it.
- **Session id after an agent's own stop.** When the agent cancels a turn
  by itself, or ends it with a stop reason the driver does not know, the
  driver throws and the service never learns that turn's downstream
  session id. After a first turn (a reopened chat counts as a first
  turn), the next prompt starts a new agent session, so the conversation
  context is lost, and the old agent process stays up and idle until the
  chat disconnects. Later turns are not affected: the chat keeps the id
  from an earlier turn. The case is rare and has not been checked against
  a real agent. Planned fix: the error carries the session id and
  `prompt` links it before it rethrows.

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
