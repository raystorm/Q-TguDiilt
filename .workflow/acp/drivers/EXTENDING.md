# Extending the ACP Driver Layer

> For a developer-facing overview, see
> `docs/dev/acp/extending-drivers.md`.

## Driver Interface Contract

A driver reports each tool call for governance before it runs. The
contract is defined in `governed-driver.ts`:

```typescript
interface Driver {
   readonly name: string;
   readonly supportsToolCallGovernance: boolean;
   execute(command: string, options?: ExecuteOptions): Promise<DriverResult>;
   close(): Promise<void>;
}
```

**Types** (all defined in `governed-driver.ts`):

```typescript
interface ExecuteOptions {
   context?:    string;   // Prepended to command before dispatch
   sessionId?:  string;   // Resume an existing session
   model?:      string;   // Model to use for this call
   onToolCall?: (report: ToolCallReport) => Promise<ToolCallDecision>;
   signal?:     AbortSignal;   // Aborts the turn; supplied per call
}

interface DriverResult {
   text:      string;
   sessionId: string;
   toolCalls: ToolCallOutcome[];   // every reported call and its decision
   cancelled?: boolean;            // true when the turn ended because the signal aborted
}

interface ToolCallReport {
   kind:      ToolCallKind;   // 'read' | 'edit' | 'delete' | 'move' | 'search'
                              // | 'execute' | 'fetch' | 'think' | 'other'
   title:     string;
   command?:  string;
   paths?:    string[];
   diff?:     string;
   rawInput?: unknown;
}

type ToolCallDecision = 'approve' | 'deny';

interface ToolCallOutcome {
   report:   ToolCallReport;
   decision: ToolCallDecision;
}
```

**Contract rules:**
- `command` is required and must be a non-empty string
- `options.model`, when provided, must be a non-empty string
- `execute` is asynchronous and resolves a `DriverResult`
- `onToolCall` is passed per `execute` call, never at driver construction
- The driver MUST report every tool call through `onToolCall` BEFORE the
  call runs, and run it only when the answer is exactly `'approve'`
- Fail closed: with no `onToolCall`, or any answer other than `'approve'`,
  the call is denied and MUST NOT run. `gateToolCall(options, report)`
  implements this rule; use it
- A denied call is a normal result (a `'deny'` outcome in `toolCalls`),
  not an error. If `onToolCall` throws or rejects, the call does not run
  and `execute` rejects with that failure, except after an abort (below)
- `ToolCallDecision` has no `'ask'`: any question to the user is resolved
  before the decision reaches the driver
- `ToolCallReport` carries no protocol types: `kind` and `title` always;
  `command`, `paths`, `diff`, and `rawInput` when applicable
- The driver MUST declare `supportsToolCallGovernance: true`.
  `declaresToolCallGovernance(driver)` is true only for an exact `true`
- `signal` is passed per `execute` call, never at driver construction.
  Honoring it is optional: a driver that ignores `signal` and
  `cancelled` still conforms, but a cancel then leaves its session busy
  until `execute` settles
- A signal already aborted at entry settles `cancelled: true` without
  doing work, with or without a handler
- After an abort, no new tool call reaches `onToolCall`, and `execute`
  settles `cancelled` without waiting for a pending decision. A late
  answer, an approve included, is discarded and the call never runs.
  Decisions made before the abort stay in `toolCalls`
- A turn whose signal aborted settles `cancelled` whatever the downstream
  reason. A throw or rejection from `onToolCall` after the abort also
  settles `cancelled`; without an abort it still rejects
- No shared abort state: a settled turn's signal cannot cancel a later
  turn, and aborting one concurrent turn leaves another running
- `DriverResult.sessionId` may be empty only when cancelled before a
  downstream session existed
- `close()` is required. It takes no argument and releases every process
  the driver started; with none started it resolves at once. It is
  idempotent and safe to call concurrently: every call resolves and the
  downstream agent is released once
- The driver MUST NOT throw on empty `options` — treat it as `{}`

**Protocol layer:** a prompt fails before any work starts, with
`DriverGovernanceUnsupportedError`, when the driver's declaration is
`false` or absent. There is no warn mode and no setting.

On a cancel the protocol layer aborts the signal and keeps the session
busy until `execute` settles. On disconnect it aborts every turn and
awaits `close()`.

See `__tests__/fake-governed-driver.ts` as a minimal reference
implementation. It honors the signal and implements `close`.

---

## How to Implement a Custom Driver

1. Implement `Driver` from `governed-driver.ts`, declaring a `name` and
   `supportsToolCallGovernance: true`, and export a `createDriver`
   factory. The Driver Catalog loads a driver by importing its module and
   calling `createDriver({ logger })`. A sketch, provider specifics
   omitted:

```typescript
import {
   Driver,
   ToolCallOutcome,
   gateToolCall,
   validateExecuteArgs,
} from './governed-driver.js';
import type { Logger } from '../shared/logger.js';

export function createDriver({ logger }: { logger: Logger }): Driver {
   return {
      name:                       'my-driver',
      supportsToolCallGovernance: true,
      async execute(command, options = {}) {
         validateExecuteArgs(command, options);
         const toolCalls: ToolCallOutcome[] = [];
         // ...start the provider session with `command`...
         // If `options.signal` is aborted (at entry, or while a decision is
         // pending), stop and return { text, sessionId, toolCalls, cancelled: true }
         // For each tool call the provider wants to run, build a `report`:
         //    const decision = await gateToolCall(options, report);
         //    toolCalls.push({ report, decision });
         //    run the call only when 'approve' === decision
         // ...collect `text` and `sessionId` from the provider...
         return { text, sessionId, toolCalls };
      },
      async close() {
         // ...release every process this driver started; a no-op if none...
      }
   };
}
```

2. Call `validateExecuteArgs(command, options)` at the top of `execute` —
   this enforces the argument rules and is required.

3. Route every tool call through `gateToolCall(options, report)` and run
   the call only when it resolves `'approve'`.

4. Honor `options.signal` if the provider can be interrupted, and
   implement `close()` (required; see the contract rules above).

5. Prove the driver with the shared contract suite, in a test under
   `drivers/__tests__/`:

```typescript
import { describeGovernedDriverContract } from './governed-driver.contract.js';

describeGovernedDriverContract('my-driver', () => ({
   driver: createDriver({ logger }),
   script: reports => { /* make the driver attempt these tool calls */ },
   ran:    () => [ /* reports whose side effects actually happened */ ],
   released: () => /* times close() released the downstream agent */ 0,
}));
```

   `script(reports)` sets the tool calls the driver attempts during its
   next `execute`; `ran()` returns the reports that actually ran;
   `released()` returns how many times `close()` actually released the
   downstream agent (the suite expects 0 when nothing was started and 1
   after a started driver is closed, however often `close()` is called).

6. Add a registry entry for the driver, with its `module` (see Registry
   Config Format and How to Register a Custom Driver below). The Driver
   Catalog checks the driver when it is built.

---

## Registry Config Format

The registry is a YAML file that maps driver names to the module that
provides each driver and the models it supports, with optional top-level
preference fields, a per-profile preference section, and a system-level
fallback policy.

```yaml
# Optional: preferred driver when multiple drivers support a model.
# Falls back to registry order if unavailable for the requested model.
preferredDriver: kiro

# Optional: registry-level default (model, driver) pair. It is the
# fallback used when a profile has no `profiles:` entry, or its entry
# fails to resolve (unless fallbackMode is 'fail-fast'). A profile's own
# entry is always tried first. In that fallback, preferredDriver is used
# if it lists the model; otherwise the bound driver, then registry order.
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
    module: <path-to-driver-module>
    models:
      - <model-name>
      - <model-name>
```

**Rules:**
- Each entry key is the driver name (string, required)
- `module` is the path to the file that provides the driver, and exports
  a `createDriver` factory (non-empty string, required; a missing or
  invalid value fails the registry load and names the driver). A relative
  path is read from the registry file's folder; an absolute path also
  works, so a driver can live outside the engine's own files. A TypeScript
  source file is named with a `.js` suffix, as in the source's imports.
- `models` is a list of model name strings (required, must be non-empty)
- `preferredDriver`, `preferredModel`, `profiles`, and `fallbackMode`
  are all optional
- The loader does not check that `preferredDriver`, `preferredModel.driver`
  or `profiles.*.driver` name a driver under `drivers:`; the Driver
  Catalog checks the preferred driver
- Custom driver entries follow the same schema as built-in entries

See `registry.example.yaml` for a complete example with Kiro, Copilot,
a per-profile `profiles:` block, and a custom driver entry (shown as a
comment, because it has no code behind it).

**Registry files:** the registry in use is the project's own
`registry.yaml`, in the same folder as the example and not tracked by git.
Copy `registry.example.yaml` to `registry.yaml` once, then edit the copy.
A missing `registry.yaml` fails to load with an error that points to the
example; the example is never used as a fallback.

---

## How to Register a Custom Driver

Add an entry to your `registry.yaml` under `drivers:`. The key is the
driver's name and must equal the `name` of the driver the factory returns;
`module` is the file that exports `createDriver`:

```yaml
drivers:
  my-local-model:
    module: ./my-local-model-driver.js
    models:
      - llama-3.2-local
      - mistral-7b-local
```

The shipped `registry.example.yaml` has the Kiro and Copilot entries.
Copy it to `registry.yaml` in the same folder and add your entry to the
copy.

---

## Driver Catalog

A Driver Catalog (`driver-catalog.ts`, `buildDriverCatalog`) is built from
a loaded registry. For each entry it checks that:

- the module exists and imports
- it exports `createDriver`
- the factory does not throw and returns a driver
- the driver's `name` equals the registry key
- the driver declares tool-call governance (exactly `true`)

Models and installed CLIs are not checked.

**Failed drivers.** A driver that fails a check is logged once (entry
name, resolved module path, failure kind) and left out of the catalog and
out of `resolverConfig`, the registry the dispatch resolver sees. The other
drivers still load. A driver the factory created and the catalog then
rejected is closed. The failure kinds are the `DRIVER_FAILURE` constants:
module not found, import failed, no createDriver, factory failed, not a
driver, name mismatch, no governance.

**Build failure.** `buildDriverCatalog` rejects with
`DriverCatalogBuildError` when `drivers:` is empty, when every driver
fails, or when the registry defaults cannot select a working driver once
the failed ones are left out. The error lists each failure (name, path,
kind), the resolver's reason where it applies, and how to fix it. Drivers
already created are closed first, so the driver in use is always a working
driver.

**Preferred driver.** It is `preferredModel.driver` if `preferredModel` is
set, else `preferredDriver`, else the first driver listed; names match
exactly. When it is not under `drivers:` (failure kind "not in registry",
for example a typo) or failed a check, the registry still loads. The
catalog sets `preferred.flagged`, logs one `warn` entry, and supplies
`notice`, a text naming the preferred driver, the driver in use and the
kind. The driver in use, `preferred.inUse`, is what the resolver returns
for the registry defaults over the working drivers.

**Using the catalog.** `get(name)` returns a working driver, or throws
`DriverNotInCatalogError`. `names()` lists the working drivers in registry
order. `closeAll()` tries to close every driver, then rethrows the first
failure; it is safe to call again or at the same time.

---

## Model Selection Resolution

Model dispatch resolution for a profile is owned by the model dispatch
resolver, not by this document. See `docs/dev/acp/model-dispatch.md`
for the full algorithm (profile preference → registry default →
combined error, with `auto`-model retry and configurable
`fallbackMode`).

This section covers only the registry-level step that the resolver
calls into (`resolveRegistry`) — matching a `(model, driver)` pair
against the registry:

1. **The given driver lists the model** — if a driver came with the
   request and its `models` list includes the model, use it. For the
   registry defaults the resolver gives `preferredDriver` here.
2. **preferredModel binding matches** — if `preferredModel.model` equals
   the requested model and `preferredModel.driver` lists it, use that
   driver.
3. **preferredDriver lists the model** — use that driver.
4. **First match in registry order** — use the first driver in the
   registry whose `models` list includes the requested model.
5. **No match** — retry with `model = "auto"`: the given driver, else
   `preferredDriver`, else the first driver listed, if it lists `auto`;
   otherwise the first driver that lists `auto`. A named model that no
   driver lists falls back to `auto`; it is not an error.
6. **No driver lists `auto`** — the "no driver available" error, which
   names the requested model. It is the only resolution error.
