# User Guide

*A practical guide for operating the  
**Self‑Improving AI Software Engineering Workflow Engine***

This guide explains how to **use** the workflow engine day‑to‑day.  
It is written for the human operator — the person issuing commands,
reviewing handoffs, and steering multi‑profile workflows.

If you want to understand the philosophy, architecture, or rules behind the system,  
see:
* [**Workflow System One-Pager Deep Dive**](../dev/ai-workflow-system.md)
* [**Overview**](../overview.md)
* [**Profiles**](../profiles.md)
* [**User Commands**](../user-commands.md)
* [**Workflow Patterns**](../dev/workflow-patterns.md)
* [**Mindset**](../mindset.md)

This guide focuses on *practical usage*.

---

## 1. What This System Is

This workflow engine is a **governed, multi‑profile AI development workflow system**
built on Amazon Q.  
It structures work into predictable steps, each performed by a specialized profile:
* Architect
* Planner
* TestDesigner
* Builder
* Enforcer
* Documentor
* Retrospective
* …and others

Each profile has a **single responsibility**, a **bounded worldview**,
and **deterministic behavior** defined by rule files.

You, the human operator, guide the system by issuing **User Commands** and reviewing **handoffs**.

---

## 2. How to *Run* a Workflow

Once installation is complete (see [Installation Guide](../../README.md#installation)),
open Amazon Q and begin with a safe analytical task:

After completing the initial safe analysis from the [README](../../README.md#getting-started),
the next step is to turn that analysis into a governed workflow.

Begin by asking Architect to identify and prioritize the most important change:

```text
Help me implement the most critical issue already identified.
Explain why it is the most critical finding.
```

**Architect** will:
* interpret the analysis
* identify the highest‑impact issue
* justify the prioritization
* outline the minimal change required
* prepare the problem for Planner

From here, the workflow engine follows a predictable governed sequence:
**Architect** will ask you to `@handoff` and send you to **Planner**,   
which will begin a *workflow Cycle* as defined in [*Section 6*](#6-your-role-in-the-workflow-cycle).

Each transition between profiles uses a **reviewable handoff**,
which you must approve before the next profile begins.
Each handoff begins with `@handoff`, and the next profile starts with `@start`.

This section teaches you how to operate the workflow.  
For deeper architectural context, see the [Workflow System Deep Dive](../dev/ai-workflow-system.md).

---

## 3. Understanding Workflow Files

The engine uses explicit, file‑based handoffs to maintain clarity and auditability.

See the [Workflow Artifacts](../dev/contract.md#2-canonical-workflow-artifacts)
for full details.

These files represent workflow state.  
They are created **only** by User Commands.  
Profiles never create workflow artifacts on their own.

**HANDOFF.md**  
A structured, reviewable transfer of responsibility between profiles, in the **main thread**.

**MESSAGE.md**  
A structured request for parallel or isolated work, in a **side trip**.

**Suspended Contexts**  
A serialized snapshot of workflow state.

**Auto-Suspended Contexts**  
Lightweight, automatically maintained *Suspended Contexts*. 

**INDEX.md**  
Tracks all suspended and auto-suspended contexts.

### `workflow.log`

An append‑only JSONL formatted log of workflow events and human insights.

Contains:
* workflow events (starts, handoffs, decisions, corrections, etc)
* suspends/resumes
* notes (human insights)
* timestamps

Location:
`.amazonq/workflow.log`

---

## 4. How to Use Commands

User Commands are the **verbs** of the system.  
They fall into five groups.

For each command, this section lists:
* **What it does**  
* **Which file(s) it creates, reads, or updates**  
* **Arguments in the prompt (if any)**  
* **Usage examples**  

### 4.1 Transfer Commands

#### `@handoff`

Linear progression to the next profile.  

**Creates:**  
* `HANDOFF.md`

**Arguments:**  
* `next=<Profile>` (optional) — override the next profile

**Usage:**  
```text
@handoff
@handoff next=Planner
@handoff next=Enforcer
```

#### `@send`

Create a side trip message for parallel or isolated work.

Use when:
* you need parallel expertise
* you want isolated work
* you don’t want to block the main thread

**Creates:**  
* `MESSAGE.md`

**Arguments:**  
* `to=<Profile>` (optional) — override the target profile  
* `purpose="<text>"` (optional) — short description of what you want done  

**Usage:**  
```text
@send
@send to=Architect
@send to=Enforcer purpose="validate the test plan"
@send purpose="review this schema"
```

---

### 4.2 Activation Commands

#### `@start`

Activate a profile from a handoff.

**Reads:**  
* `HANDOFF.md`

**Usage:**  
`@start`

#### `@receive`

Activate a profile from a message.

**Reads:**  
* `MESSAGE.md`

**Usage:**  
`@receive`

---

### 4.3 Save / Restore Commands

#### `@suspend [name]`

Save full workflow context.

**Creates:**  
* `.amazonq/suspended/[name].md`  
* updates `.amazonq/suspended/INDEX.md`

**Arguments:**  
* `name` (optional) — custom label for the suspended context

**Usage:**  
```text
@suspend
@suspend login-feature
```

#### `@resume [name]`

Restore a suspended (or auto-suspended) context.

**Reads:**  
* `.amazonq/suspended/[name].md`

**Arguments:**  
* `name` (optional) — if omitted, shows a list 
  of all available suspended and auto-suspended contexts. 

**Usage:**  
```text
@resume
@resume login-feature
```

#### `@list`

Show all suspended and auto-suspended contexts.

**Reads:**  
* `.amazonq/suspended/INDEX.md`

**Usage:**  
`@list`

---

### 4.4 Logging Commands

#### `@note [text]`

Append a human insight to the workflow log.

Use this to preserve decisions, constraints, or clarifications.

**Appends to:**  
* `workflow.log`

**Arguments:**  
* `[text]` (required)

**Usage:**  
`@note how do we "enforce" documentation auto-updates cleanly?`

---

### 4.5 Convenience Commands

These are UX shortcuts, not workflow primitives.
They exist to reduce friction, not to define workflow mechanics.

#### `@dr`

Start Doctor to troubleshoot a test failure.

**Arguments:**  
* pasted test output

**Usage:**  
```text
@dr
<paste test failure>
```

#### `@inquiry`

Enter question‑only mode for a single message.  
Prevents accidental activation of workflow commands.

**Arguments:**
* prompt text question

**Usage:**
`@inquiry What is the next profile after handoff?`

#### `@epr`

Evaluate a prompt/response pair for rule compliance.

**Arguments:**  
* raw pasted text  
* optional separator (`---`, `===`, etc.) to distinguish prompt vs response  

**Usage:**  
```text
@epr
<prompt>
---
<response>
```

Or simply:

```text
@epr
<raw terminal transcript>
```

#### `@send-epr`

Side trip version of `@epr`.  
Sends the evaluation request to Enforcer in a separate tab.

**Creates:**  
* `MESSAGE.md` (with `To: Enforcer` and `Purpose: epr`)

**Arguments:**
* raw pasted text
* optional separator (`---`, `===`, etc.) to distinguish prompt vs response

**Usage:**  
```text
@send-epr
<prompt>
===
<response>
```

Or simply:

```text
@send-epr
<raw terminal transcript>
```

---

## 5. How Profiles Behave

Profiles are **governed actors**.  
They:
* load rule files
* operate within strict boundaries
* perform one job
* produce artifacts
* hand off work
* never improvise
* never cross domains

**Profiles are not simple personas.  
They execute deterministic behavior defined by rules.**

### Who you gonna call?

When in doubt, call the **Operator**.
```text
Act as Operator, who I do talk to solve [problem statement or question]?
```

Operator will route your request to the correct profile based on:
* the type of work
* the workflow state
* the next governed step

### Full Profile definitions

For a full list of  Profiles and definitions see: [profiles.md](../profiles.md)

---

## 6. Your Role in the Workflow Cycle

The workflow engine runs a governed sequence of profiles,
but **you**, the user, control the loop.

At each step, your job is to:
* review what the profile produced
* trigger the handoff with `@handoff`
* approve or reject the handoff
* trigger the next step with `@start`
* keep the workflow on track

Below is your role at each stage.

### 1. Plan

**Your job:**  
* review the story  
* ensure acceptance criteria are needed  
* approve the handoff

### 2. (Optional) Analyze

*Only when Planner escalates, or from explicit user request.*
**Your job:**  
* confirm the architectural interpretation  
* ensure the scope is correct  
* approve the handoff

### 3. Define Tests

**Your job:**  
* check that test scenarios match the story  
* ensure nothing is missing  
* approve the handoff

### 4. Prepare to Implement

**Your job:**  
* confirm the Builder prompt is clear  
* ensure minimal‑change principles are followed  
* approve the handoff 

### 5. Implement

**Your job:**  
* review diffs  
* confirm changes are correct  
* approve the handoff

### 6. Review

**Your job:**  
* confirm validation passed  
* ensure no issues remain  
* approve the handoff

### 7. Commit

**Your job:**  
* review the commit message for completeness and clarity
* commit the change
* decide whether to continue the feature or run a retrospective  
* approve the handoff

### 8. Retrospective

**Your job:**  
* review improvement suggestions  
* choose which (if any) to apply  
* trigger the next workflow or close the loop

*Each step is profile‑scoped and rule‑constrained.*

---

## 7. When to Switch Profiles

Switch profiles when:
* the current profile’s job is complete
* the next step belongs to another domain/profile
* a handoff or message is required
* a profile hits a boundary
* a profile escalates

The system is designed so that **you never guess**.  
The profile will tell you when it’s time to hand off.

---

## 8. How to Recover from Mistakes

### Wrong profile?

If you activated the wrong profile, recovery depends on whether a workflow file was created.
* If no file was created: simply switch to the correct profile. `Act as CorrectProfile` 
* If a file *was* created (HANDOFF.md, MESSAGE.md): delete the file and re‑issue the correct command.
* If you were in the middle of a workflow: resume a previous suspended context.

### Wrong command?

Recovery depends on the command:
* If it created a file (handoff, send, suspend): re‑issue the correct command.
* If it activated a profile (start, receive): switch back or resume a previous context.
* If it logged a note: ignore it (notes are harmless and append‑only).
* If it was a convenience command (inquiry, epr, send‑epr, dr): no recovery needed.

### Lost context? (e.g., accidental tab closure)

Use:

```text
@list
@resume  [suspendFileName]
```
If auto‑suspend is enabled, resume the most recent auto‑checkpoint.

### Misaligned handoff?

Ask the profile to regenerate the handoff with corrected intent.
Approve the new handoff and continue the workflow.

---

## 9. Where to Go Next

For deeper understanding:
* [**Workflow System One-Pager Deep Dive**](../dev/ai-workflow-system.md)
* [**Overview**](../overview.md) — entry point
* [**Workflow Patterns**](../dev/workflow-patterns.md) — execution shapes
* [**Profiles**](../profiles.md) — actors
* [**User Commands**](../user-commands.md) — verbs
* [**Contract**](../dev/contract.md) — invariants
* [**Governance**](../dev/governance.md) — rule interpretation
* [**Mindset**](../mindset.md) — philosophy

This guide teaches you how to *use* the system.  
The rest of the documentation teaches you how the system *works*.
