# Workflow Contract (Domain Definition & Invariants)

This document defines the **workflow domain**, **artifact shapes**,
and **invariants** that all profiles, mechanics, and commands must obey.  
It is the semantic substrate beneath:
* [`workflow-mechanics.md`][mechanics]
* [`user-commands.md`][commands]
* all profile rules
* all workflow artifacts

Mechanics define *how* workflows operate.  
The Contract defines *what must always be true*.

Reference:
* [`workflow/workflow-mechanics.md`][mechanics]
* [`workflow/user-commands.md`][commands]

---

## 1. Purpose

The Contract establishes:
* the **canonical workflow artifacts**
* the **required shapes** of those artifacts
* the **invariants** that govern workflow correctness
* the **rules for cross‑profile continuity**
* the **defined workflow actions** (user commands)

This file defines the domain.  
Mechanics and profiles must conform to it.

---

## 2. Canonical Workflow Artifacts

The workflow engine operates on four artifact types.  
Their shapes and semantics are defined in [`workflow-mechanics.md`][mechanics]

### 2.1 Handoff (`HANDOFF.md`)

A structured, reviewable transfer of responsibility between profiles.

Created **only** when the user triggers `@handoff`.

**Contains:**  
* From
* Task
* Summary of Work
* Requested Next Action
* Context Capsule
* Artifacts
* Expected Outcome

**Invariants:**
* must include all fields listed under **Contains**
* must be complete and reviewable
* must not be auto‑created
* must require explicit user approval

Location:
`.amazonq/work/current/HANDOFF.md`

### 2.2 Side Trip Message (`MESSAGE.md`)

A structured request for parallel work by another profile.

Created **only** when the user triggers `@send [Profile]`.

**Contains:**  
* From
* Task
* Summary of Work
* Requested Action
* Context Capsule
* Artifact
* Expected Outcome

**Invariants:**
* must include all fields listed under **Contains**
* must be isolated from main workflow
* must require explicit user approval
* must return control to original profile

Location:
`.amazonq/work/current/MESSAGE.md`

### 2.3 Suspended Context (`.amazonq/suspended/*.md`)

A serialized snapshot of workflow state.

Created **only** via `@suspend`.

**Contains:**
* Full Workflow State (Context Capsule)
* Active Profile
* Goal / Requested Action
* Key Decisions
* Resume Instructions
* Metadata
* Execution History

**Invariants:**
* must include all fields listed under **Contains**
* must be sufficient to resume work without loss of meaning
* must follow naming rules in [`user-commands.md`][commands]
* must not be modified by profiles
* must be resumable via `@resume`

Location:
`.amazonq/suspended/[name].md`

#### 2.3.1 Auto‑Suspend (Background Continuity Mechanism)

Auto‑suspend files are lightweight, automatically maintained recovery checkpoints.
They are not canonical workflow artifacts, but they share the same directory and
resume semantics as manual suspended contexts.

**Properties:**
* created automatically on workflow start
* updated on stable workflow events (e.g., `handoff_sent`)
* overwritten atomically to prevent corruption
* contain recent events and key context
* used for recovery from accidental tab closure
* resumable via `@resume` using their filename
* cleaned up automatically on workflow completion or manual suspend

See [`auto-suspend.md`][auto-suspend] for full rules.

#### 2.3.2 Suspended Index (`INDEX.md`)

Tracks all suspended workflow contexts in a human‑readable list.

**Purpose:**
Provide a single, scannable index of suspended contexts so users can see
what’s parked and choose what to resume or clean up.

**Contains:**
* **Active Contexts** section
* **Completed Contexts** section (optional, when present)
* One entry per context in the form:
  * `[name] - [description] - [date]`

**Invariants:**
* must list every file in `.amazonq/suspended/` that represents a suspended context
* must format each entry as: `[name] - [description] - [date]`
* must be updated whenever a context is suspended or resumed
* must remain human‑readable and safe to inspect in an editor
* must not contain implementation details beyond what `@list` displays

Location:
`.amazonq/suspended/INDEX.md`

---

## 2.4 Workflow Log (`workflow.log`, JSONL)

Append‑only event log.

**Invariants:**
* must follow JSONL event schema defined in [`workflow/logging.md`][logging]
* must record workflow events, suspends, resumes, notes
* must never be rewritten or truncated
* must be appended only with workflow events (profiles) and user notes (`@note`)

---

## 3. Domain Invariants

These invariants must hold across all workflows, profiles, and mechanics.

### 3.1 Structural Invariants

* Handoff and Message files must follow their canonical shapes
* Suspended contexts must follow their canonical shape
* Workflow log entries must follow JSONL schema
* All workflow artifacts must be stored in their correct directories
* Profiles must not create workflow artifacts without user commands

### 3.2 Semantic Invariants

* Handoffs must be complete, reviewable, and meaning‑preserving
* Side trips must be isolated and return control to original profile
* Suspended contexts must be sufficient to resume work
* Workflow logs must accurately reflect events
* Profiles must follow confirmation rules defined in mechanics
* No profile may skip required user approvals

### 3.3 Cross‑Profile Invariants

* Profiles must accept and produce valid workflow artifacts
* Profiles must not modify artifacts outside their responsibility
* Handoffs must preserve context across profiles
* Side trips must not mutate main workflow state
* All profiles must follow the same handoff and confirmation patterns

### 3.4 Nullability Rules

* Required fields in HANDOFF.md and MESSAGE.md must not be omitted
* Suspended context fields must follow nullability rules in [`user-commands.md`][commands]
* Workflow log fields must follow event schema nullability rules

---

## 4. User Command Contract

User commands are the **only defined workflow actions** in the engine.  
Some commands **create or modify workflow artifacts** (state transitions),
while others **only reveal information** or **enter conversational mode**.

### User Commands that *change workflow state*
(these create or modify workflow artifacts or workflow position)
* `@handoff` — creates HANDOFF.md
* `@send` — creates MESSAGE.md
* `@start` — activates profile from HANDOFF.md
* `@receive` — activates profile from MESSAGE.md
* `@suspend` — creates suspended context
* `@resume` — loads suspended context
* `@note` — appends to workflow.log

### User Commands that *do not* change workflow state
* `@list` — displays suspended contexts
* `@inquiry` — enters question‑only mode, and prevents state transitions

**Invariants:**
* Profiles must not simulate or bypass commands
* Commands must follow semantics defined in [`workflow-mechanics.md`][mechanics]
* Inquiry mode must never trigger workflow actions
* Only user commands may create or modify workflow artifacts

Reference: [`workflow/user-commands.md`][commands].

---

## 5. Profile Contract

All profiles must:
* follow workflow mechanics
* follow confirmation rules
* follow handoff and side‑trip patterns
* produce valid workflow artifacts
* wait for explicit user approval where required
* never auto‑progress workflow state

Profiles implement behavior.  
Mechanics define operations.  
The Contract defines invariants.

---

## 6. Relationship to Mechanics

Mechanics define:
* how handoffs work
* how side trips work
* how confirmation works
* how profiles activate
* how workflow logs are written
* how suspended contexts behave

The Contract defines:
* what artifacts exist
* what shapes they must follow
* what invariants must hold
* what commands are legal

Mechanics implement the Contract.  
Profiles obey both.

---

## 7. Scope

This file defines:
* workflow domain
* artifact shapes
* invariants
* command semantics
* cross‑profile rules

This file does **not** define:
* persona behavior
* workflow sequences
* implementation details
* project‑specific conventions

[mechanics]: ../../.amazonq/rules/workflow/workflow-mechanics.md
[commands]: ../../.amazonq/rules/workflow/user-commands.md
[logging]: ../../.amazonq/rules/workflow/logging.md
[auto-suspend]: ../../.amazonq/rules/workflow/auto-suspend.md
