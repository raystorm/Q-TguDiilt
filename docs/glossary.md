# 📘 **GLOSSARY**
*A reference dictionary for the terminology used throughout this architecture.*

---

## **Cognitive Engineering**
The discipline of designing, governing, and shaping the reasoning processes of AI systems.
Focuses on drift‑resistant thinking, context structuring, and semantic clarity.
Cognitive engineering governs **how an AI thinks**, independent of how many agents exist.
Often includes **self-improvement loops** such as reflection, correction, and improvement.

---

## **Agentic Engineering**
A discipline for designing **governed, multi‑agent workflows**.  
It emphasizes explicit **profile contracts**, **drift‑resistant reasoning**, and **context continuity**.  
Agentic engineering is not AI-assisted coding;
it is the **architecture** behind multi-agent systems that reason, coordinate,
and maintain state across tasks.

---

## **AI Engineering**
The broader discipline of building AI systems that are reliable, governed, and production‑ready.  
Includes model integration, orchestration, safety boundaries, and lifecycle management.

---

## **AI Development**
Using AI tools to write, review, or assist with code.  
This includes AI pair programming, code generation, refactoring, and debugging.  
AI Development is a **workflow enhancement**, not an architectural discipline.

---

## **Context Engineering**
The discipline of structuring, governing, and preserving **cognitive context** across agents and tasks.  
Includes:
- context capsules
- suspend/resume semantics
- lineage tracking
- boundary enforcement
- drift‑resistant context shaping

Context engineering ensures that agents operate with **stable, intentional, and auditable context**,
not ad‑hoc prompts.

---

## **Context Governance**
The discipline of defining the rules, boundaries,
and lifecycle policies that cognitive context must follow.  
Context Governance ensures that context remains valid, intentional, bounded,
auditable, and compliant with profile contracts.  
It establishes the constraints that prevent drift, unauthorized mutation,
and context collapse.

---

## **Context Control**
The operational enforcement layer that applies the rules defined by Context Governance.  
Context Control prevents unauthorized mutations, validates context capsules,
enforces access rules, and maintains context integrity across workflows.  
Where Context Engineering defines structure and Context Governance defines rules,
Context Control enforces them at runtime.

---

## **Prompt Engineering**
The practice of shaping model outputs through carefully crafted prompts.  
Prompt engineering operates at the **surface layer** of interaction with a model.  
In this architecture, prompt engineering is considered a **legacy technique**
superseded by context engineering and agentic engineering.

---

## **Profile Contract**
A formal specification of an agent’s identity, responsibilities, boundaries, and allowed behaviors.  
Profile contracts prevent drift, enforce role clarity, and create predictable multi-agent coordination.

---

## **Context Capsule**
A structured container for cognitive state.  
Capsules preserve:
- task intent
- constraints
- history
- lineage
- agent roles
- environmental assumptions

They enable suspend/resume, multi‑story workflows, and continuity across outages.

---

## **Semantic Lineage**
A traceable record of how reasoning, decisions, and artifacts evolve over time.  
Lineage ensures:
- auditability
- teachability
- drift detection
- reproducibility

It is the cognitive equivalent of version control.

---

## **Drift‑Resistant Reasoning**
A set of architectural constraints and patterns that prevent agents from:
- losing context
- hallucinating new rules
- violating contracts
- mutating their identity
- collapsing boundaries

Drift‑resistance is enforced through contracts, capsules, lineage, and governed workflows.

---

## **Suspend/Resume Semantics**
A mechanism that allows cognitive workflows to pause, externalize state,
and resume without loss of context or identity.  
Critical for:
- long-running tasks
- multi‑agent handoffs
- outage recovery
- multi‑story workflows

---

## **Teachable Artifact**
Any output designed to be:
- intention‑revealing
- diff‑minimizing
- structurally consistent
- reusable
- auditable

Examples: diagrams, contracts, lineage logs, structured reasoning outputs.

---

## **Override Grammar**
A formal, explicit syntax (`Override:`) used to intentionally break or modify rules.  
Prevents accidental drift and makes deviations **grep‑able**, auditable, and intentional.

---

## **Governed Cognitive Workflow**
A workflow where an AI system (single or multi‑agent)  
performs **structured, self‑correcting reasoning** under explicit governance.  
It includes:
* explicit rules
* contracts
* boundaries
* lineage
* context capsules
* drift‑resistant reasoning
* self‑improvement loops (reflection, correction, improvement)
* continuity across tasks

This is the core of **cognitive engineering**.

---

## **Multi‑Agent Orchestration**
Coordinating multiple agents with distinct roles, contracts, and contexts.  
Orchestration includes:
- task routing
- context passing
- conflict resolution
- lineage merging
- boundary enforcement

---

## **Free Prompting**
**Definition:**  
The earliest phase of working with AI systems, characterized by raw,
unstructured prompts with no roles, no profiles, no capsules, and no workflow.
Everything is done manually, context is repeated constantly, and drift is common.

**Why it matters:**  
Free Prompting is the baseline that revealed the limitations of prompting itself.
It marks the “pre‑architecture” era before structure, governance, or continuity existed.

---

## **Meta‑Prompting**
**Definition:**  
The attempt to scale prompting by having one AI generate prompts for another AI
(e.g., Microsoft Copilot generating prompts for Amazon Q).
In practice, this produces more complexity, more drift, and more correction work.

**Why it matters:**  
Meta‑Prompting was the turning point.
It proved that prompting—even automated prompting—cannot solve drift, identity collapse,
or context loss. This failure pushed the system toward structure and ultimately toward BMAD.

---

## **BMAD Method**
**Definition:**  
A prompting technique based on a Builder → Tester → Validator chain.
Originally designed as a manual, copy/paste workflow using single prompts for each step.
BMAD introduced the idea of sequential roles but lacked governance, continuity,
and context management.

**Why it matters:**  
BMAD was the bridge between prompting and architecture.
It forced role‑thinking, exposed the pain of context repetition,
and directly led to the creation of profiles and capsules.
BMAD is the proto‑architecture phase of the system.

---

## **Prompt Chaining**
**Definition:**  
A manual sequence of prompts where the output of one step (Builder)
is passed to the next (Tester), then to the next (Validator).
Each step requires re‑establishing context, usually through copy/paste.

**Why it matters:**  
Prompt Chaining is the structural ancestor of workflows.
It revealed the need for persistent context, formal roles,
and a way to pass information without repetition—leading
directly to capsules and governed workflows.

---

## **Persona**
**Definition:**  
An informal role used during early prompting experiments
(e.g., “planner,” “reviewer,” “critic”).
Personas were conceptual and inconsistent, lacking boundaries, contracts, or governance.

**Why it matters:**  
Personas were the precursor to **profiles**. 
As BMAD roles gained structure, personas evolved into defined,
governed entities with responsibilities and constraints.
Profiles replaced personas as the system matured.

---
