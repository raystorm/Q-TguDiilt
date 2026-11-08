# Model Dispatch: Choosing a Model and Driver

Every profile's commands are dispatched to a specific AI model and
driver (CLI backend, e.g. Kiro or Copilot). Model dispatch decides
which model and driver a profile uses, with a safe, predictable
fallback when a preference can't be honored.

## The registry file

Your registry is `.workflow/acp/drivers/registry.yaml`. It is your own
file and is not tracked by git. The first time, copy the shipped
`registry.example.yaml` (same folder) to `registry.yaml`, then edit the
copy. If `registry.yaml` is missing, loading it fails with an error that
tells you to do this; the example is never used as a fallback.

The service needs a valid `registry.yaml` to start. It reads the file once
when it starts and finds it in the drivers folder, not in the folder you
start it from. When the shipped example changes, overwrite your copy or
merge the change into it by hand. The service rejects a registry with a
top-level key it does not know (a typo, or a field name from an older
example), and the error names the file and the keys.

Each driver under `drivers:` names its `module`, the file that provides
the driver, and the models it supports. A relative `module` path is read
from the registry file's folder; an absolute path also works.

## Setting a model preference per profile

Add a `profiles:` entry to your `registry.yaml`, keyed by profile name:

```yaml
profiles:
  Architect:
    model: claude-opus-5
    driver: kiro      # optional — omit to let the registry choose
  Builder:
    model: claude-sonnet-5
```

`driver` is optional. If you omit it, dispatch picks the first driver
in the registry that supports the named model.

Rules for the entries:

- A key is a canonical profile name, spelled as its heading in
  `.workflow/rules/_PROFILES.md` (`Planner`, `PromptEngineer`). An alias
  such as `PE` is never a key, and capitals must match: `planner` is not
  `Planner`. A key that is not a canonical name has no effect. The service
  logs one warning for each (`profile_key_unknown`, with the key) and keeps
  starting.
- Every entry needs a `model`. The service does not start with an entry
  that lacks one. The error names the registry file and the entry.

A chat takes a profile's entry when you activate that profile. See
"Activating a profile" below.

## System defaults

The registry's top-level `preferred` entry is the system-wide default
driver and model:

```yaml
preferred:
  driver: kiro                 # required
  model: claude-sonnet-5.5     # optional
```

Without `preferred`, the first driver under `drivers:` is the default, with
the model `auto`. When several drivers list a model, the preferred driver
is used first.

A chat is resolved from these defaults when it opens and keeps that driver
and model until you activate a profile. A reopened chat is resolved from the
defaults again and has no profile until you activate one. If a profile has no
`profiles:` entry (or its preference fails to resolve, unless `fallbackMode`
is `fail-fast`), dispatch falls back to the same defaults.

## Activating a profile

When you activate a profile in a chat, the chat's driver and model switch to
that profile's `profiles:` entry before the turn runs. Your text goes to the
driver as you typed it. The service looks for the activation in the text of
each prompt you send:

- `as <name>`, `@as <name>` and `/as <name>` activate the profile with that
  name or alias. `@dr` activates Doctor and `@epr` activates Enforcer.
- `@start` and `@receive` (and `/start`, `/receive`) activate the profile
  that a changeover file names (see below).
- An `@` or `/` command counts anywhere in the text, as a whole word. Plain
  `as <name>`, without a prefix, counts only at the start of the text. The
  first command found decides. Capitals do not matter. The name is the word
  after `as`, minus one trailing `,` `.` `:` or `;`.
- Other words are ignored without a message: a path such as `/etc/hosts`, or
  an agent command such as `/help`. A command with a name that is not a
  profile changes nothing, and the service logs an info entry
  (`profile_unknown`).

Profile names and aliases come from `.workflow/rules/_PROFILES.md`, which the
service reads once when it starts. Matching ignores case, and an alias works
as the name (`as PE` activates PromptEngineer). The `profiles:` lookup uses
the canonical name.

`@start` and `@receive` take the profile from the first non-empty line under
`## To` in `.amazonq/work/current/HANDOFF.md` (`@start`) or
`.amazonq/work/current/MESSAGE.md` (`@receive`). The service reads the file
from the folder it was started in, which is the project folder when your IDE
starts it, each time you send the command. If the file is missing, has no
such line, or names an unknown profile, nothing changes and the service logs
`profile_unknown` (reason `no target` or `unknown name`).

What changes depends on the profile's entry:

- Same driver and model: nothing.
- Same driver, other model: the conversation continues and the model
  switches.
- Other driver: the old driver's session is closed, and the new driver
  starts a fresh conversation with this prompt. If closing fails, the
  service logs `release_failed` and your prompt goes on.

Activating the profile a chat already has runs the same steps again and logs
a warning (`profile_reactivated`). Switching to a different profile also
logs `profile_switched`. The switches that `@start` and `@receive` make are
expected and log an info entry only.

While the service handles a prompt, including the switch, a second prompt in
the same chat is rejected as in progress. Send it again when the turn ends.

If the profile's entry cannot be resolved, the prompt fails with an error
that begins `profile "<name>": ` and the chat keeps its driver and model. If
the agent does not offer the model, the prompt fails with that error and the
chat keeps the new choice, so later prompts fail the same way until you
activate a profile that works.

## When the preferred driver or model cannot be used

The service still starts. It writes one warning to its log and shows a
notice at the start of the first reply of each chat, new or reopened. The
notice names the preferred driver and model, the driver and model used
instead, and the reason:

- `not in registry` — the preferred driver is not under `drivers:` (for
  example a typo; names match exactly, capitals included)
- the driver's own reason — it failed a startup check: module not found,
  import failed, no createDriver, factory failed, not a driver, name
  mismatch or no governance
- `model not listed` — `preferred.model` is not in the preferred driver's
  `models:` list. This includes `auto`: list it under the driver

When the driver is the problem, the reason is the driver's, not the
model's. The usual rules then pick the replacement driver and model. The
notice repeats on the next replies of that chat until one turn ends
normally; a turn you stop, or one that fails, does not count.

The service does not start when nothing usable is left: no `registry.yaml`,
a registry it cannot read or with an unknown top-level key, an entry
without `module`, a `profiles:` entry without `model`, an empty `drivers:`
list, every driver failing, or defaults that select no working driver. The
error log (`.workflow/work/acp.log`) names the registry file.

It also does not start when `.workflow/rules/_PROFILES.md` is missing, cannot
be read, or lists an alias twice (capitals ignored). The service checks that
file first, finds it from its own files rather than the folder you start it
from, and logs `profile_names_startup_failed` with its path.

## When a profile's driver or model cannot be used

When the profile's entry cannot be honored as written, the profile still
runs, on what the fallback chain picks. The next reply starts with one line
that replaces any earlier notice. It is shown wrapped here, and it leaves out
the driver part when the entry names no driver:

```text
Profile "Architect" asks for driver "kiro", model "claude-opus-5"; using
driver "kiro", model "auto" (model not listed).
```

The reason is one of:

- `driver not available` — the entry's driver is not under `drivers:`, or it
  failed a startup check
- `model not listed` — the model is not in the `models:` list of the entry's
  driver, or the entry names no driver and no driver lists the model. The
  profile runs the same model on another driver that lists it, or `auto`
  when no driver does
- `entry could not be resolved` — the registry defaults stand in for the
  entry

The line repeats on the next replies of that chat until one turn ends
normally; a turn you stop, or one that fails, does not count. Activating
another profile replaces it. A profile with no `profiles:` entry brings back
the notice about the preferred driver or model, if there is one.

## The "auto" model

`auto` is a normal model name, assumed supported by every driver (you
don't need to list it per-driver). It's the automatic fallback used
whenever a named model can't be resolved — you never have to request
it explicitly for this to work.

## Controlling fallback behavior

`fallbackMode` is a top-level registry field controlling what happens
when a profile's own preference fails to resolve:

- `fallback-to-default-driver` (default) — falls through to the
  system default (`preferred`); the profile
  still dispatches, possibly to a different driver than it declared.
- `fail-fast` — a driver the registry does not list (or that failed a
  startup check), or a model no driver lists, fails the prompt with an error
  that names the profile; the defaults are not tried. One case is still
  substituted: when the entry's driver is listed but lacks the model and
  another driver lists it, the profile runs the same model on that other
  driver, and the chat line names the change.

```yaml
fallbackMode: fallback-to-default-driver
```

## Troubleshooting dispatch failures

- **The service stops right after it starts** — read the last
  `registry_startup_failed` entry in `.workflow/work/acp.log`. It names the
  registry path and the problem: a missing file (copy the example), an
  unknown top-level key (fix or remove it), an entry without `module`, a
  `profiles:` entry without `model`, or no usable driver. If the last entry
  is `profile_names_startup_failed`, it names `_PROFILES.md`: restore the
  file or remove the duplicate alias.
- **A notice about the preferred driver or model leads a reply** — see
  "When the preferred driver or model cannot be used". Fix the name or
  the `models:` list in `registry.yaml`, or the driver it names.
- **A line starting `Profile "<name>" asks for` leads a reply** — see "When a
  profile's driver or model cannot be used". Fix the entry or the driver's
  `models:` list.
- **Activating a profile changes nothing** — look for `profile_unknown` in
  `.workflow/work/acp.log`. Reason `unknown name` means the word is not a
  profile name or alias in `_PROFILES.md`. Reason `no target` means the
  changeover file is missing or has nothing under `## To`. A `profiles:` key
  that is an alias or has other capitals never matches; the service warns
  about it at startup (`profile_key_unknown`).
- **A prompt fails with `profile "<name>": ...`** — the profile's entry could
  not be resolved. With `fail-fast` this is the intended result for a driver
  or model that is not available; otherwise neither the entry nor the
  defaults resolved.
- **"no driver available" error** — neither the profile's preference
  nor the system default could be resolved, even after retrying with
  `auto`. The error names the model that was requested. Check that at
  least one driver in `drivers:` is configured and lists `auto`.
- **Profile dispatches to an unexpected driver** — read the line that starts
  the reply, then check `fallbackMode`. With the default setting, a profile
  whose declared driver no longer exists in the registry falls back to the
  system default. Set `fallbackMode: fail-fast` if you'd rather see the
  failure.
- **A profile dispatches with `auto` instead of its model** — the named
  model isn't listed under any driver's `models:`, so dispatch falls back
  to `auto`. It is not an error, and the reply starts with a line that says
  `model not listed`. Add the model to a driver's list or correct the name.
