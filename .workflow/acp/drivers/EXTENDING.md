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
models, with optional top-level preference fields.

```yaml
# Optional: preferred driver when multiple drivers support a model.
# Falls back to registry order if unavailable for the requested model.
preferredProvider: kiro

# Optional: binds a specific model to a specific driver.
# Overrides preferredProvider for that model.
preferredModel:
  model: claude-sonnet-5
  provider: kiro

drivers:
  <driver-name>:
    models:
      - <model-name>
      - <model-name>
```

**Rules:**
- Each entry key is the driver name (string, required)
- `models` is a list of model name strings (required, must be non-empty)
- `preferredProvider` and `preferredModel` are optional
- Custom driver entries follow the same schema as built-in entries

See `registry.example.yaml` for a complete example with Kiro, Copilot,
and a custom driver entry.

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

The installer (A5) ships a default registry with Kiro and Copilot entries.
Place your custom registry at the path the ACP Wrapper is configured to
read (defined in A4).

---

## Model Selection Resolution

When a model is requested, the ACP Wrapper resolves the driver as follows:

1. **preferredModel binding matches** — if `preferredModel.model` equals
   the requested model, use `preferredModel.provider`'s driver.
2. **preferredProvider supports the model** — if `preferredProvider` is
   set and its `models` list includes the requested model, use that
   driver. Emit a warning if `preferredProvider` is set but does not
   support the model (fallback proceeds).
3. **First match in registry order** — use the first driver in the
   registry whose `models` list includes the requested model.
4. **No match** — raise an error identifying the model as unregistered.

---

## Test Contract

These scenarios define what A4's registry resolver must satisfy.

### Group 1: Registry Config Format

Scenario: Valid registry parses without error
  Given a registry YAML with driver-a supporting
    ["model-x", "model-y"] and driver-b supporting ["model-z"]
  When the registry is loaded
  Then it parses successfully with no errors
  And each entry maps a driver name to a list of supported models

Scenario: Registry entry missing required driver field
  Given a registry YAML entry with no driver name key
  When the registry is loaded
  Then a validation error is raised
  And the error identifies the missing field

Scenario: Registry entry with empty models list
  Given a registry YAML entry with an empty models array
  When the registry is loaded
  Then a validation error is raised
  And the error identifies the entry as invalid

Scenario: Registry contains both Kiro and Copilot example entries
  Given the default registry shipped with the installer
  When the registry is inspected
  Then it contains an entry for the Kiro driver
  And it contains an entry for the Copilot driver
  And each entry lists at least one supported model

### Group 2: Model Selection Resolution

Scenario: Model supported only by one driver resolves correctly
  Given a registry where driver-a supports ["model-x"] and
    driver-b supports ["model-z"]
  When model selection is requested for "model-x"
  Then driver-a is returned

Scenario: Model supported only by other driver resolves correctly
  Given a registry where driver-a supports ["model-x"] and
    driver-b supports ["model-z"]
  When model selection is requested for "model-z"
  Then driver-b is returned

Scenario: Overlapping model — preferred provider wins
  Given a registry where both driver-a and driver-b support "model-y"
  And the user has configured preferredProvider: "driver-b"
  When model selection is requested for "model-y"
  Then driver-b is returned

Scenario: Overlapping model — preferred model binding overrides
  preferred provider
  Given a registry where both driver-a and driver-b support "model-y"
  And the user has configured preferredProvider: "driver-b"
  And the user has configured
    preferredModel: { model: "model-y", provider: "driver-a" }
  When model selection is requested for "model-y"
  Then driver-a is returned

Scenario: Unknown model requested
  Given a registry with known model entries
  When model selection is requested for "nonexistent-model-x"
  Then an error is raised
  And the error message identifies "nonexistent-model-x" as unregistered

### Group 3: Custom Driver Registration

Scenario: Custom driver registered and resolvable
  Given a registry YAML with a custom driver entry mapping
    "driver-custom" to ["model-custom-1"]
  When model selection is requested for "model-custom-1"
  Then driver-custom is returned

Scenario: Custom driver entry follows the same schema as built-in entries
  Given a custom driver registry entry
  When the entry is validated against the registry schema
  Then it passes validation without errors

### Group 4: Documentation Completeness

Scenario: Interface documentation covers all required topics
  Given the driver extension documentation
  When the documentation is reviewed
  Then it covers: how to implement the driver interface
  And it covers: how to register a custom driver in the registry
  And it covers: how model selection resolves to a driver

Scenario: Example registry entries are present for both built-in drivers
  Given the driver extension documentation
  When the example registry section is reviewed
  Then a Kiro example entry is present
  And a Copilot example entry is present
  And both entries are valid against the registry schema

### Group 5: Preferred Model and Preferred Provider Config

Scenario: Preferred provider respected for overlapping model
  Given the user config specifies preferredProvider: "driver-a"
  And both driver-a and driver-b support "model-y"
  When model selection is requested for "model-y"
  Then driver-a is returned

Scenario: Preferred model binding overrides preferred provider
  Given the user config specifies preferredProvider: "driver-b"
  And the user config specifies
    preferredModel: { model: "model-y", provider: "driver-a" }
  When model selection is requested for "model-y"
  Then driver-a is returned

Scenario: Preferred provider unavailable for model — falls back
  Given the user config specifies preferredProvider: "driver-b"
  And "model-x" is only supported by driver-a
  When model selection is requested for "model-x"
  Then driver-a is returned
  And a warning is emitted that preferred provider was unavailable
    for this model

Scenario: No preference configured — registry order determines driver
  Given no preferredProvider or preferredModel is configured
  And both driver-a and driver-b support "model-y"
  When model selection is requested for "model-y"
  Then the driver listed first in the registry is returned
