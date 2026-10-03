# Model Dispatch: Choosing a Model and Driver

Every profile's commands are dispatched to a specific AI model and
driver (CLI backend, e.g. Kiro or Copilot). Model dispatch decides
which model and driver a profile uses, with a safe, predictable
fallback when a preference can't be honored.

## Setting a model preference per profile

Add a `profiles:` entry to the driver registry YAML
(`.workflow/acp/drivers/registry.yaml`), keyed by profile name:

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

## System defaults

If a profile has no `profiles:` entry (or its preference fails to
resolve), dispatch falls back to the registry's top-level
`preferredModel` / `preferredDriver` fields — the system-wide default
model and driver.

## The "auto" model

`auto` is a normal model name, assumed supported by every driver (you
don't need to list it per-driver). It's the automatic fallback used
whenever a named model can't be resolved — you never have to request
it explicitly for this to work.

## Controlling fallback behavior

`fallbackMode` is a top-level registry field controlling what happens
when a profile's own preference fails to resolve:

- `fallback-to-default-driver` (default) — falls through to the
  system default (`preferredModel`/`preferredDriver`); the profile
  still dispatches, possibly to a different driver than it declared.
- `fail-fast` — surfaces the profile's resolution failure immediately;
  no silent substitution.

```yaml
fallbackMode: fallback-to-default-driver
```

## Troubleshooting dispatch failures

- **"no driver available" error** — neither the profile's preference
  nor the system default could be resolved, even after retrying with
  `auto`. Check that at least one driver in `drivers:` is configured
  and that its `models:` list isn't empty.
- **Profile dispatches to an unexpected driver** — check `fallbackMode`;
  with the default setting, a profile whose declared driver no longer
  exists in the registry silently falls back to the system default.
  Set `fallbackMode: fail-fast` if you'd rather see the failure.
- **"unregistered model" error** — the named model isn't listed under
  any driver's `models:` in the registry. Add it to a driver's list or
  correct the name.
