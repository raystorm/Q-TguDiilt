# Contributing

Thank you for your interest in contributing.  
This project uses a governed cognitive workflow architecture built on clarity,
predictability, and drift‑resistance.  
Contributions should follow the system’s mindset: reduce noise, amplify signal,
and keep the structure coherent as it evolves.

This document explains how to contribute safely and consistently.

---

## Core Expectations

Contributions should reflect the system’s principles:

- **Clarity** — Changes must be understandable and intention‑revealing.
- **Predictability** — Behavior, structure, and naming should remain stable.
- **Minimalism** — Keep only what is necessary for clarity.
- **Continuity** — Preserve context, lineage, and meaning across updates.
- **Drift Resistance** — Do not introduce ambiguity or structural collapse.

Working code is valued, but clarity and structure are non‑negotiable.  
The workflow exists to *make the right thing easy and the wrong thing hard.*

---

## Before You Start

Review the core documents that define how the system works:

- [**Workflow System one pager - deep dive**](ai-workflow-system.md)
- [**Architecture**](architecture.md)
- [**Commit Style Guide**](commit-style-guide.md)
- [**Mindset**](mindset.md)
- [**Glossary**](glossary.md)

These documents provide the grounding needed to make safe, coherent changes.

---

## Making Changes

When contributing:

- Keep changes **small and focused**.
- Maintain **predictable sequencing** — one conceptual change per commit.
- Use **clear naming** that matches the glossary.
- Ensure **handoffs** and **capsules** remain explicit and intention‑revealing.
- Avoid introducing new patterns without justification.
- Prefer refinement over reinvention.

If you are unsure whether a change fits the architecture, open a discussion first.

---

## Commit Expectations

Commits follow the project’s structured style:

- Imperative header
- Semantic bullets
- Clear grouping
- Domain vocabulary
- Explicit invariants when relevant

Commits should explain *why* a change exists, not just *what* changed.

See the full guide → [`commit-style-guide.md`](commit-style-guide.md)

---

## Pull Requests

A good PR:

- Is focused and minimal
- Explains the intent behind the change
- Has an understandable commit history
- Avoids mixing unrelated changes
- Updates documentation if needed
- Preserves system stability and drift‑resistance

PRs are reviewed for clarity, structure, and alignment with the governed workflow.

---

## Adding or Updating System Components

When adding new profiles, capsules, workflows, or architectural elements:

- Follow existing patterns unless there is a clear reason not to
- Ensure boundaries and responsibilities are explicit
- Update documentation if needed (Glossary, Architecture, or other relevant files)
- Maintain predictable handoffs and context flow

New components must integrate cleanly into the existing structure.

---

## Thank You

Every contribution strengthens the system’s clarity, stability, and lineage.  
Your work helps maintain a governed, intention‑revealing architecture that improves over time.
