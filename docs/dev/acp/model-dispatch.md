# Model Dispatch

Model dispatch resolves the `(model, driver)` pair the protocol layer
should use when dispatching a profile's commands. It has no hardcoded
driver/model knowledge — everything comes from the externalized YAML
registry.

Source lives under `.workflow/acp/modelResolver/`.

## Two layers

- **`resolveRegistry`** — the registry-level resolver. Given a model
  and an optional driver, finds a driver that supports the model,
  retrying with the `auto` model (assumed supported by every driver)
  when the named model can't be matched. Throws
  `NoDriverAvailableError` when no driver supports even `auto`.
- **`createDispatchResolver`** — the profile-level fallback chain.
  Tries the active profile's `profiles:` entry first, falls back to
  the registry's own `preferred` defaults, and
  raises one combined `DispatchResolutionError` (wrapping both
  underlying failures) when both fail. `fallbackMode: 'fail-fast'`
  skips the registry-default attempt entirely and surfaces the
  profile failure immediately.
- **`resolveRegistryDefaults`** — the one place the registry defaults
  are worked out: the preferred model (else `auto`) on the preferred
  driver (else the first driver listed), through `resolveRegistry`. The
  dispatch resolver and the Driver Catalog both call it.

## Resolution order

1. Profile declares a `Model:` (+ optional `Driver:`) in the registry's
   `profiles:` section → resolve against the registry.
2. Profile declares none, or its resolution fails and `fallbackMode`
   is `fallback-to-default-driver` → fall back to the registry's
   `preferred` defaults.
3. Both fail → `DispatchResolutionError`, wrapping both underlying
   errors.

With no profile at all, step 1 is skipped: resolution goes straight to
the registry defaults, and a failure is the `NoDriverAvailableError` itself.

Within either attempt, `resolveRegistry` applies its own
`(model, driver)` → registry match → `auto` retry → terminal
`NoDriverAvailableError` chain (see `drivers/EXTENDING.md`'s Model
Selection Resolution section for that inner step).

## Wiring the protocol layer to a registry

`createDispatchResolver({ config, logger })` (or `configPath`, which loads
and validates the file, fail-closed on load error) reads `fallbackMode`
from the config (default `'fallback-to-default-driver'` if unset), and
returns a `DispatchResolver` with one method: `resolve(profile?)` →
`{ model, driver, source }`. With no profile it goes straight to the
registry defaults (`source` is `'registry-default'`) and the log entry
carries no profile. `source` (`'profile'` or `'registry-default'`) is
logged alongside the resolved pair.

The service loads the registry once at startup, builds the Driver Catalog
from it, and builds the resolver on `catalog.resolverConfig`, so the
catalog and the resolver share one view of the registry. The protocol
layer calls `resolve()` once per session, when it opens (`session/new` and
`session/load`), with no profile. The driver and model stay on the session
record and every prompt uses them. A resolution failure rejects the call
and leaves no session. The session has no profile yet, so choosing a model
per profile is not wired.

## Drivers that failed to load

The Driver Catalog (`drivers/driver-catalog.ts`) leaves any driver that
failed a startup check out of the registry copy it exposes as
`resolverConfig`. A resolver built on that copy never picks a failed
driver: a profile or default that names one resolves as if the driver were
not listed. The catalog also calls `resolveRegistryDefaults` for the registry
defaults and fails the build when they cannot select a working driver. It
takes the driver and model in use from the same calculation the resolver
uses. See `drivers/EXTENDING.md` (Driver Catalog).

## Implementing and registering a custom driver

See `drivers/EXTENDING.md` — this content is owned there; model
dispatch resolves *which* driver to use but doesn't change how a
driver is implemented or registered.

## Error infrastructure

All ACP errors (`governance/`, `protocol/`, `drivers/`,
`modelResolver/`) extend `TguDiiltError` (`shared/errors.ts`), a thin
base enabling `instanceof TguDiiltError` to distinguish project errors
from library/language errors, plus `instanceof TheSpecificError` for
the exact kind. `defineError(name, buildMessage)` is a class factory
that generates a real, distinct, `instanceof`-able subclass from a
small message-builder function — one shared implementation of the
base-class wiring, with every error type still its own real class.

## Operational logging

Every dispatch resolution is logged: `dispatch_resolved` (profile,
resolved model, resolved driver, source) on success; `dispatch_failed`
(profile, attempted model/driver pairs, failure reasons) on failure. A
registry load failure is logged as `registry_config_error` and
rethrown — construction fails closed.
