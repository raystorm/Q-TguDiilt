# Troubleshooting a workflow run

Problems you can meet while the service moves a workflow from profile to profile. For
connection, start-up and agent problems, see "Troubleshooting" in `acp-jetbrains.md` and
"When something goes wrong" in `acp-agents.md`.

## The service stopped

The chat lines are listed under "When the service stops" in `acp-jetbrains.md`. What to do:

- **Several next steps, no profile named, or an unknown profile:** type the command you want,
  for example `@handoff to=Planner`. The service checks the handoff file and starts that
  profile.
- **The handoff file was not written:** see the next section.
- **"The changeover loop stopped.":** the turn ended early or failed. Read the line or error
  above it. The text already shown stays. Send a prompt to carry on in the same profile, or
  type a handoff.
- **No line at all:** the profile's last message suggested no handoff, the profile did not mark
  itself ready, or you pressed Stop. If the profile should have handed off, its last message
  must end with a line such as ``**Next**: Run `@handoff to=Planner` ``, and the profile must
  have written its status file with `ready` first. Look for `status_check` in
  `.workflow/work/acp.log`; its `outcome` says what the service found (see "When the service
  stops" in `acp-jetbrains.md`). Type the handoff yourself.

## The handoff file was not written

The service checks `.amazonq/work/current/HANDOFF.md` before it sends `@start`. It stops when
the file is missing, was not written during this step, or names a different profile than the
one the service sent. Likely causes:

- The agent did not expand `@handoff`. The service sends it as plain prompt text, and the
  agent has to follow the saved prompt.
- The agent wrote another profile under `## To`.

Open the file and read `## To`. Then type `@handoff to=<Profile>` again, or correct the file
and type `@start`.

## The profile is not known

Names and aliases are matched exactly, ignoring case. There is no fuzzy matching. The names
are in `.workflow/rules/_PROFILES.md`.

## The chat stops responding

Seen once: a Builder chat in IntelliJ sat idle while the user was away, and the chat lost its
ACP connection to Kiro. Restarting the chat was not enough. Restarting the whole IDE brought
the conversation back.

It is not known whether a prompt that is still running survives a long wait. A workflow keeps
one prompt open for as long as it runs, and this has not been tested.

## Two chats in one project

There is one `HANDOFF.md` per project. Two chats that take changeover steps at the same time
share it and can overwrite each other's handoff. Run one workflow at a time in a project.

## Reading the log

`.workflow/work/acp.log` holds one entry for each command the service sent and one for each
stop:

```text
grep -E 'changeover_sent|loop_stopped' .workflow/work/acp.log
```

- `changeover_sent`: `sessionId`, `from` (when the chat had a profile), `to`, `trigger`
  (`handoff` or `start`) and `profileHop`. A profile hop is one change of profile. A
  `@handoff` and its `@start` share one number.
- `loop_stopped`: `sessionId`, `reason`, `profileHop` and `word`. `word` is set for an unknown
  profile only. It is redacted and cut at 64 characters.
- The reasons are `no_suggestion`, `several_suggestions`, `no_target`, `unknown_profile`,
  `handoff_not_written`, `abnormal_end`, `failed` and `cancelled`.

Neither entry holds agent text.
