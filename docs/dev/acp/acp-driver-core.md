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

Each shipped driver uses the real connect by default; tests pass a fake.
The core touches an agent process only through one small interface, so a
fake agent can replace the process entirely.

The service does not build these drivers itself. The Driver Catalog loads
each driver from the module the driver registry names (`createDriver({
logger })`), and the protocol layer takes drivers only from the catalog.
On disconnect the service calls `closeAll()` on the catalog, which closes
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
  and non-text chunks are ignored.
- `sessionId` is the downstream session id.
- There is no `cancelled` key unless our own abort fired.
- A stop reason other than `cancelled` (`end_turn`, `max_tokens`,
  `max_turn_requests`, `refusal`) is a normal result.
- An agent that says `cancelled` without our abort is a normal result and
  is logged as `agent_cancel_unrequested`.
- A `session/update` that names another session is ignored.
- `options.context` is prepended to the prompt text with a blank line
  between.
- `options.model` is applied through the agent's model config option
  (`session/set_config_option`, category `model`) after `session/new` and
  before the prompt, only when it differs from the current value, and only
  on that option. Choosing the model is the dispatcher's job. `auto` is
  never an error. Any other model the agent does not offer rejects with
  `ModelUnavailableError`, the agent is ended, and nothing is substituted.

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
digit. The service log never holds the agent's output or error text, only
ids and kinds; redaction is for text that reaches the user.

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
change by setting name (`agent_setting_changed`). There is no callback.
An absent list means no check. Only the Copilot driver passes one.

## Wiring and shutdown

The service's entry point builds only the Kiro driver today. The Copilot
driver is built and tested, but there is no driver selection by name yet.
For the end of the service (stdin end or a termination signal, the exit
codes and `onDisconnect`), see "Disconnect" in `service-boundary.md`.

## Log events

Ids and kinds only. Prompt text, agent text, titles, diffs, raw input and
stderr are never logged. `agentSessionId` is the agent's session id
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
| `agent_cancel_unrequested`   | info  | `agentSessionId`                                |
| `agent_cancel_deadline`      | warn  | `agentSessionId`, `pid`, `deadlineMs`           |
| `agent_failure_after_cancel` | info  | `agentSessionId`, `failureKind`                 |
| `agent_session_linked`       | info  | `sessionId`, `agentSessionId`                   |
| `agent_setting_changed`      | warn  | `agentSessionId`, `setting`                     |

- `step` of `agent_setup_aborted` is entry, launch, initialize or
  session_new; it is also written when `close()` stops setup.
- `reason` of `agent_process_ended` is deadline, setup_timeout,
  aborted_during_setup, launch_failure (exit before setup finished),
  crash, protocol_failure, handler_failure, model_unavailable,
  verify_refused or disconnect. `stage` is the last stage of the ending
  sequence reached: none, stdin_closed, sigterm or sigkill.
- `agent_session_linked` is the join between the IDE session and the agent
  session; it is logged when the id is new or changed.

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
