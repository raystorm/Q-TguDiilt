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
   close?(): Promise<void>;
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
  Honoring it is optional: a driver that ignores `signal`, `cancelled`
  and `close` still conforms, but a cancel then leaves its session busy
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
- `close()` releases the downstream agent. A driver that holds one must
  offer it. It may be called any number of times, also concurrently, and
  after success it does little more than return
- The driver MUST NOT throw on empty `options` — treat it as `{}`

**Protocol layer:** a prompt fails before any work starts, with
`DriverGovernanceUnsupportedError`, when the driver's declaration is
`false` or absent. There is no warn mode and no setting.

On a cancel the protocol layer aborts the signal and keeps the session
busy until `execute` settles. On disconnect it aborts every turn and
awaits `close()` when present.

See `__tests__/fake-governed-driver.ts` as a minimal reference
implementation. It honors the signal and offers `close`.

---

## How to Implement a Custom Driver

1. Implement `Driver` from `governed-driver.ts`, declaring a `name` and
   `supportsToolCallGovernance: true`. A sketch, provider specifics
   omitted:

```typescript
import {
   Driver,
   ToolCallOutcome,
   gateToolCall,
   validateExecuteArgs,
} from './governed-driver.js';

export function createMyDriver(): Driver {
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
      }
   };
}
```

2. Call `validateExecuteArgs(command, options)` at the top of `execute` —
   this enforces the argument rules and is required.

3. Route every tool call through `gateToolCall(options, report)` and run
   the call only when it resolves `'approve'`.

4. Honor `options.signal` if the provider can be interrupted, and offer
   `close()` if the driver holds a downstream agent (see the contract
   rules above).

5. Prove the driver with the shared contract suite, in a test under
   `drivers/__tests__/`:

```typescript
import { describeGovernedDriverContract } from './governed-driver.contract.js';

describeGovernedDriverContract('my-driver', () => ({
   driver: createMyDriver(),
   script: reports => { /* make the driver attempt these tool calls */ },
   ran:    () => [ /* reports whose side effects actually happened */ ],
   released: () => /* times close() released the downstream agent */ 0,
}));
```

   `script(reports)` sets the tool calls the driver attempts during its
   next `execute`; `ran()` returns the reports that actually ran;
   `released()` returns how many times `close()` actually released the
   downstream agent (the suite expects once, however often `close()` is
   called).

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
