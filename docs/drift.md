# Drift — A Complete Guide

*A reference document defining drift, its canonical types, how it manifests,  
and how the workflow engine prevents, detects, and corrects it.*

---

## Overview

Drift is the central failure mode of all AI systems.

It is the gradual deviation from expected:
* patterns
* rules
* responsibilities
* communication standards
* identity
* reasoning
* boundaries

Drift is not a single phenomenon.  
It is a **family of failure modes** that degrade cognition, collapse roles,
and destabilize workflows.

This document defines the canonical drift types, how they relate,
and how the workflow engine prevents and corrects them.

### What About Hallucinations?

**Hallucination** is not a separate failure mode.  
It is the visible symptom of underlying drift.

When an AI “hallucinates,” it is usually because one or more drift types have already occurred:
* semantic drift
* continuity drift
* boundary drift
* identity drift
* pattern drift
* lineage drift

Hallucination is the *result*, not the cause.
Drift is the *process* that makes hallucinations possible.

This architecture focuses on preventing drift so hallucinations never occur in the first place.

---

## What Is Drift?

**Drift** is any deviation from the system’s expected behavior, patterns, or rules.  
It can occur:
* within a Cycle (local drift)
* across Cycles (systemic drift)
* within a profile (identity drift)
* across profiles (boundary drift)
* within documentation (lineage drift)
* within rules (governance drift)

Drift is the opposite of governed cognition.

---

## The Two Primary Drift Categories

All drift ultimately collapses into two root causes:

### Semantic Drift

Degradation of meaning, intent, or interpretation.  
Examples:
* misreading a requirement
* forgetting a boundary
* misinterpreting a rule
* forgetting a rule
* hallucinating structure
* hallucinating context
* losing context

### Persona / Role Drift

Deviation from a profile’s identity, responsibilities, or boundaries.  
Examples:
* Planner writing code
* Architect generating tests
* Enforcer rewriting stories
* Documentor making architectural decisions

These two categories are the **root**.  
Everything else is a manifestation.

---

## Canonical Drift Types

These are the full, explicit drift types observed across real multi‑agent workflows.  
They all reduce to the two primaries above.

| Drift Type              | Description                                        | Root Cause   |
|-------------------------|----------------------------------------------------|--------------|
| **Continuity Drift**    | Loss of context or reasoning continuity            | Semantic     |
| **Structural Drift**    | Deviating from workflow structure                  | Semantic     |
| **Pattern Drift**       | Breaking formats or conventions                    | Semantic     |
| **Communication Drift** | Wrong format, verbosity, or structure              | Semantic     |
| **Governance Drift**    | Ignoring rules or override mechanics               | Semantic     |
| **Lineage Drift**       | Docs/rules out of sync with behavior               | Semantic     |
| **Objective Drift**     | Losing the user’s goal                             | Semantic     |
| **Context Collapse**    | Mixing unrelated threads                           | Semantic     |
| **Thread Drift**        | Side trips leaking into main thread                | Semantic     |
| **Boundary Drift**      | Crossing profile responsibilities                  | Persona/Role |
| **Identity Drift**      | Mutating tone, purpose, or worldview               | Persona/Role |
| **Multi‑Agent Drift**   | Profiles blending into each other                  | Persona/Role |
| **Workflow Drift**      | Deviation from governed sequence (Analyze → Retro) | Hybrid ✶     |

**Workflow Drift** is a hybrid drift type that occurs when any other drift type or
combination of drift types disrupts the governed sequence of a Cycle.

## How Drift Manifests

Drift rarely appears as a catastrophic failure.  
It usually shows up as:
* small inconsistencies
* subtle tone changes
* missing steps
* incorrect assumptions
* boundary violations
* formatting errors
* unexpected verbosity
* invented structure
* incorrect persona activation

Left unchecked, these accumulate into systemic drift.

---

## How the Engine Prevents Drift

The architecture includes multiple drift‑prevention mechanisms:

### Profile Contracts

Each profile has strict responsibilities and boundaries.

### Governed Communication

`@handoff` and `@start` enforce deterministic transitions.

### Context Isolation

Threads prevent cross‑contamination between workflows.

### Documentation Anchors

AI‑ready files provide curated, stable context.

### Rule Enforcement

Universal rules prevent mutation, overreach, and identity collapse.

### Pattern Anchoring

Commit messages, diffs, and stories follow strict formats.

### User Review at Every Handoff

The user acts as the governance checkpoint.

---

## How Retro Detects Drift

Retrospective analyzes:
* the Cycle’s reasoning
* profile behavior
* communication patterns
* rule adherence
* documentation alignment
* structural consistency

Retro identifies drift by comparing:
* expected patterns
* actual behavior
* rule definitions
* profile contracts
* documentation lineage

Retro then produces **improvement recommendations**.

---

## How Side Trips Correct Drift

Side trips run in a separate thread using `@send`/`@receive`,
following the same drift prevention mechanics as `@handoff`/`@start` in the main thread,
allowing work to happen in parallel without affecting the main thread’s context or state.

When a side trip is performed:
1. A side trip is initiated
2. The side trip runs in a separate thread with isolated context
3. The appropriate profile (Architect, Documentor, Enforcer, etc.) performs the requested action
4. If the side trip is multi-profile a new `@send` is initiated,
   and reviewed before being picked up by the next profile in line
   1. The next profile does a `@receive` and performs the requested action 
5. The user reviews the side trip output and confirms completion 
6. The user notifies the main thread when complete
7. The Cycle resumes with side trip complete

Side trips ensure parallel operation does not contaminate the main thread.

---

## Drift Is Managed, Not Eliminated

Drift is a natural force in cognitive systems.  
This architecture governs drift through structure, isolation, detection, correction, and user review.
