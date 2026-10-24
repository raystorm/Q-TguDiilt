# Setting up Kiro and Copilot

The ACP service drives a coding agent for you. The service starts the
agent itself, one agent process for each chat session, and ends it when
the chat closes. You do not configure how the agent is launched. You make
sure it is installed and logged in.

The driver registry (see `docs/user/model-dispatch.md`) decides which
agent a chat uses. Its `preferred` entry names the driver and model, and
the shipped example prefers Kiro. A chat gets its driver when it opens and
keeps it. To use Copilot, name it in `preferred`.

> [!WARNING]
> **Secret redaction is not perfect.**
> Some error messages include the last lines the agent printed. Before
> they are shown, the text goes through a pattern-based redaction. It is
> a safeguard, not a guarantee. A secret that matches none of the
> patterns is shown as is, and text that only looks like a secret is
> replaced. The message says "secrets removed, not guaranteed". Read an
> error message before pasting or publishing it. The service log never
> holds the agent's output or error text, only ids and kinds.

## Kiro

- The command `kiro-cli` must be on your PATH. If it is not, the first
  turn fails with "the command was not found"; install it or fix PATH.
- Log in with Kiro's own login (`kiro-cli login`). If you are not logged
  in, the first turn fails with a message that says so, and shows what
  Kiro printed (with secrets removed, not guaranteed).
- The service needs Kiro's V3 ACP server. The latest version tested is
  2.22.0; that is not a requirement. If the installed Kiro does not
  report the V3 markers, the turn fails with a message saying V3 is
  required and how the service launches Kiro. Update `kiro-cli` and try
  again. Nothing is sent to the agent in that case.
- The service never passes a flag that pre-approves tool calls, and never
  sets Kiro's policy preset.
- A tool call asked about through the service is answered with Kiro's own
  "allow once" or "reject once". The service never selects "always
  allow" or "always reject".

### Kiro can run some tools without asking

Kiro still applies its own settings. A rule in your `permissions.yaml`
that allows a command, and Kiro's autopilot option, can run a tool
without asking. In testing, some commands (for example `sleep 30`) ran
without a request while others (`ls`, `touch`) were asked about. The
service cannot see or stop this. When a tool call runs without a request,
the service logs a warning. With default Kiro settings, shell commands
are asked about, so the service's governance rules apply.

## Copilot

The latest version tested is 1.0.98; that is not a requirement.

- The service launches Copilot with `copilot --acp --stdio` and no flag
  that pre-approves or limits tools.
- A session that **starts** with `allow_all` switched on, or in the
  `autopilot` mode, is refused with an error naming the setting. This
  client cannot change it; turn it off in Copilot itself.
- If either is switched on **during** a session, the reply starts with a
  warning paragraph, the change is logged by setting name, and the
  turn goes on.
- Autopilot runs tools without asking. In testing, Copilot in autopilot
  mode ran a shell command and wrote a file with no permission request.
  This service cannot stop it.
- Approvals Copilot has saved, and settings the service cannot see, stay
  an accepted risk on the agent's side, the same limit as Kiro's own
  allow rules.
- Nothing stops an agent changing a call's command after it was approved.

## Model names

The model the dispatcher chooses (from the driver registry) is selected
in the agent by that exact name. If the agent does not offer it, the turn
fails with an error naming the model; fix the name in the registry.
`auto` always works and uses the agent's default.

## When something goes wrong

- **"The command was not found"** — install the agent or fix PATH.
- **"Not logged in"** — log in with the agent's own login command.
- **The first turn takes a while, then fails** — a setup step that does
  not answer within 30 seconds fails with a message to check that the
  agent starts and that you are logged in.
- **An agent stops while a turn runs** — that turn fails. The session is
  gone; start a new session.
- **The agent writes something that is not JSON, or closes its output
  while still running** — the turn fails with a message and the agent is
  ended.
- **You want the cause of a failure** — the error in the chat ends with
  `full record: <path>`. Open that file; see "Logs" in
  `docs/user/acp-jetbrains.md`. It can contain the agent's output, so read
  it before you share it.

## Limits

- Processes an agent starts outside its own process group are not ended
  when the chat closes.
- Windows is best effort and untested for process ending and for signals.
