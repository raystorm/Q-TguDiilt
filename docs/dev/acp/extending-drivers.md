# Extending the ACP Driver Layer

The ACP driver layer is designed to be extended. You can bring your
own drivers — local models, future providers, internal tools — by
implementing the driver interface and registering them in the driver
registry config.

## Driver Interface

A driver is an object with a `name`, a `supportsToolCallGovernance` flag,
an asynchronous `execute` method, and an optional `close` method:

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
`cancelled: true`. A driver may also offer `close()`, which releases the
downstream agent. The interface marks `signal`, `cancelled` and `close`
optional, so a driver that ignores them still conforms, but a cancel then
leaves its session busy until `execute` settles. A driver that holds a
downstream agent should implement `close()`.

Key rules:
- Call `validateExecuteArgs(command, options)` at the top of `execute`
- Return a `DriverResult` with `text`, `sessionId`, and `toolCalls`
- Accept an empty or omitted `options` without throwing
- Report every tool call through `gateToolCall` before it runs
- Honor `options.signal` when the provider can be interrupted: settle
  `cancelled: true`, report nothing new, discard late answers
- If the driver holds a downstream agent (any driver that wraps an ACP
  agent does), implement `close()`: it releases that agent, and must be
  safe to call any number of times, also concurrently
- Prove the driver with the shared contract suite
  (`describeGovernedDriverContract`)

See `.workflow/acp/drivers/EXTENDING.md` for the full interface contract
and type definitions.

## Driver Registry

The registry is a YAML file that maps driver names to their supported
models. The ACP Protocol layer reads this file to resolve which driver to
dispatch to for a given model.

```yaml
drivers:
  kiro:
    models:
      - claude-sonnet-5
      - claude-opus-5

  copilot:
    models:
      - claude-sonnet-5
      - gpt-5.6-sol

  my-local-model:
    models:
      - llama-3.2-local
```

Two optional top-level fields control resolution preference:

- `preferredProvider` — when multiple drivers support a model, use
  this driver first
- `preferredModel` — binds a specific model to a specific driver,
  overriding `preferredProvider`

See `.workflow/acp/drivers/registry.example.yaml` for a complete
example with Kiro, Copilot, and a custom driver entry.

## Registering a Custom Driver

Add an entry to your registry YAML under `drivers:`:

```yaml
drivers:
  my-local-model:
    models:
      - llama-3.2-local
      - mistral-7b-local
```

The installer ships a default registry with Kiro and Copilot entries.
Place your custom registry at the path the ACP Protocol layer is
configured to read.

## Model Selection Resolution

When a model is requested, the ACP Protocol layer resolves the driver in
this order:

1. `preferredModel` binding matches → use that driver
2. `preferredProvider` supports the model → use preferred driver
   (emits warning if preferred provider unavailable, then falls back)
3. First driver in registry order that lists the model
4. No match → error identifying the model as unregistered

---

For the full interface contract, type definitions, code example, and
Test Contract, see `.workflow/acp/drivers/EXTENDING.md`.
