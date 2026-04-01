# Profiles

Profiles are the governed actors of the workflow engine.  
Each profile represents a **single responsibility**, a **bounded domain**,
and a **deterministic behavior** defined entirely by rule files.
Profiles do not improvise, store hidden state, or cross boundaries.
They execute work, hand off artifacts, and maintain continuity across multi‑step workflows.

Profiles sit between the **Contract** (what is true)
and the **Workflow Patterns** (how work flows).

- **Contract:** domain definition and invariants
- **Profiles:** who acts within those invariants
- **Workflow Patterns:** how those actors move work through the system

For the canonical list of profiles and their rule sources, see:  
[`_PROFILES.md`](../.amazonq/rules/_PROFILES.md)

---

## 1. Purpose of Profiles

Profiles exist to:

- enforce **separation of concerns**
- keep behavior **predictable and deterministic**
- maintain **auditability and lineage**
- prevent role drift and overloading
- enable **multi‑agent collaboration** without chaos
- make the system **teachable** and **governed**

> [!IMPORTANT]
> A profile is not a persona.  
> It is a **role with rules**, not a personality with preferences.

---

## 2. How Profiles Work

Every profile:

- Loads **universal rules** (foundation, workflow invariants)
- Loads **project rules** (architecture, tech stack, naming, domain)
- Loads **profile‑specific rules** (behavior, boundaries, escalation) (if specified)
- Executes tasks strictly within its domain
- Produces artifacts in the required format
- Hands off work to the next profile in the workflow

Profiles form a **governed assembly line**.  
Each actor performs one job, performs it well, and yields control.

---

## 3. Responsibilities and Boundaries

Below is a high‑level summary of each profile’s domain.  
For full behavioral rules, see:  
`../.amazonq/rules/profiles/<profileName>.md`

### Operator
Routes tasks to the correct profile. Does not perform work.  
→ [`operator.md`](../.amazonq/rules/profiles/operator.md)

### Builder
Implements features, writes code, follows formatting and architecture rules.  
→ [`builder.md`](../.amazonq/rules/profiles/builder.md)

### Enforcer
Validates code, formatting, tests, and architectural alignment.  
→ [`enforcer.md`](../.amazonq/rules/profiles/enforcer.md)

### TestDesigner
Identifies test scenarios, edge cases, and validation strategies.  
→ [`test-designer.md`](../.amazonq/rules/profiles/test-designer.md)

### Documentor
Writes documentation, commit messages, diffs, and story descriptions.  
→ [`documentor.md`](../.amazonq/rules/profiles/documentor.md)

### Planner
Creates user stories, backlog items, and manages macro‑level flow.  
→ [`planner.md`](../.amazonq/rules/profiles/planner.md)

### Tactician
Determines execution order, sequencing, and workflow strategy.  
→ [`tactician.md`](../.amazonq/rules/profiles/tactician.md)

### Architect
Defines system design, domain models, and long‑term structure.  
→ [`architect.md`](../.amazonq/rules/profiles/architect.md)

### Analyst
Reads code, explains behavior, traces logic, and diagnoses issues.  
<!-- No file today → [`analyst.md`](../.amazonq/rules/profiles/analyst.md) -->

### Communicator
Writes release notes, announcements, and public‑facing documentation.  
<!-- No file today → [`communicator.md`](../.amazonq/rules/profiles/communicator.md) -->

### PromptEngineer
Writes prompts and governs AI‑facing instructions.  
→ [`prompt-engineering.md`](../.amazonq/rules/profiles/prompt-engineering.md)

### Doctor
Diagnoses failures, applies minimal safe fixes, and escalates when needed.  
→ [`doctor.md`](../.amazonq/rules/profiles/doctor.md)

### Retrospective
Analyzes completed workflows, identifies improvements, and highlights successes.  
→ [`retrospective.md`](../.amazonq/rules/profiles/retrospective.md)

### UserExperience
Defines user flows, interaction patterns, and accessibility requirements.  
→ [`user-experience.md`](../.amazonq/rules/profiles/user-experience.md)

---

## 4. Boundaries

Each profile has an **area of responsibility** —
a worldview that defines what it cares about, what it notices, and what it considers important.
This worldview determines what the profile will act on and what it will ignore.

Some profiles also have **explicit boundaries**, **invariants**, or **escalation rules**,
but these only exist when the profile has a need for them,
and will be implemented in a rule file.

Profiles fall into two categories:

### 1. Conceptual Profiles
These define identity and responsibility but do not require strict governance.  
They may not have a rule file, and they simply ignore work outside their worldview.

### 2. Governed Profiles
These have rule files that define:
- domain of authority
- invariants
- boundaries
- escalation paths (if needed)
- required outputs (if needed)


This model keeps the system flexible, minimal, and drift‑resistant:  
profiles only gain governance when they need it.

---

## 5.Escalation

Not all profiles have defined escalation paths.  
Only governed profiles with rule files may support escalation.

If a profile that supports escalation encounters work outside its domain,  
it must:

1. Stop
2. Document the boundary
3. Escalate to the correct profile
4. Produce a minimal artifact if required

Other profiles simply do not perform work outside their domain or worldview.

---

## 6. Handoffs

Handoffs are explicit and file‑based.  
They preserve:

- context
- intent
- artifacts
- execution state
- audit trail

Workflow Patterns define the exact sequencing, but common flows include:

- PromptEngineer → Builder → Enforcer
- Enforcer → Documentor 
- Architect → PromptEngineer → Builder
- Planner → PromptEngineer
- Doctor → PromptEngineer or TestDesigner
- Retrospective → PromptEngineer

---

## 7. Rule Loading Model

Profiles do not inherently contain logic. A profile begins as a named identity with a
worldview and an area of responsibility. Explicit governance is added only when needed.

All profiles inherit the shared workflow substrate. This includes the mechanics
that make the system function as a whole: handoffs, side trips, logging,
suspend/resume, and other workflow rules. These shared behaviors come from the
universal rule files in `foundation/` and `workflow/`.

Not all profiles have profile‑specific rule files. Some remain conceptual and
operate only with the shared workflow rules. Others, such as Retrospective, have
rich profile‑specific rule files that define menus, flows, or specialized behaviors.

Each profile’s rule loading is defined in the profile index:
[`_PROFILES.md`](../.amazonq/rules/_PROFILES.md)

A governed profile might declare:

```text
**Uses:**
  foundation/*
  workflow/logging.md
  workflow/auto-suspend.md
  profiles/retrospective.md
```

A conceptual profile might declare only the shared layers,
with no profile‑specific rules at all.

The key idea is that **Uses** determines which rule files shape a profile’s
behavior. This keeps the system explicit, minimal, and drift‑resistant,
while allowing each profile to be as simple or as expressive as it needs to be.

---

## 8. Profile Philosophy

Profiles are identities. Each profile begins as a named perspective with a
worldview — a sense of what it cares about, what it notices, and what it
considers important. Governance is layered on top of that identity only when
explicit rules are needed.

Profiles also reflect the principles that make the workflow engine stable and
teachable:

- simplicity over embellishment
- clarity over cleverness
- boundaries over flexibility
- determinism over intuition
- teachability over magic

A profile’s identity defines its worldview.  
Its worldview defines its responsibilities.  
Its responsibilities define whether it needs governance.

Profiles are the structural backbone that makes the workflow engine governed,
auditable, and scalable — not because they are rigid, but because each one knows
who it is and what it cares about.
