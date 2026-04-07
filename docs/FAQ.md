# 📘 **FAQ — Frequently Asked Questions**

*A companion to the Glossary.
 This FAQ explains the philosophy, boundaries, and motivations behind this architecture.*

---

## What is this architecture trying to solve?

Modern AI systems drift, lose context, mutate identity, and collapse boundaries.  
This architecture introduces **governed cognition**, **context integrity**,
and **multi‑agent coordination** so AI systems can think, collaborate,
and maintain continuity across tasks.

It turns AI from a prompt‑driven tool into a **structured cognitive system**.

---

## What does the name mean?

The name comes from Smalgyax, the language of the Tsimshian people.  
The name reflects the core functionality of the workflow system.  
  * **Diilt** - means work together.
  * **Tgu** - is a prefix for around, or round.

Together you have `TguDiilt` = Working together in a loop, a "workflow."
this workflow system is built to mimic agile loops with AI.

---

## Why do you use the term “Cognitive Engineering”?

Because this architecture focuses on **how an AI thinks**, not just how it is prompted.

[Cognitive Engineering](glossary.md#cognitive-engineering) describes:
  * structured reasoning
  * [drift‑resistant](glossary.md#driftresistant-reasoning) thinking
  * context continuity
  * self‑improvement loops
  * semantic clarity

It is not a claim to own cognition.  
It is a name for the engineering discipline that governs AI reasoning.

---

## How is Cognitive Engineering different from Agentic Engineering?

They address different layers:
  * **Cognitive Engineering** → how an AI thinks
  * **[Agentic Engineering](glossary.md#agentic-engineering)** → how multiple AIs coordinate

Cognition is internal.  
Agency is external.  
They complement each other but are not the same.

---

## Why separate Context Engineering, Context Governance, and Context Control?

Because context is the backbone of cognition.  
These three layers mirror real engineering disciplines:
  * **[Context Engineering](glossary.md#context-engineering)** → how context is structured
  * **[Context Governance](glossary.md#context-governance)** → what rules context must follow
  * **[Context Control](glossary.md#context-control)** → how those rules are enforced

This separation prevents drift, mutation, and context collapse.

---

## Why not just use prompts? Why all this structure?

Prompts are:
  * ephemeral
  * fragile
  * unbounded
  * non‑auditable
  * prone to drift

This architecture replaces ad‑hoc prompting with:
  * [context capsules](glossary.md#context-capsule)
  * [profile contracts](glossary.md#profile-contract)
  * lineage
  * governance
  * enforcement

It treats cognition as an engineered system, not a text hack.

---

## Is this architecture tied to any specific model or vendor?

Not permanently.

The architecture is **designed to be model‑agnostic and vendor‑agnostic**,
but today it is **implemented on Amazon Q** because Q provides the governed,
multi‑agent substrate this system needs.

The long‑term goal is full portability:
  * profile contracts should work anywhere
  * context capsules should work anywhere
  * governance should work anywhere
  * drift‑resistant cognition should work anywhere

Amazon Q is the *current* implementation environment, not the architectural dependency.

---

## Is this meant for production systems or research?

Both — and it’s already running in production today.

This architecture powers the system at:

🌎 [Smalgyax-Files.org](https://www.smalgyax-files.org)  
💻 [Source Code](https://github.com/raystorm/hukdzen/)

This isn’t a theoretical framework or a demo pattern.  
It’s a **live, governed cognitive system** used in real workflows.

---

## Is this the same as LangChain, AutoGen, or CrewAI?

No.

Those frameworks focus on **tooling and orchestration**.  
This architecture focuses on:
  * governed cognition
  * context integrity
  * drift‑resistant reasoning
  * multi‑agent contracts
  * [semantic lineage](glossary.md#semantic-lineage)

It is an **architectural discipline**, not a framework.

---

## Why is drift‑resistance so important?

Because without drift‑resistance:
  * agents mutate identity
  * rules collapse
  * context degrades
  * reasoning becomes inconsistent
  * workflows become unpredictable

Drift‑resistance is the foundation of reliable cognitive systems.

---

## Why do you emphasize governance so much?

Because governance is what makes cognition:
  * safe
  * predictable
  * auditable
  * bounded
  * intentional

Without governance, multi‑agent systems become chaotic.  
With governance, they become reliable.

---

## What is a Profile Contract and why do agents need them?

A Profile Contract defines:
  * identity
  * responsibilities
  * boundaries
  * allowed behaviors

It prevents agents from:
  * drifting
  * overstepping
  * collapsing roles
  * mutating identity

Profile contracts make multi‑agent systems predictable and safe.

---

## What does “Governed Cognitive Workflow” mean?

It means the system:
  * reasons
  * reflects
  * corrects
  * improves
  * maintains continuity
  * follows rules
  * respects boundaries
  * preserves lineage

It is cognition with structure, not free‑form prompting.

---

## Why is formatting part of the architecture?

Because formatting is:
  * a boundary
  * a contract
  * a governance mechanism
  * a drift‑resistant structure
  * a [teachable artifact](glossary.md#teachable-artifact)

Formatting is not cosmetic — it is cognitive scaffolding.

---

## Is this architecture compatible with LLMOps or MLOps?

Yes — but it sits **above** them.

LLMOps manages models.  
This architecture manages **cognition**.

They complement each other but operate at different layers.

---

## Why does this repo define its own terminology?

Because the industry lacks precise language for:
  * governed cognition
  * context integrity
  * multi‑agent contracts
  * drift‑resistant reasoning
  * cognitive workflows

The [glossary](glossary.md) and FAQ establish the vocabulary needed
to describe the architecture accurately.
