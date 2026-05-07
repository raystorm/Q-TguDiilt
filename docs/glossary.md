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

Prompt Engineering (Legacy)
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
: A structured container for cognitive state.  
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
user-triggered, summarized, confirmed, approved, then written.  
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

---

### Glossary Formatting Notes

This glossary uses GitHub definition‑list syntax.  
Definitions should be concise, intention‑revealing, and grouped conceptually.  
Line wrapping is natural; headings are not used for terms.
