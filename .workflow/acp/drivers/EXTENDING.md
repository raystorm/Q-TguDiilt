# Extending the ACP Driver Layer

> For a developer-facing overview, see
> `docs/dev/acp/extending-drivers.md`.

## Driver Interface Contract

A driver is a plain object with a single method:

```typescript
execute(command: string, options?: ExecuteOptions): DriverResult
```

**Types** (defined in `driver.ts` and `kiro-driver.ts`):

```typescript
// driver.ts
interface ExecuteOptions {
   context?:   string;   // Prepended to command before dispatch
   sessionId?: string;   // Resume an existing session
   model?:     string;   // Model to use for this call
}

// kiro-driver.ts (TODO(A4): move to driver.ts)
interface DriverResult {
   text:      string;
   sessionId: string;
}
```

**Contract rules:**
- `command` is required and must be a non-empty string
- `options.model`, when provided, must be a non-empty string
- The driver MUST return a `DriverResult` with `text` and `sessionId`
- The driver MUST NOT throw on empty `options` — treat it as `{}`

See `kiro-driver.ts` and `copilot-driver.ts` as canonical implementations.

---

## How to Implement a Custom Driver

1. Create a factory function that accepts a `Cli` and optional config:

```typescript
import { validateExecuteArgs, ExecuteOptions } from './driver.js';
import { Cli, DriverResult } from './kiro-driver.js';

export function createMyDriver(cli: Cli) {
   return {
      execute(command: string, options: ExecuteOptions = {}): DriverResult {
         validateExecuteArgs(command, options);
         const { context, sessionId, model } = options;
         const input = context ? `${context}\n\n${command}` : command;
         const args = ['--prompt', input];
         if (model)     { args.push('--model',   model);     }
         if (sessionId) { args.push('--session', sessionId); }
         const { finalText, sessionId: returnedSessionId } = cli.run(args);
         return { text: finalText, sessionId: returnedSessionId };
      }
   };
}
```

2. Call `validateExecuteArgs(command, options)` at the top of `execute` —
   this enforces the interface contract and is required.

3. The driver must be independently testable by injecting a mock `Cli`.

---

## Registry Config Format

The registry is a YAML file that maps driver names to their supported
models, with optional top-level preference fields, a per-profile
preference section, and a system-level fallback policy.

```yaml
# Optional: preferred driver when multiple drivers support a model.
# Falls back to registry order if unavailable for the requested model.
preferredDriver: kiro

# Optional: binds a specific model to a specific driver.
# Overrides preferredDriver for that model.
preferredModel:
  model: claude-sonnet-5
  driver: kiro

# Optional: per-profile model/driver preference, keyed by profile name.
# `driver` is optional; when omitted, resolution falls back to registry
# order (then preferredDriver/preferredModel tie-break) for that model.
profiles:
  Architect:
    model: claude-opus-5
    driver: kiro
  Builder:
    model: claude-sonnet-5

# Optional: system-level policy (applies to all profiles) for when a
# profile's own model/driver preference fails to resolve.
# 'fallback-to-default-driver' (default) falls through to
# preferredModel/preferredDriver above; 'fail-fast' surfaces the
# profile's resolution failure immediately with no substitution.
fallbackMode: fallback-to-default-driver

drivers:
  <driver-name>:
    models:
      - <model-name>
      - <model-name>
```

**Rules:**
- Each entry key is the driver name (string, required)
- `models` is a list of model name strings (required, must be non-empty)
- `preferredDriver`, `preferredModel`, `profiles`, and `fallbackMode`
  are all optional
- Custom driver entries follow the same schema as built-in entries

See `registry.example.yaml` for a complete example with Kiro, Copilot,
a per-profile `profiles:` block, and a custom driver entry.

---

## How to Register a Custom Driver

Add an entry to your registry YAML under `drivers:`:

```yaml
drivers:
  my-local-model:
    models:
      - llama-3.2-local
      - mistral-7b-local
```

The installer ships a default registry with Kiro and Copilot entries.
Place your custom registry at the path the ACP service is configured to
read.

---

## Model Selection Resolution

Model dispatch resolution for a profile is owned by the model dispatch
resolver, not by this document. See `docs/dev/acp/model-dispatch.md`
for the full algorithm (profile preference → registry default →
combined error, with `auto`-model retry and configurable
`fallbackMode`).

This section covers only the registry-level step that the resolver
calls into — matching a `(model, driver)` pair against the registry:

1. **preferredModel binding matches** — if `preferredModel.model` equals
   the requested model, use `preferredModel.driver`'s driver.
2. **preferredDriver supports the model** — if `preferredDriver` is
   set and its `models` list includes the requested model, use that
   driver.
3. **First match in registry order** — use the first driver in the
   registry whose `models` list includes the requested model.
4. **No match** — retry with `model = "auto"` (keeping whatever driver
   context is already known), then raise an error if even `auto` has
   no supporting driver.
