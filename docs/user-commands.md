# User Commands

User commands are the only workflow actions a user can issue.  
They create or load workflow files, activate profiles, transfer work,
manage state, or log insights.  
All commands are saved prompts stored in `.amazonq/prompts/`.

> [!IMPORTANT]
> Prompts are saved in `.amazonq/prompts/` inside the repository,
> for version control, and portability. In Order to actually *use* the commands,
> they will need to be installed to the users Amazon Q prompts directory
> `~/.aws/amazonq/prompts`.
> See the [Installation Guide](../README.md#-installation) for more information.

Commands fall into five groups.

---

## 1. Transfer Commands
Commands that move work between profiles by generating a workflow file.

### `@handoff`
Create a linear workflow handoff for the next profile in the main thread

- Produces `HANDOFF.md`
- Current profile summarizes work and requests confirmation
- User reviews and approves
- Next profile is activated via `@start`

Used for: linear progression (Architect → PE → Builder → Enforcer → Documentor)

### `@send`
Create a side‑trip message for parallel work.

- Produces `MESSAGE.md`
- Current profile summarizes work and requests confirmation
- User reviews and approves
- Next profile activated *in a side-trip tab* via `@receive`
- Target profile performs isolated work
- User can return to main thread

Used for: parallel expertise, non‑blocking work, isolated tasks.

**Symmetry:**  
Both commands create context capsule, to request work from another profile.  
Both commands ask for user review and confirmation.  
The only difference is the file:
- `@handoff` → HANDOFF.md
- `@send` → MESSAGE.md

---

## 2. Activation Commands
Commands that activate a profile by loading a workflow file.

### `@start`
Activate a profile from a **handoff**, and performs the requested action.

- Loads `HANDOFF.md`
- Continues a workflow

### `@receive`
Activate a profile from a **message**, and performs the requested action.

- Loads `MESSAGE.md`
- Continues or begins a side-trip workflow

**Symmetry:**  
Both commands activate a profile and load context.  
The only difference is the file:
- `@start` → HANDOFF.md
- `@receive` → MESSAGE.md

---

## 3. Save / Restore Commands
Commands that manage full workflow context.

### `@suspend`
Save workflow context, in a full context capsule.

- Writes `.amazonq/suspended/[name].md`
- Updates `INDEX.md`
- Replaces auto‑suspend for current workflowId

### `@resume`
Load workflow context, from an `@suspend`, or auto-suspend file.

- Lists contexts if no name provided
- Loads `.amazonq/suspended/[name].md`
- Restores profile and state

### `@list`
Show all suspended contexts.

- Reads `INDEX.md`
- Displays manual, auto, and completed contexts

---

## 4. Logging Commands
Commands that record user insights.

### `@note`
Append a user observation to `workflow.log`.

- Logs an event in a JSONL format
- Captures human insight for later retrospective analysis

---

## 5. Convenience Commands
Saved prompts that provide UX shortcuts.  

### `@dr`
Start Doctor to troubleshoot a test.

### `@epr`
Enforcer evaluates a prompt and response.

### `@send-epr`
Combine `@send` + `@epr` into a single side‑trip evaluation.

---

## Relationship to Other Documents

- [**Contract**][contract] defines guarantees and invariants for command handling.
- [**Workflow Mechanics**][mechanics] describe how handoffs, messages, and activation work.
- [**Workflow Patterns**][patterns] describe execution shapes (Normal Build, TDD, Multi‑Story, Retrospective).
- [**Rules & Governance**][governance] define interpretation, overrides, and constraints.

This document defines the commands themselves.

[contract]: dev/contract.md
[mechanics]: ../.amazonq/rules/workflow/workflow-mechanics.md
[patterns]: dev/workflow-patterns.md
[governance]: dev/governance.md