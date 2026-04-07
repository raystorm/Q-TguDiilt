# Rules & Governance

*Universal Rules, Precedence, Overrides, and Governance Lineage*

This document defines the **governance model** of the AI Workflow System.  
It establishes:
* the **universal rules** that apply to all projects
* the **override mechanism**
* the **precedence model**
* the **governance invariants**
* the **structure of rule files**
* the **boundaries of what may and may not be overridden**

The [**Contract**](contract.md) defines the *domain*.  
**Rules & Governance** defines the *laws* that govern behavior inside that domain.

---

## 1. Purpose

Rules & Governance ensures:
* consistent baseline behavior across all projects
* intentional, explicit deviations
* clear rule lineage
* predictable interpretation by all profiles
* [drift‑resistant](../glossary.md#driftresistant-reasoning) rule evolution

This file defines **how rules behave**, *not* how workflow artifacts behave.  
Artifact shapes and invariants are defined in the Contract.

---

## 2. Rule Structure

Rules exist at two levels:

1. **Universal Rules**
    * Apply to all projects
    * Stored in `.amazonq/rules/**`
    * Define baseline behavior for profiles, workflow mechanics, communication,
      and architecture

2. **Project‑Level Rules**
    * Stored in `.amazonq/rules/**-project.md`
    * May override or refine universal rules
    * Must use explicit override markers
    * Apply only to the current project
    * Any tech-stack specific rules needed for the project

Universal rules define the default behavior.  
Project rules define intentional deviations, or things not already covered.

---

## 3. Rule Precedence Model

Rules follow a strict, deterministic precedence order:

1. **Contract (highest authority)**
    * Domain invariants
    * Artifact shapes
    * Command semantics
    * Cross‑profile invariants
    * Cannot be overridden

2. **Universal Rules**
    * Baseline behavior
    * May be overridden only with explicit markers

3. **Project‑Level Overrides**
    * Apply only when explicitly declared
    * Must use `Override:`
    * Must appear in the corresponding `*-project.md` file
    * Override only the rules they explicitly reference

4. **Profile Interpretation**
    * Profiles may have their own rules files
    * Profiles are the actors in the system and process the rules as already defined
    * Profiles do not dynamically create or modify rules at runtime
    * Profiles must obey precedence and override semantics
    * Profiles can propose rule changes 
    * Profiles may update rule files **only when explicitly directed by the user**
      (including user‑approved changes originating from Retrospective recommendations)

Profiles **implement** rules.
Profiles **do not** autonomously create, mutate, or override them.

No implicit overrides.  
No inferred behavior.  
No hidden rule changes.

---

## 4. Override Mechanism

Overrides must be:
* **explicit**
* **local**
* **documented**
* **intention‑revealing**

### 4.1 Override Marker

Overrides MUST use one of the following: `Override:` *or* `**Override:**`

```markdown
Universal Rule: "Profile switches require explicit commands:"

Project Override (in general-project.md):
**Override:**
Profiles may also be switched with:
  - "Become {Profile}"
  - "Identify as {Profile}"
```

No other phrasing is valid.

### 4.2 Override Scope

An override applies only to:
* the rule it explicitly references
* the project in which it appears
* the file in which it is declared

Overrides are **file‑scoped**, not category‑scoped.  
A project file may override any universal rule, regardless of category,
as long as the override is explicit and intention‑revealing.

Overrides **do not** cascade automatically into other rule files.
Each override must be declared explicitly wherever it is needed.

> [!WARNING]
> Overrides can be placed into any `*-project.md` file.
> It is **strongly recommended** that all overrides are placed
> in the `*-project.md` file that matches the rule they override.
> 
> Placing rule overrides in *unrelated* `*-project.md` files can lead to
> **inconsistent behavior**, because profiles only load the files that they need,
> and may not load overrides located in an unrelated `*-project.md` file.

### 4.3 Override Location

Project‑level overrides must appear in:

```text
.amazonq/rules/foundation/general-project.md
.amazonq/rules/architecture/*-project.md
.amazonq/rules/communication/*-project.md
.amazonq/rules/tech/*.md (except for formatting.md and README.md)
.amazonq/rules/tech/formatting-project.md
```

Universal rules remain in their non‑project files.

---

## 5. Governance Invariants

These invariants define the behavior of the rule system itself.

### 5.1 Explicitness

* All overrides must be explicit
* All rule changes must be explicit
* All deviations must be explicit

No implicit behavior changes.

### 5.2 [Lineage](../glossary.md#semantic-lineage) Preservation

Every rule must have a clear lineage:
* Universal rule → Project override (optional)
* No hidden mutations
* No silent reinterpretation

Profiles must be able to trace rule origin.

### 5.3 Determinism

Rule interpretation must be deterministic:
* Same rules → same behavior
* Same overrides → same behavior
* No profile may improvise rule interpretation

### 5.4 Non‑Interference

Project overrides **must not**:
* contradict the Contract
* violate domain invariants
* redefine artifact shapes
* redefine command semantics
* alter workflow mechanics

These belong to the Contract and **must not** be overridden.

### 5.5 Minimality

Overrides must be minimal:
* Override only what is necessary
* Do not restate universal rules
* Do not duplicate rule blocks
* Do not create shadow taxonomies

---

## 6. What May Be Overridden

The following categories may be overridden at the project level:

### 6.1 Profile Behavior

* Output formatting
* Communication style
* Confirmation requirements (tightening allowed, loosening discouraged)
* Domain‑specific behavior
* Project‑specific constraints

### 6.2 Architecture Rules

* Naming conventions
* Directory structure (within reason)
* Pattern application rules
* Domain‑specific architectural constraints

### 6.3 Tech Stack Rules

* Framework conventions
* Code style (within minimal‑change boundaries)
* Testing patterns
* Linting preferences

### 6.4 Communication Rules

* Commit message style (within commit style guide boundaries)
* Documentation conventions
* Story formats

### 6.5 Workflow Rules

* Pattern selection (e.g., defaulting to Straight‑Forward Build)
* Additional validation steps
* Additional confirmation requirements

---

## 7. What May NOT Be Overridden

The following are **non‑overridable**:

### 7.1 Contract Invariants

* Artifact shapes
* Required fields
* Nullability rules
* Command semantics
* Cross‑profile invariants

### 7.2 Workflow Mechanics

* Handoff creation rules
* Side‑trip semantics
* Confirmation requirements for file changes
* Logging requirements
* Suspend/resume semantics
* Auto‑suspend behavior

### 7.3 Profile Stability

* Profiles never auto‑switch
* Profiles never perform each other’s jobs
* Builder routing through PromptEngineer
* No profile may bypass user confirmation

### 7.4 Governance Model

* Override marker
* Precedence order
* Explicitness requirement
* Lineage preservation

These define the system itself and **MUST NOT** be changed.

---

## 8. Rule File Organization

Rules are organized by category:

```text
.amazonq/rules/
  foundation/
  architecture/
  tech/
  communication/
  workflow/
  profiles/
```

Each category may have:
* a universal rule file
* a project‑level override file (`*-project.md`)

Rules must not be duplicated across categories.

---

## 9. Governance Lineage

Every rule has a lineage chain:

```text
Contract → Universal Rule → Project Override
```

Profiles must:
* read universal rules
* apply project overrides
* obey Contract invariants
* follow precedence deterministically

Lineage must always be clear and traceable.

---

## 10. Profile Responsibilities in Governance

Profiles must:
* interpret rules deterministically
* apply overrides only when explicitly declared
* never infer overrides
* never modify rules
* never create new rules
* never bypass governance boundaries

Profiles enforce rules; they do not define them.

---

## 11. Evolution of Rules

Rules may evolve through:
* Retrospective recommendations
* User‑approved changes
* Explicit updates to rule files

Rules may **not** evolve through:
* profile improvisation
* implicit behavior changes
* undocumented modifications

All rule changes must be:
* explicit
* reviewed
* confirmed
* version‑controlled

---

## 12. Summary

Rules & Governance defines:
* how rules behave
* how overrides work
* what can be changed
* what cannot be changed
* how rule lineage is preserved
* how profiles interpret rules

The Contract defines the domain.  
Mechanics define operations.  
Profiles implement behavior.  
Rules & Governance defines the laws that govern all three.
