# Extending the ACP Driver Layer

The ACP driver layer is designed to be extended. You can bring your
own drivers — local models, future providers, internal tools — by
implementing the driver interface and registering them in the driver
registry config.

## Driver Interface

A driver is a factory function that returns an object with a single
`execute` method:

```typescript
execute(command: string, options?: ExecuteOptions): DriverResult
```

The driver receives a command string and optional context, session,
and model. It returns the response text and a session ID for
conversation continuity.

Key rules:
- Call `validateExecuteArgs(command, options)` at the top of `execute`
- Return a `DriverResult` with `text` and `sessionId`
- Accept an empty or omitted `options` without throwing
- The driver must be independently testable via an injected `Cli`

See `kiro-driver.ts` and `copilot-driver.ts` as canonical examples.
For the full interface contract and type definitions, see
`.workflow/acp/drivers/EXTENDING.md`.

## Driver Registry

The registry is a YAML file that maps driver names to their supported
models. The ACP Wrapper reads this file to resolve which driver to
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

The installer (A5) ships a default registry with Kiro and Copilot
entries. Place your custom registry at the path the ACP Wrapper is
configured to read (defined in A4).

## Model Selection Resolution

When a model is requested, the ACP Wrapper resolves the driver in
this order:

1. `preferredModel` binding matches → use that driver
2. `preferredProvider` supports the model → use preferred driver
   (emits warning if preferred provider unavailable, then falls back)
3. First driver in registry order that lists the model
4. No match → error identifying the model as unregistered

---

For the full interface contract, type definitions, code example, and
Test Contract, see `.workflow/acp/drivers/EXTENDING.md`.
