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

## Installation

Installation is manual today. Copy `.amazonq/`, `.workflow/` and `docs/` into your project,
create `registry.yaml` (see "Prerequisites"), then follow "Configure the connection".
This section is completed when the installer is built.

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

## Quickstart

1. Connect the IDE (see "Configure the connection") and open a chat.
2. Type `@as Architect analyze my repository and summarize its structure`.
3. When the profile ends with a `**Next**` line that names one profile, the service moves the
   workflow on. Watch the chat. Use the IDE's stop control to end it.

This section is completed when the installer is built.

## What a session looks like

From your side, a session follows this lifecycle:

1. **Connect** — the IDE starts the service and initializes the
   connection.
2. **New session** — each session maps to exactly one workflow.
3. **Prompt turns** — you send a prompt; the service shows the agent's
   reply and tool calls as they happen and returns a response. One prompt
   turn runs one workflow step.
4. **Disconnect** — closing the connection releases all sessions.

Only one prompt turn runs at a time per session. If you send a second
prompt while one is still running, the service rejects it and asks you
to retry once the current turn finishes. To interrupt a running turn,
use your IDE's cancel action (ACP `session/cancel`); see "Stopping a
turn".

## Running a workflow

You start the first profile yourself, for example `@as Planner write a story for user
search`. From there the service takes the workflow from profile to profile in the same chat,
inside the one prompt you sent. The IDE shows one long prompt with a continuous stream.

A profile ends its last message with a line like this:

```text
**Next**: Run `@handoff to=Planner`
```

When that line names exactly one profile after `@handoff`, the service first checks that the
profile marked itself ready. Before it wrote that line, the profile wrote a status file in
`.amazonq/work/status/`. The service goes on only when exactly one file written during this turn
says `ready` and hands off to the profile the line named. Then it takes a **changeover step**:

1. Shows `Changeover: sending @handoff to=Planner` and sends that command to the agent. The
   agent writes `.amazonq/work/current/HANDOFF.md`.
2. Checks that the handoff file was written for this step and names a known profile.
3. Shows `Changeover: sending @start` and sends it to a fresh agent session. That session
   activates the profile named in the file, with the driver and model that profile's registry
   entry asks for, and does the work.

The service repeats this until a profile's last message does not name exactly one next
profile, the profile did not mark itself ready, or you stop it. A profile may hand work back
to an earlier one, for example Enforcer to PromptEngineer. The service follows whichever
profile it names.

- **You no longer review each handoff** before the next profile starts. Watch the chat.
- **You can type the handoff yourself.** A prompt that holds `@handoff` or `/handoff` as a
  whole word counts. The service then checks the handoff file and sends `@start`; it does not
  look at the status file. After a stop, typing `@handoff to=<Profile>` makes the service start the
  automated changeover process again.
- **Approvals still come to you.** The service never answers an approval for you. It waits
  until you do.
- **Side trips are carried on.** A line that suggests one `@send` starts a side trip (see "Side
  trips"). A line that suggests both a handoff and a send stops the service.
- **A prompt typed while the service is moving on** is rejected as "turn in progress". The
  workflow carries on.
- **There is no off switch and no limit on profile changes.** Stop is the way out.

## Side trips

A side trip lets the profile you are working with ask another profile for help, in the same
chat, and then carry on with the result. For example, Enforcer asks Doctor to look at a failure.
There is one side trip at a time. A profile starts one with a last message like this:

```text
**Next**: Run `@send to=Doctor`
```

The profile first writes its status file with `ready` and a send to that profile. Then the
service goes on, and you see these lines in the chat:

1. `Changeover: sending @send to=Doctor`. The profile writes `.amazonq/work/current/MESSAGE.md`.
2. The service checks that the message was written for this step and names a known profile.
3. `Changeover: sending @receive`, then `Side trip: Doctor`. Doctor starts in a fresh agent
   session, with the driver and model its registry entry asks for. Its work streams into the
   chat. The first profile's session is kept, not ended, while the side trip runs.
4. Doctor can send on to another profile in the same way, for example to PromptEngineer. Each
   move ends the session of the profile that sent it. The kept session is never ended.
5. The trip ends when a profile's last message suggests nothing and its status file says
   `complete`. The service then ends that session, shows the fixed return prompt it sends to
   the first profile, then `Back to Enforcer`. The first profile carries on in its own
   session, with everything it had before.

- **The return carries no result.** The prompt only says the side trip finished and names its
  last profile. The first profile finds the result in the files the trip changed and in the
  workflow log.
- **You can answer a question.** If a side-trip profile asks you something, its status file says
  `waiting`, the service stops and shows no line. Type your answer. It goes to that profile, and
  the trip can end in that prompt.
- **A side trip moves only by a send.** A handoff inside one, suggested or typed, stops the
  service with a line. Type `@send to=<Profile>` to move the trip.
- **You can type the send yourself.** A prompt that holds `@send` or `/send` as a whole word
  counts, like a typed handoff: the service checks the message file and sends `@receive`, and
  does not look at the status file. A prompt that holds both a handoff and a send stops.
- **Stop ends the turn only.** The side trip stays open, and your next prompt goes to the profile
  that was running.
- **Closing the chat ends everything**, including the kept session.
- **Not tested yet:** a trip that runs for many minutes, and two sessions of one agent at once.
  If the kept session did not survive, the return would fail with an error.

## What you see during a turn

The agent's reply appears as the agent writes it, not once at the end.
The tool calls the agent makes appear in the same chat, in order with the
text, each as a **card**.

- **A card** shows what the call is: its kind, the agent's title and, for
  a command or file call, the command or the file paths. These are what
  governance checked, so you see them even if the agent's title says
  something else. A card never shows a diff; the diff appears only when
  you are asked to approve.
- **The outcome** is added to the end of the card's title once governance
  has finished with the call:
  - `approved by governance`: a rule approved it and you were not asked.
  - `denied by governance`: a rule denied it. The card is marked failed.
  - `allowed by you` or `rejected by you`: your answer to an approval
    request. A rejection marks the card failed.
  - `cancelled`: you stopped the turn, or the IDE cancelled the question.
  - `Approval process errored: request denied`: the question could not be
    asked or the answer was not understood, so the call was denied. The
    card is marked failed.
- **When the agent stops early**, the chat shows one line after the text
  and the turn ends. Your IDE shows it as ended for that reason, and you
  can send another prompt. If you stop a turn yourself, no line appears.
  - "The agent stopped because it reached its output limit; the reply may
    be cut off."
  - "The agent stopped because it reached its limit on requests in one
    turn; the work may be unfinished."
  - "The agent refused to continue this turn."

## When the service stops

The service stops after a turn when it cannot tell what comes next. The chat says why, except
where noted. You then type the next command.

- **The last message suggested no handoff:** no line.
- **Several next steps are suggested:** "Several next steps are suggested above. Enter the one
  you want, for example `@handoff to=<Profile>`." A handoff and a send in one line count as
  several.
- **The suggestion names no profile:** "The agent's next step names no profile to hand off
  to. Enter the command you want, for example `@handoff to=<Profile>`."
- **The profile is not known:** `"<word>" is not a known profile.` followed by the same
  "Enter the command you want" line. The word is shown as the agent wrote it, cut at 64
  characters.
- **The handoff file was not written:** "The handoff file was not written for this turn, or
  it names a different profile (.amazonq/work/current/HANDOFF.md)."
- **The message file was not written:** "The message file was not written for this turn, or it
  names a different profile (.amazonq/work/current/MESSAGE.md)."
- **A handoff inside a side trip:** "A side trip moves only by a send. Enter the command you
  want, for example `@send to=<Profile>`."
- **The profile did not mark itself ready, or did not finish a side trip:** no line. You see
  only the agent's own text. A profile in a side trip that suggests nothing must have its status
  file say `complete`, or the trip stays open. The
  `status_check` entry in `.workflow/work/acp.log` has an `outcome` that says why:
  - `missing`: the profile wrote no status file, or the chat has no profile.
  - `stale`: the profile's status file was not written during this turn.
  - `ambiguous`: more than one status file of the profile was written during this turn.
  - `invalid`: the status file cannot be read or does not follow the format.
  - `not_ready`: the status file says the profile is still working or waiting, for example
    for your answer to a question.
  - `mismatch`: the status file hands off to another profile, or by another command. At the end
    of a side trip, a file that names any next step.

  Type `@handoff to=<Profile>` (or, in a side trip, `@send to=<Profile>`) yourself to go on.
- **A turn ended early or failed:** the usual line or error, then "Automatic changeover
  stopped." This second line appears only when the service sent a command in that prompt, or
  you typed a handoff or a send.
- **You pressed Stop:** no line. Nothing further is sent.

What each agent does when its context window fills is not known yet. If a turn ends early or
fails, the service stops as above. To carry on in a fresh chat, save the context with
`@suspend` and restore it with `@resume` in the new chat.

For causes and fixes, see [Troubleshooting a workflow run](acp-troubleshooting.md).

## Approvals

When a step needs your approval, the service first shows you the
**specifics** of the action — the command, file paths, diff, and any
tool parameters — and then presents the approval request. The specifics
appear on the call's card, and text the agent writes meanwhile follows
them. You always see what you are approving before you approve it.

## Stopping a turn

Use your IDE's stop (cancel) action to end a running turn. The service
passes the stop on to the provider, shows any text produced so far, and
ends the turn as cancelled. The session stays usable.

- **In a workflow:** Stop ends the automated changeover process at once and nothing further is sent. Stop
  is the only way to end it; a word typed in the chat does not. In a side trip the trip stays open.
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
  diffs or tool input. In a workflow it also records `changeover_sent` (each command the
  service sent), `loop_stopped` (why the service stopped), `status_check` (each status check,
  its kind and outcome) and `status_read_failed` (a status folder or file that could not be read,
  with the error code), with no agent text and nothing from a status file.
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

- **The workflow stopped, or did not move on** — see
  [Troubleshooting a workflow run](acp-troubleshooting.md).
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
- **A turn fails with an error naming a stop reason** — the agent ended
  the turn by itself (it cancelled, or sent a reason the service does not
  know). The text shown before the error stays; send the prompt again. If
  this happened in the first turn of a chat, or of a reopened chat, the
  next message starts a new agent session, so the agent does not remember
  that turn, and the old agent stays idle until you close the chat.
- **Provider quota / authentication errors** — these surface as clear,
  actionable errors; resolve the provider issue (quota or re-login) and
  retry the turn.
- **The agent will not start, or fails the first turn** — see "When
  something goes wrong" in `docs/user/acp-agents.md`.
- **Check the logs** — `.workflow/work/acp.log` records what the service
  did and any errors encountered. `.workflow/work/acp-diagnostic.log`
  records why an agent failed; the chat error names it.
