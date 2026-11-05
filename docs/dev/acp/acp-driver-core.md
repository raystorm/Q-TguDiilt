# The ACP Driver Core

The ACP driver core is the shared `Driver` that talks the Agent Client
Protocol (ACP) to a downstream agent such as Kiro or Copilot. Here the
service is the ACP client and the agent is the server. The code lives in
`.workflow/acp/drivers/acp-driver-core/`.
A concrete driver is a thin file: it supplies the agent's launch command
line and, optionally, checks for that agent. Everything else is shared,
and the core contains no agent-specific code.

The Kiro and Copilot drivers (`drivers/kiro-driver-acp.ts` and
`drivers/copilot-driver-acp.ts`) are the shipped drivers, and the
examples to copy for a new ACP agent.

## A driver over the core

`createAcpDriver(deps)` takes an `AcpDriverDeps`:

| Field            | Meaning                                                 |
| ---------------- | ------------------------------------------------------- |
| `name`           | The driver's name, as the protocol layer reports it     |
| `connect`        | Starts one agent process; injected so tests use a fake  |
| `launch`         | The agent's command and arguments; cwd is the service's |
| `policy`         | Optional checks run during setup (see "Driver policy")  |
| `unsafeSettings` | Optional list of agent settings to refuse (see below)   |
| `logger`         | The service logger                                      |
| `diagnostics`    | Where failures of the agent are recorded (required)      |

Each shipped driver uses the real connect by default; tests pass a fake.
The core touches an agent process only through one small interface, so a
fake agent can replace the process entirely.

The service does not build these drivers itself. The Driver Catalog loads
each driver from the module the driver registry names (`createDriver({
logger, diagnostics })`), and the protocol layer takes drivers only from
the catalog. On disconnect the service calls `closeAll()` on the catalog, which closes
every driver and so ends every agent process it started. One failing
`close` does not stop the others, and the first failure is rethrown last.

## Sessions and processes

- One agent process per downstream session. It starts at the first prompt
  (no `options.sessionId`) and is reused by later turns that pass the
  downstream session id. Two sessions never share a process.
- An unknown downstream session id raises `SessionCollapseError`. It is
  never silently replaced by a new session.
- `close()` ends every process the driver started, once, however often or
  concurrently it is called.
- `release(sessionId)` ends the process that serves that session, once. The
  session leaves the driver first, so a turn that follows raises
  `SessionCollapseError` at once. An unknown, empty or released id resolves
  and does nothing, and logs nothing. A release is not a loss: it writes no
  diagnostic record, and the next launch is not logged as a relaunch. After
  `close()` (or before it) the ending already running is shared, so the
  process is ended once. The caller never releases during a turn.

## Setup

1. `connect` starts the process.
2. `initialize` with `clientCapabilities: {}`. Nothing is advertised, so
   the agent cannot ask the client to read files or run terminals; such
   requests get an error response. The answer is checked: the protocol
   version must match.
3. `session/new` with the service's absolute working directory and no MCP
   servers. The answer must name a session.
4. `session/prompt`.

Each of steps 1 to 3 has its own `SETUP_TIMEOUT_MS`. The turn itself has no
timeout. An abort or `close()` during setup is seen when the step returns,
never interrupts it; the process is then ended and the turn settles
`cancelled` with an empty session id. A step that never answers ends the
process and fails the turn with `AgentSetupTimeoutError`.

## Results

- The result text is the agent's message text only. Thought, plan, mode
  and non-text chunks are ignored. With `onUpdate` it equals the text
  updates joined.
- `sessionId` is the downstream session id.
- There is no `cancelled` key unless our own abort fired.
- `end` says why the agent ended the turn. `end_turn` is a normal finish
  and leaves `end` out (it reads as `completed`); `max_tokens` is
  `output_limit`, `max_turn_requests` is `request_limit`, `refusal` is
  `refused`.
- Our abort wins: a turn whose signal aborted is `cancelled` whatever the
  agent says.
- Otherwise any other stop reason fails the turn with
  `AgentStopReasonError`: `cancelled` without our abort ("the agent
  cancelled the turn on its own"), any other value, or none. The message
  names the reason, through redaction. It is not a process failure: the
  agent is not ended, no diagnostic record is written, and the session
  stays usable. Known limit: the error carries no session id, so the
  service does not learn the downstream session id of that turn (see
  "Known limits" in `service-boundary.md`).
- A `session/update` that names another session is ignored.
- `options.context` is prepended to the prompt text with a blank line
  between.
- `options.model` is applied through the agent's model config option
  (`session/set_config_option`, category `model`) after `session/new` and
  before the prompt, only when it differs from the current value, and only
  on that option. Choosing the model is the dispatcher's job. `auto` is
  never an error. Any other model the agent does not offer rejects with
  `ModelUnavailableError`, the agent is ended, and nothing is substituted.

## Updates

`options.onUpdate`, when given, receives what the agent produces, as it
arrives:

- One `{ type: 'text', text }` per non-empty agent text chunk.
- One `{ type: 'tool_call', id, ... }` per `tool_call` or
  `tool_call_update` message, carrying only what that message carried:
  `kind` (the report kinds, `other` for any other), `title`, `status`
  (`pending`, `running` for the agent's `in_progress`, `completed`,
  `failed`; any other status is left out), `command` and `paths`. The
  command and paths are read as for a report. The diff, other raw input
  and content are never passed on. A message with no usable id gives no
  update.
- Not forwarded: thoughts, plans, mode and command lists, usage, non-text
  content, and any update that names another session.
- The callback belongs to its turn. It is called only while the turn runs,
  never after `execute` settles. A throw from it is ignored and never
  fails the turn; later updates still arrive.
- Order is the agent's. The update for a call comes before the permission
  request for the same call, and text keeps arriving while the handler
  waits.

## Permission requests and tool-call reports

- The agent's stream (`tool_call`, `tool_call_update`) is recorded per
  turn in a table keyed by the exact tool-call id. A permission request
  is matched to its record by exact id only, the record is used once, and
  the table is emptied at the start and end of every turn. Nothing
  correlates across turns, and titles never correlate.
- The report for a request is built from the merged record (latest values
  win; an omitted field keeps the earlier one) and the request. A request
  with no record is reported from the request alone, with kind `other`
  when it names none.
- Id: the report carries the request's `toolCallId` as `id` when it is a
  non-empty string. Otherwise the report has no `id` key.
- Kind: the nine report kinds; anything else, including `switch_mode`, is
  `other`.
- Command: only `rawInput.command`, exactly as received. If `commands` is
  present it must be exactly `[command]`; any other shape leaves the
  command missing, so governance denies. The title is never used as the
  command.
- Paths: locations first, then diff blocks, each once, as given and not
  normalised. Empty and blank paths are skipped. Diff text is
  `--- path / old / +++ path / new` per diff block.
- Answering: the handler is called once per request and the answer is sent
  after it settles. `approve` selects the first `allow_once` option and
  `deny` the first `reject_once`, by kind only, never by id or name. An
  approve with no `allow_once` falls back to `reject_once`, otherwise the
  request is cancelled. `allow_always` and `reject_always` are never
  selected. A fallback is logged.
- A request that names another session, arrives with no turn in flight, or
  arrives after the connection died is answered cancelled and never
  reaches the handler. A handler that throws or rejects fails the turn
  with its error, answers the request cancelled, and ends the process.
- A malformed permission request is answered by the SDK itself with an
  invalid-params error; our handler is not reached.
- The notification handler is registered before the request handler,
  because the SDK tries handlers in registration order and a tool call
  must reach the table before a request sent right after it.
- A tool call of kind edit, delete, move, execute, fetch or other that runs
  (in progress or completed) with no permission request is logged once as
  a warning (`governance_unrequested`). Read, search and think are not.

## Cancel and the wind-down deadline

- On an abort during a turn the core sends `session/cancel` once, keeps
  consuming updates until the prompt returns, and settles `cancelled`
  with all the text received. The result is `cancelled` whatever the
  prompt returned: any stop reason, an error answer, a lost connection. A
  failure that arrives after the abort is logged by kind only
  (`agent_failure_after_cancel`).
- Permission requests around an abort: a request still waiting on the
  handler is answered cancelled at once and the handler's late answer is
  discarded, an approve included; the recorded decision stays `deny`. A
  request that arrives after the abort is answered cancelled and the
  handler is not asked.
- `CANCEL_DEADLINE_MS` counts from the abort, and a second abort does not
  restart it. If the agent has not answered the cancel by then: warning
  `agent_cancel_deadline`, the connection is marked dead, the ending
  sequence starts in the background (reason `deadline`), and the turn
  settles `cancelled` with the text so far. The next prompt launches a new
  process (`agent_relaunched`, `after: deadline`); an old downstream
  session id raises `SessionCollapseError`. `close()` waits for a
  sequence already running and does not start a second one.
- An agent that answers in time is never killed; the session and its
  process stay for the next turn.

## Ending an agent

The core ends an agent in stages. It closes stdin; if the process still
runs after `ENDING_TERM_DELAY_MS` it sends SIGTERM to the process group;
if it still runs `ENDING_KILL_DELAY_MS` later it sends SIGKILL to the
group; it then waits up to `ENDING_EXIT_WAIT_MS` for the exit. This runs
once per process however often it is requested, and an already exited
process is never touched.

Only group signals are used. A process an agent starts outside its own
process group (for example with `setsid`) is not ended. Windows is best
effort and untested.

## Failures

The core raises typed errors:

| Error                    | Meaning                                           |
| ------------------------ | ------------------------------------------------- |
| not found                | The command is missing: install it or fix PATH    |
| launch error             | The process could not be started                  |
| exited unexpectedly      | Exit code or signal, plus the agent's last output |
| request error            | Which request failed and the agent's message      |
| protocol error           | Version mismatch, or a session was not named      |
| `AgentSetupTimeoutError` | A setup step did not answer in time               |
| `ModelUnavailableError`  | The agent does not offer the requested model      |

- Authentication: Kiro's "not logged in" text on stderr at exit, and the
  ACP "authentication required" error (code -32000) from any request,
  become the protocol layer's `ProviderAuthError`. The message tells the
  user to log in with the agent's own login command. The core never calls
  `authenticate` and advertises no capability.
- A process that exits when nobody asked it to kills the connection:
  whatever waits on it fails with the exit error, and the session is gone.
  A later prompt with that session id raises `SessionCollapseError`; a
  prompt without a session id launches a new process. There is no
  auto-resume.
- A request that fails because the connection closed (not because the
  agent answered with an error) waits up to `OUTPUT_END_GRACE_MS` for the
  exit, because the agent's output ends before the exit is reported. An
  error answer from the agent is explained at once.
- The end of the agent's output while the process still runs is a dead
  connection: after the grace the turn fails with the agent's last words
  in the message, the process is ended (reason `protocol_failure`), and
  the session is gone.
- The stderr tail keeps the end of the output, at most
  `STDERR_TAIL_MAX_LINES` lines and `STDERR_TAIL_MAX_BYTES` bytes, cut at
  a line start. The real process handle resolves `exited` after stdio has
  closed, so the tail is complete.
- Known limit: the "not logged in" text match is agent-specific behaviour
  inside the core. Letting a driver inject its own login-failure detection
  as data, like `unsafeSettings`, is backlogged.

### Redaction

Redaction is a safeguard, not a guarantee; the warning users see is in
`docs/user/acp-agents.md`. The stderr tail in an error goes through the
service's redaction. It covers:

- values after the words token, key, credential and security (plural, any
  case) when joined by `:` or `=` (any value) or by a space (a value of 6
  or more characters with a digit)
- `Bearer` values
- GitHub tokens (`ghp_` and siblings, `github_pat_`)
- AWS key ids (`AKIA`, `ASIA`)
- JWTs (they start with `eyJ`)
- `sk-` keys
- private key blocks, also when cut short
- any run of 32 or more base64 or hex characters that holds a digit and a
  letter

It misses, on purpose or by design: short secrets with no marker word,
secrets in a form not listed, secrets the agent splits over several lines
(other than key blocks), and secrets written after a plain space with no
digit. The service log never holds the agent's output or error text; that
goes only in the diagnostic log. This redaction is for text that reaches the
user and the diagnostic log, and the shared writer redacts free text again
in both logs.

## The real connect

The real connect starts the agent with an argument array and no shell, in
the service's directory. On POSIX the agent leads its own process group.
The Windows tree-kill path is best effort and untested.

- stderr is always drained, so a noisy agent never blocks. Output before a
  consumer registers is kept (bounded) and replayed.
- `exited` resolves after stdio has closed. If a holder of the pipes
  outlives the process, it resolves after `STDIO_CLOSE_WAIT_MS` anyway.
- When the agent exits, the connect sends one SIGKILL to its process
  group, so children it left behind are ended (a crash, or an exit on
  stdin end). The core itself never signals a process that has exited.
- A line on stdout that is not JSON ends the stream, and a service note is
  added to the stderr tail. The turn then fails and the process is ended.
- A write to stdin after the agent ended is dropped, so a lost agent
  cannot crash the service.

## Driver policy and unsafe settings

`AcpDriverDeps.policy` (`AcpPolicy`) holds two optional checks that return
a refusal reason or nothing: `verifyInitialize` (before `session/new`) and
`verifySession` (before the prompt). A refusal ends the process, creates
no session, and its text is the error message (log reason
`verify_refused`). An abort seen after `initialize` wins over the check.
The Kiro driver checks for the V3 server:
`agentCapabilities._meta.kiro.extensionMethods` must be an array and
`agentCapabilities.sessionCapabilities.list` must be an object. Version
numbers are not used.

`AcpDriverDeps.unsafeSettings` is a list of `UnsafeSetting` (`name`,
`optionId`, `values`). The core refuses at `session/new` when one is on,
warns on a later `config_option_update` once per change, and logs the
change by setting name (`agent_setting_changed`). The warning is a
paragraph of the turn text, reported through `onUpdate` like any text: a
change found between turns is the first text of the next turn, and a
change found during a turn appears where it happened. There is no
callback.
An absent list means no check. Only the Copilot driver passes one.

## Wiring and shutdown

The service's entry point builds only the Kiro driver today. The Copilot
driver is built and tested, but there is no driver selection by name yet.
For the end of the service (stdin end or a termination signal, the exit
codes and `onDisconnect`), see "Disconnect" in `service-boundary.md`.

## Log events

The service log has ids and kinds only. Agent text and stderr go in the
diagnostic log (next section); prompt text, titles, diffs and raw input
are logged nowhere. `agentSessionId` is the agent's session id
(`sessionId` always means the IDE session); `pid` is the operating-system
process id of the agent.

| Event                        | Level | Fields                                          |
| ---------------------------- | ----- | ----------------------------------------------- |
| `agent_setup_aborted`        | info  | `step`, `pid`                                   |
| `agent_relaunched`           | info  | `pid`, `after`                                  |
| `agent_process_ended`        | info  | `pid`, `agentSessionId`, `reason`, `stage`      |
| `permission_option_fallback` | warn  | `agentSessionId`, `wanted`                      |
| `permission_unknown_session` | warn  | `agentSessionId`, `pid`                         |
| `governance_unrequested`     | warn  | `agentSessionId`, `toolCallId`, `kind`, `paths` |
| `agent_cancel_deadline`      | warn  | `agentSessionId`, `pid`, `deadlineMs`           |
| `agent_failure_after_cancel` | info  | `agentSessionId`, `failureKind`                 |
| `agent_session_linked`       | info  | `sessionId`, `agentSessionId`                   |
| `agent_setting_changed`      | warn  | `agentSessionId`, `setting`                     |

- `step` of `agent_setup_aborted` is entry, launch, initialize or
  session_new; it is also written when `close()` stops setup.
- `reason` of `agent_process_ended` is deadline, setup_timeout,
  aborted_during_setup, launch_failure (exit before setup finished),
  crash, protocol_failure, handler_failure, model_unavailable,
  verify_refused, disconnect or release. `stage` is the last stage of the
  ending sequence reached: none, stdin_closed, sigterm or sigkill.
- `agent_session_linked` is the join between the IDE session and the agent
  session; it is logged when the id is new or changed.

## Diagnostic records

The core records failures of the agent through the `diagnostics` seam
(`Diagnostics` in `shared/diagnostic-log.ts`: an optional `path` and a
`record(data)` that never throws). The seam is required. The entry point
creates the real one; tests pass a fake. The fields of a record and the
meaning of its kind are in "Diagnostic log" in `service-boundary.md`.

- One record per agent process, never two for the same failure. The record
  is written before the failure is thrown, so the file is complete when
  the user reads the chat error.
- Recorded: an exit or crash nobody asked for (also between turns), the end
  of the agent's output while it runs, a protocol error, an error answer to
  a request (including authentication required and "not logged in"), a
  setup step that times out, an agent that cannot be started, a refused
  session, an unavailable model on a new session, a failing handler, and
  the cancel deadline.
- Not recorded: a failure the driver caused (a cancel, a requested close,
  an abort during setup), an error with no kind, and a model the agent does
  not offer on an existing session. In that case the agent keeps running;
  models change only at session start and at a profile switch, and a bad
  configured model falls back to `auto`.
- The error message ends with `full record: <path>` for these errors:
  exited, request error, protocol error, authentication, setup timeout,
  command not found and launch error. The line is left out when
  `diagnostics` has no `path`.

## Constants

The values are in the code.

| Constant                     | Meaning                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `SETUP_TIMEOUT_MS`           | How long each setup step (connect, initialize, `session/new`) may take before the agent is ended |
| `CANCEL_DEADLINE_MS`         | How long the agent gets to answer a cancel before it is ended                                    |
| `OUTPUT_END_GRACE_MS`        | How long a request that failed on a closed connection waits for the process exit                 |
| `ENDING_TERM_DELAY_MS`       | How long after stdin closes before SIGTERM is sent                                               |
| `ENDING_KILL_DELAY_MS`       | How long after SIGTERM before SIGKILL is sent                                                    |
| `ENDING_EXIT_WAIT_MS`        | How long to wait for the exit after the last signal                                              |
| `STDERR_TAIL_MAX_LINES`      | Most lines of agent stderr kept for error messages                                               |
| `STDERR_TAIL_MAX_BYTES`      | Most bytes of agent stderr kept for error messages                                               |
| `STDIO_CLOSE_WAIT_MS`        | How long the connect waits for stdio to close after the process exits                            |
| `DISCONNECT_BOUND_MS`        | The longest the service's disconnect may take before it exits with an error                      |
| `DISCONNECT_ERROR_EXIT_CODE` | The exit status when the disconnect failed or took too long                                      |

## Test support

- An in-memory fake ACP agent is a raw JSON-RPC peer with a fake process
  handle that records kills and stdin closes and lets a test control the
  exit and the stderr feed. Fake timers drive every deadline; nothing
  waits in real time.
- Helper files are named `*.helpers.ts`; test files use hyphens.
- A small test-owned stub agent runs as a real process, with scripted
  misbehaviour (exit before initialize, ignoring SIGTERM, leaving
  children behind, garbage on stdout, stderr floods), to test real
  process handling.
- Live runs against the real agents are manual only, because of cost:
  `npm run test:live:kiro` and `npm run test:live:copilot` from
  `.workflow/acp`. Add `-- -t "<group>"` for one group. `LIVE_CASES` is a
  comma-separated list of case files for the adversarial run; empty skips
  it. Results print to the console and are not saved. The canned inputs in
  the normal tests are hand-built from what the live runs showed. Re-run
  both when a tested agent version changes.
