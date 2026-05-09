# AI Workflow System

## Quick Summary

The AI Workflow System is a rule‑driven, profile‑based workflow engine modeled after an Agile software team.
Each Profile has a single responsibility, and work moves between them through explicit file‑based [handoffs](../glossary.md#handoff).
Every change follows the same deterministic loop  
`Design/Plan → Prompt → Build → Verify → Document → Improve`  
ensuring predictable, reviewable, and consistent execution.
Profiles run in isolated chat tabs, do not share context, and follow rule files that define their behavior.
All actions are logged for retrospective analysis,
allowing the system to improve over time through explicit, user‑approved changes.


## Overview

The AI Workflow System uses profiles to handle development tasks.
Each profile has specific responsibilities and follows defined rules stored in `.workflow/rules/`.
Profiles collaborate through explicit changeovers,
and all work is logged to enable retrospective analysis and continuous improvement.

## Origins

This workflow was originally based on how a *human agile software development team*
Would typically be structured and operate. Where each [Story](../glossary.md#story)/Workflow/Item equates to a sprint.
Working through that model, it was realized that mapping *PROFILES* to the Agile SDLC loop phases
makes more sense, and that is the version of profiles documented below.

## Purpose

Modern AI is inconsistent. It drifts, forgets rules, and assumes contexts and standards,
that can conflict with the actual project standards and idioms.
This system addresses that by mimicking the structure of a high‑performance Agile software team:
clear roles, explicit handoffs, stable responsibilities, and retrospective analysis to improve over time.

The system uses rule‑encoded profiles and saved commands to simulate team behavior.
Each change is run through the full Agile lifecycle of a story — from design, to implementation,
to verification, to documentation, to retrospective —
ensuring that AI‑generated work is predictable, reviewable, and aligned with project standards.


## Core Concepts

**Profiles** — Specialized AI agents with focused responsibilities (Builder, Enforcer, TestDesigner, etc.)

**Handoffs** — Work passes between profiles when tasks require different expertise.
Profiles use a file based methodology, so profiles can run completely independently in separate chat tabs.

**Workflow Logging** — All profile actions are logged to `.amazonq/workflow.log` for retrospective analysis

**Rules** —
Profiles follow rules in `.workflow/rules/` covering architecture, tech stack, communication, and workflows
The Rules files are also how the profiles are encoded.

## Conceptual Patterns

The AI Workflow System is structured like an Agile software team.
Each profile represents a specialized role with a single responsibility,
and work moves between profiles through explicit file‑based handoffs.
Profiles run independently in separate chat tabs,
follow rule files that define their behavior, and never switch roles automatically.

At a high level, every workflow moves through the same loop:
```text
Design/Plan → Prompt → Build → Verify → Document → Improve
```
The specific steps may change and be extended. Design and then plan.
And they can be Split, workflow planning vs test planning for example.

---

## The Gap This System Fills

*(As of April 2026)*

Modern AI tools, offer powerful capabilities, but they often fall short
in software development. This system was designed to address AIs fundamental limitations
without explicit governance and workflow.  
It tackles the following structural gaps that commonly arise:
  * **Drift and role collapse** — models shift behavior mid‑workflow and blur responsibilities
  * **Context loss and stale documentation** — long tasks degrade, and keeping docs aligned is costly
  * **Human‑targeted planning** — planning tools assume human cadence and judgment, not machine execution
  * **Uncoordinated parallelism** — multiple agents run at once but interfere without shared rules
  * **Inconsistent quality** — outputs vary run‑to‑run, making review and maintenance difficult
  * **No enforced lifecycle or rigor** — no deterministic process, no audit trail, no reproducibility

**These aren’t bugs**  
They’re a natural consequence of using AI without explicit structure, governance,
or team‑like orchestration.

---

## Differentiators

This system is not a single AI improvising across tasks.
It is a structured workflow that behaves like a disciplined Agile engineering team.
Three capabilities make it fundamentally different from normal AI usage:

### 1. Full Agile Lifecycle Simulation

Every change moves through the same structured loop:

**Design/Plan → Prompt → Build → Verify → Document → Improve**

This mirrors a real engineering team and ensures that AI‑generated work is consistent,
reviewable, and aligned with project standards.

### 2. Parallelism Without Interference

Profiles run in separate chat tabs using file‑based handoffs.  
They do not share memory, context, or conversation history.  
This enables isolated execution, reproducible workflows, and team‑like parallelism
that normal AI chat cannot achieve.

### 3. Stable, Predictable Behavior

Profiles follow rule files that define their responsibilities, boundaries, and outputs.  
Because each profile performs one job and never switches roles automatically,
the system behaves the same way every time — eliminating drift and improvisation.

### 4. PromptEngineer as a Required Step

No profile calls Builder directly.  
PromptEngineer always constructs the Builder prompt, ensuring clarity,
[Minimal Code](../glossary.md#minimal-code) principles, and consistent adherence to rules.  
Users *can* bypass this, but the system never does.

### 5. Rule Governance and Project Level Overrides

Rules follow a consistent structure, overridable Rules have a companion `-project.md`.
Project specific files may override or supersede core rules. 
Overrides must be explicitly tagged `Override:`

```markdown
Override:
{new rule}
{Another new rule}
```

This makes overrides explicit, and easy to find.
See: [governance.md](governance.md#4-override-mechanism) for details.

---

## Common Profiles

**Operator** — Routes requests to appropriate profiles, does not perform work itself

**Builder** — Writes code, implements features, follows formatting and architecture rules

**Enforcer** —
Reviews code, checks formatting, tests, and architecture alignment (aliases: Verifier, Validator, 🔫)

**TestDesigner** —
Analyzes systems and changes to identify test scenarios (aliases: TD, Provoker, Hunter)

**Documentor** —
Writes documentation, commit messages, diffs, and story descriptions (aliases: commit, keeper, ledger, Engraver)

**Planner** —
Writes user stories, backlog items, manages agile flow (aliases: PO, ProductOwner)

**Architect** — Defines system design, domain models, structure, and long-term direction

**Analyst** —
Reads code, explains behavior, traces logic, and ambiguity resolution. (aliases: Analyzer, Auditor, 🔍, 🔎)

**PromptEngineer** —
Writes prompts for AI agents following [Command Prompt](../glossary.md#command-prompt) patterns (aliases: PE, Prompter)

**Doctor** —
Diagnoses failures, applies minimal safe fixes, escalates when issues exceed scope (aliases: Dr, DR, Medic, 🩺)

**Retrospective** —
Analyzes completed workflows, identifies improvements, highlights successes (aliases: Retro, Iterator, 🔄)

## Workflow Patterns

### Example workflow for a single story

User → Planner → TestDesigner → PromptEngineer → Builder → Enforcer → Documentor → Retrospective

### Test-Driven Development (TDD)

*Note:* This is the default workflow pattern.

1. **Planner** — Determine story sequencing
2. **TestDesigner** — Analyze requirements, design test scenarios (Given/When/Then), Determine TDD
3. **PromptEngineer** — Create Builder prompt for test implementation
4. **Builder** — Implement tests and feature, show diffs
5. **Enforcer** — Verify tests pass, check code quality
6. **Documentor** — Generate commit message following style guide
7. **Retrospective** — Analyze workflow, output Keep/Stop/Start recommendations

### Straight Forward Build Workflow

1. **Planner** — Determine story sequencing
2. **PromptEngineer** — Create Builder prompt following Command Prompt patterns
3. **Builder** — Implement feature with tests, show diffs
4. **Enforcer** — Review code, run tests, verify alignment with rules
5. **Documentor** — Generate commit message following style guide
6. **Retrospective** — Analyze workflow, output Keep/Stop/Start recommendations

### Retrospective Workflow

1. **Retrospective** — Parse `.amazonq/workflow.log`, identify patterns
2. **Retrospective** — Output Keep/Stop/Start recommendations, offer improvement options
3. **Retrospective** — Create artifact in `.amazonq/work/current/`, use `@send [Profile]` for cross-tab work
4. **Target Profile** — Process improvement in new tab (via `@receive`)
5. **Retrospective** — Clean up workflow files when done

### Multi-Story Feature Workflow

1. **Architect** — Analyze feature, identify if multi-story, recommend story breakdown
2. **Planner** — Create FEATURE.md with story list, write Story 1
3. **[Execute Story 1 workflow]** — Straight-Forward build or TDD workflow
4. **Documentor** — Commit Story 1, update FEATURE.md progress
5. **[Repeat for remaining stories]** — Continue with Story 2, 3, etc.
6. **Retrospective** — Analyze complete feature workflow, clean up FEATURE.md

### AI Profile Maintenance

1. **Architect** — Define profile responsibilities, boundaries, and behavior
2. **PromptEngineer** — Update profile rule files in `.workflow/rules/profiles/`

### AI Prompt/Rule Maintenance

1. **Planner** — Write user story for rule change
2. **TestDesigner** *(if needed)* — Determine if validation scenarios are required
3. **PromptEngineer** — Edit rules files directly (no Builder handoff)
4. **Enforcer** — Validate rules and documentation changes
5. **Documentor** — Create commit message

## System Invariants & Principles

The AI Workflow System is structured, disciplined, and governed.  
These invariants define what the system *always* does, what it *never* does,
and how profiles behave.

### 1. Profile Stability
**Profiles never auto‑switch.**
A profile remains active until the user explicitly switches or triggers a saved command.  
The system never infers or guesses which profile should run next.

#### 1.1 Single‑Responsibility Profiles

Each profile performs only its own responsibilities.  
When work falls outside its domain, it escalates, or stops, rather than improvises.

### 2. Profiles Do Not Perform Each Other’s Jobs
Builder does not design.  
Architect does not write code.  
Enforcer does not generate prompts.  
Each profile has one responsibility and stays within it.  
When a profile encounters work outside its scope, it escalates to the appropriate profile.

### 3. Users Can Bypass the Workflow (But the System Never Does)
The system enforces discipline internally:
- no profile calls Builder directly (all Builder work routes through PromptEngineer)
- no profile skips PromptEngineer
- no profile modifies files without explicit user confirmation
- Planner escalates domain behavior questions to Architect
- Doctor escalates architectural issues to Architect

Users *can* break the loop, but the system itself never will.

### 4. Explicit User Confirmation

No file is ever modified without explicit user approval.  
Builder, Doctor, and Enforcer all require confirmation before writing any workflow artifact.

### 5. Explicit Context, No Implicit Sharing

Profiles do not share chat history or memory.  
All communication happens through explicit file‑based changeovers.  
This prevents drift, hidden dependencies, and accidental coupling.

### 6. No Autonomous Rule Changes

Retrospective may recommend improvements, but:
* rules are never modified automatically
* user approval is always required
* changes are explicit, reviewable, and logged

### 7. Minimal, Task‑Bound Work
Profiles only act on the current task.  
They do not anticipate future steps, generate extra files, or apply patterns prematurely.  
Minimal‑change principles always apply.

### 8. Pattern Earning

[Patterns are earned](../glossary.md#pattern-earning), not assumed.  
A pattern is applied only when the task and artifacts justify it.  
Partial implementation is acceptable.

### 9. Context‑Aware Changes

The system gathers and checks relevant context before acting.
Profiles do not rely on chat history or assumptions.
They ground their behavior in explicit artifacts.

### 10. Workflow Logging

Profiles log *workflow_start* and key events.  
This enables retrospective analysis, debugging, and the **self-improving loop**.

### 11. Human Judgment Remains Central

The system does not replace:
* product decisions
* architectural intent
* prioritization
* acceptance criteria
* domain expertise

***The system amplifies human judgment; it does not eliminate it.***

## Workflow Logging

Each workflow execution is assigned a unique [Workflow ID](../glossary.md#workflow-id),
which ties together all logs, suspends, resumes, and workflow artifacts.

All profiles that reference `workflow/logging.md` must log:
- `workflow_start` on activation
- Key events (file changes, handoffs, test results, user interactions)
- JSONL format appended to `.amazonq/workflow.log`

Log enables Retrospective profile to analyze:
- Workflow nesting depth
- Handoff frequency
- User clarification frequency
- System fix frequency
- Blocker patterns
- Decision quality

### Semantic Lineage and the Workflow Log

The workflow log records *events* (“what happened”). [Semantic Lineage](../glossary.md#semantic-lineage) is a
profile‑level reconstruction of *why* those events occurred. Lineage is not
stored directly; it is derived from the event log by profiles such as
Retrospective.

Profiles must record enough intent, decisions, and reasoning context in their
log events for lineage to be reconstructed. The log provides the mechanical
trace; lineage provides the semantic trace.


## Workflow Tracking

The system tracks workflow context at two levels:

**Feature-Level Tracking** — `.amazonq/work/FEATURE.md`
- Created by Planner for multi-story features
- Lists all stories in feature
- Tracks progress across story chain
- Updated by Documentor between stories
- Cleaned up by Retrospective when feature complete

**Context Preservation** — `.amazonq/suspended/`
- Saves workflow context for later resumption
- Enables pausing work to handle unrelated tasks
- Supports multi-phase stories and complex workflows
- Indexed in `.amazonq/suspended/INDEX.md`
- Resumed with `@resume [name]`

## Multi-Story Feature Support

The system supports features requiring multiple sequential stories:

**Feature Identification** — Architect analyzes features and identifies when multiple stories are needed

**Feature Planning** — Planner creates FEATURE.md with story list and writes first story

**Story Execution** — Each story follows TDD workflow (Planner → TestDesigner → PE → Builder → Enforcer → Documentor)

**Progress Tracking** — Documentor updates FEATURE.md between stories, marking completed and starting next

**Context Preservation** — FEATURE.md persists across stories, providing context for entire feature chain

**Completion** — Retrospective analyzes complete feature workflow and cleans up FEATURE.md

## Rules Location

`.workflow/rules/` contains:
* `_PROFILES.md` — Profile definitions and aliases
* `foundation/` — General code quality, minimal code principles
* `architecture/` — Domain structure, generated code
* `tech/` — formatting, and tech stack specifics
* `communication/` — Commit messages, code diffs, user stories
* `workflow/` — Testing, logging, confirmation, AWS commands, context gathering,
  rule change workflow, rules content guidelines, safe undo, escalation patterns
* `profiles/` — Profile-specific guidelines
* `commands/` — On-demand operational routines (auto-suspend, cleanup, rename)

---

## Saved Prompts

Saved prompts stored in `~/.aws/amazonq/prompts/` enable workflow coordination:

Saved Prompts can be roughly divided into categories:
  * Workflow Commands,
  * Quality of Life Enhancements

### Workflow Commands

The system exposes a set of saved prompts (“commands”) that activate profiles,  
transfer work, or manage workflow state. Below is the **minimal conceptual list**.  
For full syntax, arguments, and examples, see:  
[`docs/user/user-guide.md`](../user/user-guide.md#4-how-to-use-commands)
(Section 4: User Commands).

**Transfer Commands** — Hand off work between profiles.
* **`@handoff`** — create `HANDOFF.md` and prepare work for the next profile.
* **`@send`** — send a message or artifact to another profile via `MESSAGE.md`.

**Activation Commands** — Switch profiles or start workflows.
* **`@start`** — activate the profile named in `HANDOFF.md`.
* **`@receive`** — activate the profile named in `MESSAGE.md`.

**Suspend / Resume Commands** — Save and restore workflow state.
* **`@suspend`** — save the current context as a suspended workflow.
* **`@resume`** — restore a previously suspended workflow.
* **`@list`** — show all suspended workflows.

**Stateless Commands** — Operate across the entire workflow, regardless of state.
* **`@note`** — append a log entry to `workflow.log`.
* **`@inquiry`** — enter question‑only mode (no state changes allowed).

**Convenience Commands**  — UX shortcuts that wrap common patterns.
* **`@dr`** — start Doctor and troubleshoot a test result.
* **`@epr`** — activate Enforcer to review a pasted prompt/response pair
  for rule compliance.
* **`@send-epr`** — send a side trip message to Enforcer requesting rule
  compliance review of current work.

**Diagnostic Commands** — Inspect context, rules, and profile loading.
* **`@debugCurrent`** — generate a debug report of the current context window
  (no file loading, analyzes only what is already present).
* **`@debugFull`** — load all rule files and generate a full system debug report.
* **`@debugProfile [Profile]`** — load a specific profile's rules and generate
  a profile‑scoped debug report.

## Handoff vs Send/Receive

**Handoff** — Sequential workflow in same chat tab
* Used when: advancing the main thread work forward
* Profile completes work, writes handoff, waits for user
* User runs `@start` to continue workflow (optionally in a new tab for fresh context)
* Cleans up work directory between steps
* Used for: Builder → Enforcer → Documentor chains

**Send/Receive** — Parallel work in separate chat tabs
* Used when: running a [side trip](../glossary.md#side-trip) to gather context, or fix an issue
  **without advancing the main thread.**
* Profile writes message, stays active in current tab
* User opens new tab, runs `@receive` for isolated work
* Original tab remains unchanged
* Used for: Retrospective creating improvement artifacts

---

## Getting Started

Activate a profile using `@as` with a goal:
```text
@as [Profile], [goal description]
```

Switch profiles explicitly:
```text
@as [Profile]
```

`@start` and `@receive` also activate profiles,
but only as continuations from changeover files.

Use context commands:
* `@workspace` — Analyze project structure
* `@folder` — Scope to specific folder
* `@file` — Scope to specific file

Use saved prompts:
* `@handoff {{next}}` — Handoff to next profile
* `@start` — Read handoff and activate
* `@send {{to}} {{purpose}}` — Send message to profile
* `@receive` — Read message and activate
* `@suspend [name]` — Save workflow context
* `@resume [name]` — Load workflow context
* `@list` — Show suspended contexts
* `@note [observation]` — Log user observation
* `@epr` — Validate prompt and response pairs
* `@send-epr` — Request rule compliance review

Trigger retrospective analysis:
```text
@as Retrospective, analyze recent workflows
```

## Example workflow Loop

This example shows how a single change moves through the system using
the Straight-Forward Build Workflow,
without assuming any specific language, framework, or domain.

**User**  
Requests a change: “Add a small enhancement to the system.”

**Planner**  
Analyzes the request and Builds a User Story.  
In a Straight-Forward Build, would decide to Skip TDD.
**Writes a handoff file for PromptEngineer.**

**PromptEngineer**  
Reads the Planners story and constructs a Builder prompt that:
* scopes the work
* enforces minimal‑change principles
* includes confirmation requirements
* aligns with project rules  
* **Writes a handoff file for Builder.**

**Builder**  
Implements the change according to the prompt.  
This typically includes:
* updating logic or behavior
* modifying or adding configuration or data structures
* writing or updating tests to cover the change
* Builder shows diffs and requests confirmation.  
* **Writes a handoff file for Enforcer.**

**Enforcer**  
Validates the work:
* runs tests (or validates expected behavior)
* checks formatting and structure
* ensures alignment with architecture and rules  
  If issues are found, Enforcer **writes a handoff back to Builder** with required fixes.  
  If clean, **writes a handoff to Documentor.**

**Documentor**  
Generates a commit message or summary of the change following the project’s communication standards.  
**Writes a handoff to Retrospective.**

**Retrospective**  
Analyzes the workflow log entries for this story:
* handoff count
* clarifications
* corrections
* blockers
* deviations from expected flow  
  Outputs Keep/Stop/Start recommendations and optional improvements to rules or prompts.
* cleans up workflow files

## Evaluation Lens

These criteria describe the qualities the AI Workflow System was intentionally designed to express.  
They are not requirements or a checklist.  
They provide a recommended lens for comparing this system to other AI‑workflow approaches,
helping reviewers focus on architectural qualities rather than surface‑level behaviors.

### 1. Architectural Clarity

Is the structure understandable and intention‑revealing?

### 2. Predictability

Does the system behave consistently and avoid drift?

### 3. Separation of Concerns

Are responsibilities cleanly divided across profiles, with minimal overlap?

### 4. Reviewability

Are decisions, diffs, and workflow steps easy to inspect, understand, and audit?

### 5. Self‑Improvement

Does the system generate insights that can meaningfully improve future workflows?

### 6. Isolation and Parallelism

Can profiles operate independently without interference or context leakage?

