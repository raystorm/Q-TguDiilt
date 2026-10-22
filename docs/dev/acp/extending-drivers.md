# Extending the ACP Driver Layer

The ACP driver layer is designed to be extended. You can bring your
own drivers — local models, future providers, internal tools — by
implementing the driver interface, exporting a `createDriver` factory,
and registering them in the driver registry config.

## Driver Interface

A driver is an object with a `name`, a `supportsToolCallGovernance` flag,
an asynchronous `execute` method, and an asynchronous `close` method:

```typescript
execute(command: string, options?: ExecuteOptions): Promise<DriverResult>
```

The driver receives a command string and optional context, session, model,
a per-call `onToolCall` handler, and a per-call abort `signal`. It returns
the response text, a session ID for conversation continuity, the outcome
(approved or denied) of each tool call it reported, and `cancelled: true`
when the turn ended because the signal aborted.

Before running any tool call, the driver reports it through `onToolCall`
and runs it only on an exact `'approve'`. No handler, or any other answer,
denies the call (fail closed). A driver must declare
`supportsToolCallGovernance: true`; the ACP Protocol layer rejects any
other driver before doing any work.

The `signal` aborts the turn when the user stops it or the connection
ends. A driver that honors it asks nothing new, discards any late answer
(an approve included, which never runs), and settles with
`cancelled: true`. The interface marks `signal` and `cancelled`
optional, so a driver that ignores them still conforms, but a cancel then
leaves its session busy until `execute` settles. `close()` is required:
it releases every process the driver started.

Key rules:
- Call `validateExecuteArgs(command, options)` at the top of `execute`
- Return a `DriverResult` with `text`, `sessionId`, and `toolCalls`
- Accept an empty or omitted `options` without throwing
- Report every tool call through `gateToolCall` before it runs
- Honor `options.signal` when the provider can be interrupted: settle
  `cancelled: true`, report nothing new, discard late answers
- Implement `close()`: it takes no argument, releases every process the
  driver started, and must be idempotent and safe to call concurrently
  (every call resolves, the downstream agent is released once). A driver
  with nothing to release resolves immediately
- Prove the driver with the shared contract suite
  (`describeGovernedDriverContract`)

See `.workflow/acp/drivers/EXTENDING.md` for the full interface contract
and type definitions.

## Driving an ACP agent

The Kiro and Copilot drivers are built on a shared ACP driver core, so
a driver for an ACP agent is a thin file: it calls `createAcpDriver`
with its launch command line, and optionally a policy and a list of
unsafe settings. The core needs no change. See
`docs/dev/acp/acp-driver-core.md`.

## Driver Registry

The registry is a YAML file that maps driver names to the module that
provides each driver and the models it supports. The ACP Protocol layer
reads this file to resolve which driver to dispatch to for a given model.

```yaml
drivers:
  kiro:
    module: ./kiro-driver-acp.js
    models:
      - claude-sonnet-5
      - claude-opus-5

  copilot:
    module: ./copilot-driver-acp.js
    models:
      - claude-sonnet-5
      - gpt-5.6-sol

  my-local-model:
    module: ./my-local-model-driver.js
    models:
      - llama-3.2-local
```

`module` is required. A relative path is read from the registry file's
folder, an absolute path also works, and a TypeScript source file is named
with a `.js` suffix.

Two optional top-level fields control resolution preference:

- `preferredDriver` — when multiple drivers support a model, use
  this driver first
- `preferredModel` — the registry's default (model, driver) pair, used
  when a profile has no usable entry. There, `preferredDriver` is used if
  it lists the model; otherwise the bound driver

See `.workflow/acp/drivers/registry.example.yaml` for a complete
example with Kiro, Copilot, and a custom driver entry (shown as a
comment, because it has no code behind it). The registry in use is your
own `registry.yaml` in the same folder, not tracked by git: copy the
example to it once, then edit the copy. A missing `registry.yaml` fails
to load with an error that points to the example.

## Registering a Custom Driver

1. Implement the driver and export `createDriver({ logger })` from its
   module. The factory returns the driver; its `name` must equal the
   registry key.
2. Add an entry to your `registry.yaml` under `drivers:`:

```yaml
drivers:
  my-local-model:
    module: ./my-local-model-driver.js
    models:
      - llama-3.2-local
      - mistral-7b-local
```

## Startup Checks

The Driver Catalog loads every driver the registry names and checks it:
the module imports, exports `createDriver`, the factory returns a driver
whose name equals the registry key, and the driver declares tool-call
governance. Models and installed CLIs are not checked.

A driver that fails is logged (entry name, resolved path, failure kind)
and left out; the others still load. Building the catalog fails when the
registry lists no drivers, when every driver fails, or when the registry
defaults cannot select a working driver. A preferred driver that is
missing from `drivers:` or failed is flagged, logged as a warning, and
described in a notice naming the driver in use instead.

See `.workflow/acp/drivers/EXTENDING.md` (Driver Catalog) for the details.

## Model Selection Resolution

When a model is requested, the ACP Protocol layer resolves the driver in
this order (the full algorithm is in `docs/dev/acp/model-dispatch.md`):

1. The driver given with the request lists the model → use it (for the
   registry defaults, `preferredDriver` is the given driver)
2. `preferredModel` binding matches → use that driver
3. `preferredDriver` lists the model → use that driver
4. First driver in registry order that lists the model
5. No driver lists the model → retry with `auto`; a model nobody lists
   falls back to `auto` and is not an error
6. No driver lists `auto` either → "no driver available" error, naming
   the requested model

A driver that failed to load is not in the registry the resolver sees, so
these steps skip it.

---

For the full interface contract, type definitions, code example, and
Test Contract, see `.workflow/acp/drivers/EXTENDING.md`.
