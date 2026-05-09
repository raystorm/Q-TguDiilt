# Workflow Loops

## Purpose

Define the **three governing loops** that compose every workflow in the AI Workflow System:

1. **Plan Loop**
2. **Implement Loop** (with variants)
3. **Improve Loop (Optional)**

These loops map directly to the system’s meta‑loop invariant:

**Plan → Implement → Improve**

A *workflow* is a composition of these loops.  
A *flow* is a concrete example of a workflow (see `ai-workflow-system.md` and `workflow-examples.md`).  
This file defines the loops themselves.

---

# 1. Plan Loop

## Purpose
Transform a user request or feature into a clear, testable, actionable story.

## Sequence
```
Planner → TestDesigner
```

## Responsibilities

### Planner
- Writes the story or backlog item.
- Defines acceptance criteria.
- Ensures scope completeness.
- Proposes the Implement Loop variant (Straight‑Forward or TDD).

### TestDesigner
- Analyzes the story for behavioral impact.
- Designs test scenarios (light for Straight‑Forward, full for TDD).
- Has veto power: may upgrade Straight‑Forward → TDD.
- Finalizes the Implement Loop variant.

## Invariants
- Plan Loop must complete before any implementation begins.
- If TestDesigner identifies new behavior, TDD becomes mandatory.
- Planner and TestDesigner must agree on the Implement Loop variant.

---

# 2. Implement Loop

The Implement Loop is where the actual building happens.  
It has **three variants**:

1. **Straight‑Forward Build (SF) — Optional**
2. **Test‑Driven Development (TDD) — Default**
3. **Hybrid — Decision Policy**

Each variant is a **full workflow**, composed of:

1. **Plan Loop**
2. **Implement Loop (Variant)**
3. **Improve Loop (Optional)**

---

# 2.1 Implement Loop (Straight‑Forward Build Variant — SF)

## Purpose
A minimal, implementation‑first loop for:
- trivial changes
- mechanical refactors
- non‑behavioral updates
- low‑risk work

## This is a full workflow, composed of:
1. **Plan Loop:**  
   Planner → TestDesigner (light/optional)
2. **Implement Loop (Straight‑Forward Build):**  
   PromptEngineer → Builder → Enforcer → Documentor
3. **Improve Loop (Optional):**  
   Retrospective

## Sequence
```
PromptEngineer → Builder → Enforcer → Documentor
```

## Invariants
- Implementation‑first is allowed.
- Tests are optional when no new behavior is introduced.
- If new behavior appears, Builder must escalate to TDD.
- TestDesigner may upgrade SF → TDD at any time.
- Enforcer validates that SF was appropriate for the story.

## When to Use
- Pure refactors
- Renames
- UI copy changes
- Small, isolated code adjustments
- No new behavior or guards

---

# 2.2 Implement Loop (Test‑Driven Development Variant — TDD)

## Purpose
A tests‑first loop for:
- new behavior
- new guards or validation logic
- cross‑profile interactions
- any change with non‑trivial acceptance criteria

**TDD is the default Implement Loop.**

## This is a full workflow, composed of:
1. **Plan Loop:**  
   Planner → TestDesigner
2. **Implement Loop (TDD):**  
   PromptEngineer → Builder (tests) → Builder (implementation) → Enforcer → Documentor
3. **Improve Loop (Optional):**  
   Retrospective

## Sequence
```
PromptEngineer
→ Builder (Phase 1: tests)
→ Builder (Phase 2: implementation)
→ Enforcer
→ Documentor
```

## Invariants
- Tests‑first is mandatory.
- Builder must show test diffs before implementation.
- Builder must show implementation diffs after tests.
- Enforcer validates test–implementation alignment.
- TDD is required unless the story is trivial and non‑behavioral.
- If Builder discovers hidden behavior, Builder must escalate to TDD.

## When to Use
- New behavior
- New guards
- Cross‑domain or cross‑profile changes
- Retro has flagged this area as fragile
- Any non‑trivial acceptance criteria

---

# 2.3 Implement Loop (Hybrid Variant)

## Purpose
A decision policy that defaults to TDD while allowing Straight‑Forward Build for trivial work.

Hybrid is **not** a separate sequence — it is a **selection rule**.

## Decision Rules

### Default
Use **TDD**.

### Allow Straight‑Forward Build only when ALL are true:
- No new behavior
- No new guards
- No cross‑profile changes
- No Retro flags
- Planner and TestDesigner agree SF is safe

### Require TDD when ANY are true:
- New behavior
- New guards
- Cross‑profile interactions
- Retro flags
- User explicitly requests TDD

## Role Responsibilities

### Planner
- Proposes SF or TDD based on story type.
- Documents the proposed loop.

### TestDesigner
- Has veto power.
- May upgrade SF → TDD.

### PromptEngineer
- Encodes the chosen loop into the Builder prompt.

### Builder
- Enforces loop invariants.
- Escalates if reality diverges from declared loop.

### Enforcer
- Validates that execution matched the declared loop.

### Retrospective
- Evaluates loop correctness.
- Flags incorrect loop selection.

---

# 2.4 Implement Loop (BDD Variant)

## Purpose
A behavior-driven loop for:
- Stories requiring stakeholder collaboration
- Living documentation needs
- Executable specifications
- User-requested BDD approach

**BDD is optional.** Planner decides when BDD is appropriate.

## This is a full workflow, composed of:
1. **Plan Loop:**  
   Planner (decides BDD) → TestDesigner
2. **Implement Loop (BDD):**  
   PromptEngineer → Builder (BDD scenarios + implementation) → Enforcer → Documentor
3. **Improve Loop (Optional):**  
   Retrospective

## Sequence
```
PromptEngineer
→ Builder (BDD scenarios + implementation)
→ Enforcer
→ Documentor
```

## Invariants
- Planner must explicitly choose BDD approach in story
- TestDesigner creates scenarios with stakeholder collaboration in mind
- Builder implements BDD scenarios as executable specifications
- Enforcer validates BDD scenario coverage
- Living documentation is maintained

## When to Use
- User explicitly requests BDD
- Story focuses on user behavior and acceptance criteria
- Stakeholder collaboration on acceptance criteria is valuable
- Living documentation would benefit the team
- Executable specifications are needed

## Role Responsibilities

### Planner
- Decides when BDD is appropriate
- Notes "BDD approach" in story
- Ensures acceptance criteria are behavior-focused

### TestDesigner
- Creates BDD scenarios with stakeholder collaboration in mind
- Focuses on behavior and outcomes
- Uses Gherkin format (standard for all scenarios)

### PromptEngineer
- Encodes BDD approach into Builder prompt
- Emphasizes living documentation

### Builder
- Implements BDD scenarios as executable specifications
- Maintains living documentation

### Enforcer
- Validates BDD scenario coverage
- Ensures living documentation is maintained

### Retrospective
- Evaluates BDD effectiveness
- Flags when BDD was unnecessary overhead

---

# 3. Improve Loop (Optional)

## Purpose
Analyze the workflow, identify improvements, and evolve the system.

## Sequence
```
Retrospective
```

## Responsibilities
- Parse `.amazonq/workflow.log`
- Identify patterns:
  - blockers
  - clarifications
  - corrections
  - drift
  - handoff frequency
- Output Keep/Stop/Start recommendations
- Suggest rule or prompt improvements
- Use `@send` for cross‑tab improvement work
- Clean up workflow files

## Invariants
- Improve Loop is optional.
- Improve Loop must not modify rules without user approval.
- Improve Loop must not alter workflow state.

---

# Loop–Flow Relationship

- **Loops** define the structure of a workflow.
- **Flows** are concrete examples of loops in action.
- See:
  - `ai-workflow-system.md` (deep dive)
  - `workflow-examples.md` (flows)

---

# Loop–Mechanics Relationship

Loops rely on mechanics defined in `workflow-mechanics.md`:

- Changeovers (handoff, send/receive)
- Confirmation
- Begin commands
- Suspend/Resume
- Logging
- Inquiry Mode

Mechanics define **how** loops run.  
Loops define **what structure** the workflow follows.

---