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

The running service does not use `profiles:` yet: every chat session uses
the system defaults below. Per-profile preferences take effect in a later
version.

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

Each chat is resolved once, when it opens, and keeps that driver and model
for its whole life. A reopened chat is resolved again. If a profile has no
`profiles:` entry (or its preference fails to resolve), dispatch falls
back to the same defaults.

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
without `module`, an empty `drivers:` list, every driver failing, or
defaults that select no working driver. The error log
(`.workflow/work/acp.log`) names the registry file.

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
- `fail-fast` — surfaces the profile's resolution failure immediately;
  no silent substitution.

```yaml
fallbackMode: fallback-to-default-driver
```

## Troubleshooting dispatch failures

- **The service stops right after it starts** — read the last
  `registry_startup_failed` entry in `.workflow/work/acp.log`. It names the
  registry path and the problem: a missing file (copy the example), an
  unknown top-level key (fix or remove it), an entry without `module`, or
  no usable driver.
- **A notice about the preferred driver or model leads a reply** — see
  "When the preferred driver or model cannot be used". Fix the name or
  the `models:` list in `registry.yaml`, or the driver it names.
- **"no driver available" error** — neither the profile's preference
  nor the system default could be resolved, even after retrying with
  `auto`. The error names the model that was requested. Check that at
  least one driver in `drivers:` is configured and lists `auto`.
- **Profile dispatches to an unexpected driver** — check `fallbackMode`;
  with the default setting, a profile whose declared driver no longer
  exists in the registry silently falls back to the system default.
  Set `fallbackMode: fail-fast` if you'd rather see the failure.
- **A profile dispatches with `auto` instead of its model** — the named
  model isn't listed under any driver's `models:`, so dispatch falls back
  to `auto`. It is not an error. Add the model to a driver's list or
  correct the name.
