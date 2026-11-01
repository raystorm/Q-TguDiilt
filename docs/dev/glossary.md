# 📘 **GLOSSARY**

*A reference dictionary for the terminology used throughout this architecture.*

---

Cognitive Engineering
: The discipline of designing, governing, and shaping the reasoning processes of AI systems.  
Focuses on drift‑resistant thinking, context structuring, and semantic clarity.  
Cognitive engineering governs **how an AI thinks**, independent of how many agents exist.  
Often includes **self‑improvement loops** such as reflection, correction, and improvement.

Agentic Engineering
: A discipline for designing **governed, multi‑agent workflows**.  
Emphasizes explicit **profile contracts**, **drift‑resistant reasoning**, and **context continuity**.  
Agentic engineering is not AI‑assisted coding;  
it is the **architecture** behind multi‑agent systems that reason, coordinate,  
and maintain state across tasks.

AI Engineering
: The broader discipline of building AI systems that are reliable, governed, and production‑ready.  
Includes model integration, orchestration, safety boundaries, and lifecycle management.

AI Development
: Using AI tools to write, review, or assist with code.  
Includes AI pair programming, code generation, refactoring, and debugging.  
AI Development is a **workflow enhancement**, not an architectural discipline.

Context Engineering
: The discipline of structuring, governing, and preserving **cognitive context** across agents and tasks.  
Includes context capsules, suspend/resume semantics, lineage tracking,  
boundary enforcement, and drift‑resistant context shaping.  
Ensures agents operate with **stable, intentional, auditable context**, not ad‑hoc prompts.

Context Governance
: The discipline of defining the rules, boundaries,  
and lifecycle policies that cognitive context must follow.  
Ensures context remains valid, intentional, bounded, auditable,  
and compliant with profile contracts.  
Prevents drift, unauthorized mutation, and context collapse.

Context Control
: The operational enforcement layer that applies the rules defined by Context Governance.  
Prevents unauthorized mutations, validates context capsules,  
enforces access rules, and maintains context integrity across workflows.  
Where Context Engineering defines structure and Context Governance defines rules,  
Context Control enforces them at runtime.

Workflow Artifact
: A user-visible project or workflow file whose creation or modification materially affects the workflow.

: **Includes - Persistent Workflow Artifacts**  
Files that represent long-term project state and must be versioned.  
Source code, tests, configuration files, persistent documentation, shared team resources.

: **Includes - Transient Workflow Artifacts**  
Files that represent workflow state and must NOT be versioned.  
any file inside `.amazonq/work/`, or subdirectories

: **Excludes - System-Owned (Not Workflow Artifacts)**  
Internal plumbing and runtime files that are never treated as workflow artifacts.  
System-owned plumbing (workflow.log, auto-suspend state, internal metadata), temporary files, working files.

: **Invariant**  
All creation or modification of workflow artifacts requires explicit user confirmation.

Command (Rule Category)
: An on‑demand operational routine stored in `.workflow/rules/commands/`.  
Loaded only when triggered by `process @_commandName`  
in an already‑loaded rule.  
Never loaded at profile activation.  
Commands are deferred procedures, not always‑loaded governance.

Governance Density
: The ratio of actionable rules to token cost.  
Used to validate rule quality during rule changes and diagnostic prompts.  
High density means predominantly atomic, constraint‑bearing,  
directly executable content with minimal narrative content.

Context Gathering
: A mandatory pre‑work pattern where profiles (Doctor, Enforcer)  
gather actual system state — FEATURE.md, workflow log, git diff —  
before performing diagnosis or validation.  
Prevents profiles from working blind or on stale assumptions.

Safe Undo
: A governed reversal pattern using manual fsReplace operations  
instead of git commands.  
Used when changes were made incorrectly during active workflow  
where uncommitted work in other files is at risk.  
Git commands may be used only if no other uncommitted changes  
exist in the affected file.

Manual Prompt Engineering (Legacy)
: The practice of shaping model outputs through carefully crafted prompts.  
Operates at the **surface layer** of model interaction.  
In this architecture, considered a **legacy technique**  
superseded by context engineering and agentic engineering.

Governed Prompting (Legacy)
: The practice of sending prompts to activate profiles  
and operate within the governed workflow system.  
Uses explicit profile activation, rule‑bound commands,  
and standardized handoffs to ensure deterministic behavior,  
traceability, and alignment with the system's governance model.  
In this architecture, considered a **legacy practice**  
superseded by **Command Prompts**, which provide the same deterministic,  
governed behavior through explicit command invocation  
rather than practice description.

Prompt
: The atomic unit of instruction sent to an AI model.  
In this system, prompts serve three roles:  
**Command Prompts** (user‑facing entry points that control workflow),  
**Saved Prompts** (implementation infrastructure  
that Command Prompts invoke to set up workflow plumbing),  
and **conversational prompts** (direct user messages  
for correction, clarification, or guidance).

Command Prompt
: A user‑facing entry point that controls and activates workflow state.  
Invoked by the user to drive the system  
(`@handoff`, `@start`, `@as`, `@send`).  
Uses Saved Prompts as implementation infrastructure.  
Command Prompts control workflow; Saved Prompts implement the plumbing.

Activation Rule
: A rule in `.amazonq/rules/` loaded by Amazon Q's native rule system.  
Always active in every chat, regardless of profile.  
Provides bootstrap behavior (correctness, profile activation triggers)  
before any profile‑specific governance loads.

Profile Contract
: A formal specification of an agent's identity, responsibilities, boundaries,  
and allowed behaviors.  
Prevents drift, enforces role clarity,  
and creates predictable multi‑agent coordination.

Context Capsule
: A structured emergent container for cognitive state.  
Preserves task intent, constraints, history, lineage, agent roles,  
and environmental assumptions.  
Enables suspend/resume, multi‑story workflows,  
and continuity across outages.

Semantic Lineage
: A traceable record of how reasoning, decisions, and artifacts evolve over time.  
Ensures auditability, teachability, drift detection, and reproducibility.  
The cognitive equivalent of version control.

Drift‑Resistant Reasoning
: A set of architectural constraints and patterns that prevent agents from  
losing context, hallucinating new rules, violating contracts,  
mutating identity, or collapsing boundaries.  
Enforced through contracts, capsules, lineage, and governed workflows.

Profile Flicker
: A diagnostic signal indicating a profile has lost stability.  
Manifests as sudden tone shifts, generic disclaimers,  
builder‑style language, or profile inconsistency.  
Used in diagnostic prompts to assess context health.

Changeover
: A governed workflow operation where one profile prepares control and
context for another profile. All changeovers follow the same invariant:
user-triggered, then written.  
Handoffs (linear) and Side Trips (parallel) are two types of changeovers.

Change
: A rule-facing categorization that groups the commands which *initiate* a Changeover.  
The Change category includes `@handoff` (linear) and `@send` (parallel).  
Rules referring to "Change" apply uniformly to both commands.

Begin
: A rule-facing categorization that groups the commands which *activate* a Changeover.  
The Begin category includes `@start` (linear) and `@receive` (parallel).  
Rules referring to "Begin" apply uniformly to both commands.


Handoff
: The intentional transfer of control, responsibility, and context  
from one profile to another.  
Marks a state transition in the Main Thread  
and ensures work continues with the correct role, rules, and artifacts.

Thread
: an isolated workflow execution context, represented by a single chat instance,
with its own workflowId and state.

Main Thread
: The primary, sequential execution path of a workflow cycle  
(e.g., Architect → Planner → … → Retrospective).

Side Trip
: A temporary, secondary, isolated workflow that runs outside the Main Thread.  
Used for clarity, diagnosis, exploration,  
or small corrective actions without disturbing the primary workflow's state or momentum.

Escalation
: A governed routing decision where a profile determines  
work requires another profile's authority or expertise.  
Not a separate changeover type — the escalating profile chooses  
the appropriate mechanism: handoff (needs result back)  
or side trip (doesn't need result back).

Inquiry Mode
: A workflow safety state activated by `@inquiry`.  
Allows questions without triggering workflow commands,  
state transitions, file creation, or workflow execution.  
Normal reasoning and analysis are allowed.  
Exit by starting a new message without `@inquiry`.

Workflow ID
: A unique, stable identifier assigned to a workflow execution
at the moment the workflow begins.  
It is used to correlate all artifacts, logs, suspends, resumes,
and auto‑suspend checkpoints that belong to the same workflow instance.

Minimal Code
: The architectural principle that changes should be the smallest, simplest change  
that satisfies the requirement.  
Avoids over‑engineering, unnecessary abstraction,  
and speculative design — favoring clarity, correctness, and maintainability.

Pattern Earning
: The discipline of introducing architectural patterns  
only when justified by real, repeated need.  
A pattern is "earned" through concrete use cases — not anticipated ones —  
ensuring the system grows through evidence, not imagination.

Story
: The atomic unit of work in the governed workflow system.  
Expresses a user‑facing or technical need, defines intent and acceptance criteria,  
and provides the structure profiles use to plan, sequence, implement,  
and evaluate work.

Suspend/Resume Semantics
: A mechanism that allows cognitive workflows to pause, externalize state,  
and resume without loss of context or identity.  
Critical for long‑running tasks, multi‑agent handoffs, outage recovery,  
and multi‑story workflows.

Teachable Artifact
: Any output designed to be intention‑revealing, diff‑minimizing,  
structurally consistent, reusable, and auditable.  
Examples include diagrams, contracts, lineage logs,  
and structured reasoning outputs.

Override Grammar
: A formal, explicit syntax (`Override:`) used to intentionally break or modify rules.  
Prevents accidental drift and makes deviations grep‑able, auditable, and intentional.

Governed Cognitive Workflow
: A workflow where an AI system (single or multi‑agent)  
performs **structured, self‑correcting reasoning** under explicit governance.  
Includes rules, contracts, boundaries, lineage, context capsules,  
drift‑resistant reasoning, self‑improvement loops,  
and continuity across tasks.  
This is the core of **cognitive engineering**.

Multi‑Agent Orchestration
: Coordinating multiple agents with distinct roles, contracts, and contexts.  
Includes task routing, context passing, conflict resolution,  
lineage merging, and boundary enforcement.

Full Workflow Loop
: A workflow that implements the complete three‑loop meta structure: **Plan → Implement → Improve**.  
A full workflow loop may reuse or combine existing domain loops (Dev, Ops, Strategy, Sec).  
It is intention‑revealing, deterministic, self‑correcting, and stable enough to be added to the system.

Short Loop
: A minimal, single‑loop workflow that performs only **Implement**.  
Short loops are still governed and follow all profile and rule invariants,  
but they do not include planning or improvement.  
Used for small, atomic actions that do not require the full meta loop.

Meta Loop
: The universal, immutable structure that all full workflows must follow: **Plan → Implement → Improve**.  
The meta loop defines the governing execution shape and ensures predictability and drift‑resistance.  
Its **structure** is immutable; its **content** (the specific loops used for each stage) is extensible.

Free Prompting
: The earliest phase of working with AI systems,  
characterized by raw, unstructured prompts with no roles, no profiles,  
no capsules, and no workflow.  
Everything is manual; context is repeated constantly; drift is common.  
This phase revealed the limitations of prompting itself.

Meta‑Prompting
: The attempt to scale prompting by having one AI generate prompts for another AI  
(e.g., Microsoft Copilot generating prompts for Amazon Q).  
In practice, this produces more complexity, more drift,  
and more correction work.  
Meta‑Prompting exposed prompting's structural limits  
and pushed the system toward architecture.

BMAD Method
: A prompting technique based on a Builder → Tester → Validator chain.  
Originally a manual, copy/paste workflow using single prompts for each step.  
Introduced sequential roles but lacked governance, continuity,  
and context management.  
BMAD was the bridge between prompting and architecture.

Prompt Chaining
: A manual sequence of prompts where the output of one step (Builder)  
is passed to the next (Tester), then to the next (Validator).  
Each step requires re‑establishing context, usually through copy/paste.  
Prompt Chaining is the structural ancestor of workflows  
and revealed the need for persistent context, formal roles,  
and a way to pass information without repetition.

Persona
: An informal role used during early prompting experiments  
(e.g., "planner," "reviewer," "critic").  
Personas were conceptual and inconsistent, lacking boundaries, contracts, or governance.  
They were the precursor to **profiles**,  
which replaced personas as the system matured.

Cycle
: A single governed pass through the workflow profile sequence  
(e.g., Planner → TestDesigner → PE → Builder → Enforcer → Documentor → Retrospective).  
A Cycle begins when a story enters the workflow and ends  
when Retrospective completes or the user closes the loop.

Activation Layer
: The minimal bootstrap rule layer stored in `.amazonq/rules/`.  
Always loaded by Amazon Q's native rule system in every chat,  
regardless of profile.  
Provides correctness guarantees and profile activation triggers.

Governance Layer
: The profile‑scoped rule layer stored in `.workflow/rules/`.  
Loaded explicitly during profile activation based on each profile's Uses list.  
Defines behavior, boundaries, communication standards, and workflow mechanics.

ACP (Agent Client Protocol)
: The protocol an IDE uses to drive an agent over stdio, as JSON-RPC.  
The IDE speaks ACP to the Protocol Layer; every supported driver reaches
its provider over ACP.  
Spec: https://agentclientprotocol.com

Protocol Layer
: The part of the engine (`.workflow/acp/protocol/`) that terminates ACP
for the IDE. Also called the service boundary.  
Maps each session to a workflow, turns each prompt into one driver call,
and answers every tool call the driver reports through governance.

Session
: One ACP conversation between an IDE and the service.  
Maps to exactly one workflow (`workflowId`), carries the driver's
continuity id from turn to turn, and runs at most one turn at a time.  
Its driver and model are resolved once, when it opens (new or reopened),
and stay the same for every turn.  
With an ACP driver, a session has its own Downstream Agent process. It lasts
until disconnect, unless the core ends it earlier (cancel deadline, crash,
timeout).

Turn
: One prompt and its response: a single ACP `session/prompt` (ACP calls it a
prompt turn), run as exactly one `driver.execute(...)`.  
A session runs at most one turn at a time.  
A turn ends completed (a Normal End or one of three abnormal ends),
cancelled (the user stopped it), or failed.

Wind-down
: The time between a cancel and the driver settling.  
The turn is aborted but the session stays busy, and a new prompt is
rejected as retryable until the driver finishes.

Provider
: The AI service or agent a driver reaches, for example Kiro or Copilot.  
Normally a CLI command that the driver launches. A Driver is this system's
adapter to a provider.

Driver
: The provider-neutral adapter the Protocol Layer calls to run a turn on a Provider.  
Supports and integrates with ACP Governance to check tool calls and only runs them on `approve`.
Releases every process it started when closed. Drivers are listed by name in the Driver Registry,
each with a module that exports `createDriver`.

Driver Registry
: A YAML config mapping driver names to a module and the models they support.  
Also holds per-profile preferences, the preferred driver and model
(`preferred`), and the fallback mode. A top-level key it does not know is
rejected. Model Dispatch reads it, and the Driver Catalog loads the drivers it names.

Driver Catalog
: The working drivers built from a Driver Registry.  
Loads each entry's module and checks it; a driver that fails is logged and left out,
and the others still load. Hands out drivers by name, flags a missing or failed preferred driver
or a preferred model its driver does not list (and supplies a Notice),
and closes every driver on shutdown.

Notice
: The text a chat shows when the preferred driver or model cannot be used.  
Names what is preferred, what is used instead, and why. It leads the first
reply of every session, and later replies until one turn has a Normal End.

Service Log
: The operational log, `.workflow/work/acp.log`.  
Records what the service did: connection lifecycle, sessions, stops, start-up
and configuration events, and errors by kind. It can hold text from the
service itself; it never holds text from a Provider or an agent, or the
user's content. The shared writer redacts free text in it.

Diagnostic Log
: The failure log, `.workflow/work/acp-diagnostic.log`.  
Holds one record for each failure of a Downstream Agent, with the agent's last
output (redacted, not guaranteed). Always on, owner-only, capped at 1 MiB with
one rotated copy. The chat error for the failure ends with a line naming it.

Model Dispatch
: Choosing the model and driver for a profile's commands.  
Profile preference first, then the registry defaults, then an error.
The `auto` model is the fallback when a named model does not resolve.
A session is resolved once, when it opens, from the registry defaults (it has
no profile yet).

Tool Call
: An action the AI takes: read, edit, delete, move, search, execute,
fetch, think, or other.  
The driver reports it, with its kind and details (command, paths, diff,
raw input), before it runs.

Governance Engine
: Evaluates a tool call against a declarative YAML config and returns
`approve`, `deny`, or `ask`.  
Rules match on kind, command, path, and file name; first match wins.

Ask
: A governance outcome that sends the decision to the user.  
The user first sees the specifics (command, paths, diff, parameters),
then the approval request. Anything but an explicit Allow is a deny.
The specifics appear on the call's Card.

Fail Closed
: When governance cannot decide safely, the outcome is never approve.  
A bad config throws, an unparsable command asks, and a failed or invalid
ask denies.

Downstream Agent
: The ACP agent process (Kiro, Copilot) the service drives for the IDE.  
One process per downstream session. The IDE is upstream of the service, the
agent is downstream.

ACP Driver Core
: The shared driver code that talks ACP to any Downstream Agent.  
The service is the ACP client here, not the agent. A concrete driver supplies
only the launch command and optional checks.

Driver Policy
: Optional checks a driver gives the ACP Driver Core: one on the agent's
`initialize` answer, one before the first prompt.  
A refusal ends the agent, creates no session, and its text is the error message.

Unsafe Setting
: An agent setting, such as Copilot's `allow_all` or `autopilot`, that lets
tools run without asking.  
The core refuses a session that starts with one on, and warns when one is
switched on later.

Wind-down Deadline
: The time an agent gets to answer a cancel before it is ended.  
It counts from the abort. The next prompt starts a fresh agent.

Ending Sequence
: How the core ends an agent: close stdin, then SIGTERM, then SIGKILL, sent to
its process group.  
An agent that already exited is never touched.

Shutdown Handler
: The one function that runs the disconnect once, whichever comes first: stdin
end, SIGTERM, SIGINT or SIGHUP.  
The service then exits 0 after a clean disconnect and 1 otherwise.

Tool-Call Report
: What governance evaluates for one tool call: kind, command, paths, diff and
raw input, and the agent's id for the call when it has one.  
Built from the agent's stream and its permission request.

Turn Update
: One thing the agent produced during a Turn, reported as it happens: a
piece of text, or the state of a tool call (id, kind, title, status, and
the command or paths).  
A Driver reports them through the optional `onUpdate` callback, in the order
the agent produced them. A driver that cannot stream sends its text in the
result instead.

Update Sink
: The one place every `session/update` of a prompt goes through.  
Sends leave in the order they were queued. A failed send is logged once and
the rest of that prompt's sends are dropped; the Turn carries on.

Normal End
: A Turn that ended `completed` and was not cancelled.  
Only a Normal End stops the Notice from leading the next replies. Three
abnormal ends (output limit, request limit, refusal) each get a chat line
and their own stop reason.

Card
: How the chat shows one Tool Call: a `tool_call` the IDE keeps updating.  
Shows the kind, the agent's title, the status, and the command or paths. Never
a diff or other raw input. Its title ends with the Outcome once governance has
finished with the call, and an Ask puts its specifics on it.

Outcome
: How governance finished with a Tool Call, shown at the end of its Card's
title: approved by governance, denied by governance, allowed by you, rejected
by you, cancelled, or Approval process errored: request denied.  
A denial, a rejection and the errored outcome also mark the Card failed.

Unrequested Call
: A tool call that ran with no permission request.  
The service logs a warning; it cannot stop the call.

Redaction
: Replacing text that looks like a secret before it reaches the user.  
Pattern based, not a guarantee.

Stderr Tail
: The last lines a Downstream Agent printed, bounded and redacted, kept for
error messages.

---

### Glossary Formatting Notes

This glossary uses GitHub definition‑list syntax.  
```markdown
Term
: Definition text...
```

Definitions are be concise, intention‑revealing, and grouped conceptually.  
The glossary maintains a consistent ordering of terms.

Glossary terms do not have headings, or additional formatting. The term itself is the anchor.  
Line wrapping is natural between 80 - 100 characters.
The glossary maintains a consistent cadence and tone across entries.