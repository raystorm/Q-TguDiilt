# AI Workflow System — Overview

The AI Workflow System is a **rule‑driven, profile‑based workflow engine**
modeled after a high‑performance Agile software team.  
It ensures predictable, reviewable, drift‑resistant execution
by running work through a deterministic loop:

**Design → Prompt → Build → Verify → Document → Improve**

Profiles operate in isolation, communicate through explicit file‑based handoffs,
and follow governed rule files that define their responsibilities and boundaries.

This overview introduces the system at a high level and links to the deeper documentation set.

---

## What This System Provides

- **Stable, predictable AI behavior** through governed profiles
- **Deterministic workflows** that mirror real engineering processes
- **Explicit handoffs and state transitions**
- **Rule‑encoded responsibilities** instead of improvisation
- **Retrospective‑driven self‑improvement**
- **Parallelism without context leakage**

For a deeper architectural explanation, see the **1‑page deep dive**.

---

## Documentation Structure

The documentation is organized into clear sections that mirror the architecture of the system.

### 1. Deep Dive
A single‑page architectural explanation of how the system works.  
[ai-workflow-system.md](./dev/ai-workflow-system.md)

### 2. Contract
The domain definition and invariants the system operates on.  
[contract.md](./dev/contract.md)

### 3. Profiles
Responsibilities, boundaries, and behaviors of each profile.  
[profiles.md](./profiles.md)

### 4. Workflow Patterns
The execution shapes: Normal Build, TDD, Multi‑Story, Retrospective.  
[workflow-patterns.md](./dev/workflow-patterns.md)

### 5. User Commands
The runtime primitives that move work between profiles:  
`@handoff`, `@start`, `@send`, `@receive`, `@suspend`, `@resume`, etc.  
[user-commands.md](user-commands.md)

### 6. Rules & Governance
Universal rules, project‑level overrides, and the `Override:` mechanism.  
[governance.md](./dev/governance.md)

### 7. Drift
The central failure mode of AI systems. 
Defines the canonical drift types, how drift manifests,
and how the workflow engine prevents and corrects it.  
[drift.md](./drift.md)

### 8. Extending the System
How to safely add profiles, rules, workflows, or capabilities.  
[extending.md](./extending.md)

### 9. Mindset
How to think about the system, its philosophy, and its evaluation lens.  
[mindset.md](./mindset.md)

---

## Supporting Docs
- [Glossary](./glossary.md)
- [FAQ](FAQ.md)
- [Origin Story](./origin.md)

---

## Next Steps

If you’re new to the system, start with:

1. **Deep Dive**
2. **Profiles**
3. **Workflow Patterns**

Then explore Workflow Commands and Rules as needed.

---