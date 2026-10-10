# Extending the ACP Driver Layer

The ACP driver layer is designed to be extended. You can bring your
own drivers — local models, future providers, internal tools — by
implementing the driver interface and registering them in the driver
registry config.

## Driver Interface

A driver is an object with a `name`, a `supportsToolCallGovernance` flag,
and an asynchronous `execute` method:

```typescript
execute(command: string, options?: ExecuteOptions): Promise<DriverResult>
```

The driver receives a command string and optional context, session, model,
and a per-call `onToolCall` handler. It returns the response text, a
session ID for conversation continuity, and the outcome (approved or
denied) of each tool call it reported.

Before running any tool call, the driver reports it through `onToolCall`
and runs it only on an exact `'approve'`. No handler, or any other answer,
denies the call (fail closed). A driver must declare
`supportsToolCallGovernance: true`; the ACP Protocol layer rejects any
other driver before doing any work.

Key rules:
- Call `validateExecuteArgs(command, options)` at the top of `execute`
- Return a `DriverResult` with `text`, `sessionId`, and `toolCalls`
- Accept an empty or omitted `options` without throwing
- Report every tool call through `gateToolCall` before it runs
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
