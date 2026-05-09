# Workflow Examples

Detailed examples of workflow patterns in the AI Workflow System.

For MANDATORY workflow mechanics, see `.workflow/rules/workflow/workflow-mechanics.md`.

---

## Example 1: Standard Handoff

```
Architect completes feature analysis
  ↓
Architect: "Analysis complete.
Created feature breakdown with 3 stories:
  1. Story A — Ingestion pipeline extension for new event type
  2. Story B — Validation layer updates with cross-profile constraints
  3. Story C — Coordination logic for downstream workflow triggers
Recommended phased rollout based on dependency ordering.
Ready to continue? Use: @handoff"
  ↓
User: "@handoff"
  ↓
Architect creates HANDOFF.md:
  "Handoff to Planner with:
   - Feature breakdown (3 stories)
   - Impact analysis (cross-domain, 50+ files)
   - Phase recommendations
   Should I proceed?"
  ↓
User reviews HANDOFF.md
User: "Yes, proceed"
  ↓
Architect: "Handoff complete. Next command: Open new tab and type `@start' to run as Planner"
  ↓
User opens new tab: "@start"
  ↓
Planner reads HANDOFF.md
Planner sequences stories
```

---

## Example 2: Side Trip

```
Retrospective analyzing workflows
  ↓
Retrospective creates rule draft
  ↓
Retrospective: "@send PE"
  ↓
Retrospective creates MESSAGE.md:
  "Message to PE: Review and integrate rule draft"
  ↓
User opens new tab: "@receive"
  ↓
PE reads MESSAGE.md
PE integrates rule draft
PE closes tab
  ↓
User returns to Retrospective tab
Retrospective continues analysis
```

---

## Example 3: Reviewable Handoff Catches Issue

```
TestDesigner creates test scenarios
  ↓
TestDesigner: "Test scenarios complete. Created 27 scenarios for guards."
  ↓
User: "@handoff"
  ↓
TestDesigner creates HANDOFF.md:
  "Handoff to PE with:
   - 27 test scenarios for guards
   Should I proceed?"
  ↓
User reviews HANDOFF.md
User: "Wait, this is missing story requirements. PE needs schema, guards, AND wiring requirements, not just test scenarios."
  ↓
TestDesigner updates HANDOFF.md with full requirements
  ↓
User: "Yes, proceed"
  ↓
TestDesigner: "Handoff complete. Next command: Open new tab and type `'@start' to run as PE"
  ↓
PE receives complete requirements
```

---

## Example 4: Multi-Story Feature Flow

```
Story 1: Planner → TestDesigner → PE → Builder → Enforcer → Documentor
    ↓ (user commits)
Documentor: "Story 1 complete. Continue with Story 2? Use: `@handoff next=Planner`"
User: "@handoff next=Planner"
Story 2: Planner → TestDesigner → PE → Builder → Enforcer → Documentor
    ↓ (user commits)
Documentor: "Feature complete. Run retrospective? Use: `@handoff next=Retrospective`"
User: "@handoff next=Retrospective"
Retrospective analyzes and offers improvements
```

---

## Example 5: Single Story with Retrospective

```
Story: Planner → TestDesigner → PE → Builder → Enforcer → Documentor
    ↓ (user commits)
Documentor: "Work complete. Run retrospective? Use: `@handoff next=Retrospective`"
User: "@handoff next=Retrospective"
Retrospective analyzes and offers improvements
```

---

## Example 6: Single Story, No Retrospective

```
Story: Planner → TestDesigner → PE → Builder → Enforcer → Documentor
    ↓ (user commits)
Documentor: "Work complete. Run retrospective? Use: `@handoff next=Retrospective`"
User: (closes tab, done)
```

---

## Post-Documentor Branching Flows

### Decision Points After Commit

After Documentor creates commit message and user commits:

**1. Continue to Next Story (Multi-Story Feature)**
```
Documentor commits Story 1
    ↓
User: "@handoff next=Planner"
    ↓
Planner reads FEATURE.md
Planner writes Story 2
    ↓
[Execute Story 2 workflow]
```

**2. Run Retrospective (Workflow Improvement)**
```
Documentor commits
    ↓
User: "@handoff next=Retrospective"
    ↓
Retrospective analyzes workflow.log
Retrospective offers improvements
```

**3. Start New Feature (New Work)**
```
Documentor commits
    ↓
User: "@handoff next=Planner" (with new request)
    ↓
Planner creates new story or FEATURE.md
Standard workflow begins
```

**4. Done (No Further Work)**
```
Documentor commits
    ↓
User closes tab
No further workflow needed
```

---

## Decision Tree

```
Documentor commits
    ↓
User decides:
    ├─ More stories in feature? → @handoff next=Planner (next story)
    ├─ Want workflow improvements? → @handoff next=Retrospective
    ├─ New feature? → @handoff next=Planner (new feature)
    └─ Done? → Close tab
```

---

## TDD Workflow Example

```
User requests feature
    ↓
Architect analyzes design
    ↓
Architect: "@handoff"
    ↓
Planner writes user story
    ↓
Planner: "@handoff"
    ↓
TestDesigner creates test scenarios (Given/When/Then)
    ↓
TestDesigner: "@handoff"
    ↓
PromptEngineer creates Builder prompt with TDD approach
    ↓
PE: "@handoff"
    ↓
Builder writes tests first
Builder shows test diffs
User confirms
    ↓
Builder writes implementation
Builder shows implementation diffs
User confirms
    ↓
Builder: "@handoff"
    ↓
Enforcer validates tests pass, checks code quality
    ↓
Enforcer: "@handoff"
    ↓
Documentor creates commit message
    ↓
User commits
```

---

## Context Collapse Recovery Example

```
User: "@start"
    ↓
[No Context Status block appears]
    ↓
User detects context collapse
    ↓
User closes tab
    ↓
User opens new tab
    ↓
User: "@start"
    ↓
=== Context Status ===
Profile: Builder
WorkflowId: wf-1738190400000
Rules Loaded: 12 files
Context: 42%
Logging: ENABLED
Confirmation: ENABLED
======================
    ↓
Context loaded correctly, workflow continues
```

---

## Retrospective Improvement Workflow

```
Retrospective analyzes workflow.log
    ↓
Retrospective: "Found improvement opportunity: rule draft for X"
    ↓
Retrospective creates artifact in .amazonq/work/current/
    ↓
Retrospective: "@send PE"
    ↓
User opens new tab
    ↓
User: "@receive"
    ↓
PE reads MESSAGE.md
PE integrates rule draft
PE shows diffs
User confirms
    ↓
User closes PE tab
    ↓
User returns to Retrospective tab
    ↓
Retrospective: "Improvement applied. Next option?"
```

---

## Escalation Example

```
Builder implementing feature
    ↓
Builder encounters architectural ambiguity
    ↓
Builder: "This requires architectural decision. Escalating to Architect."
    ↓
Builder: "@handoff next=Architect"
    ↓
User: "@handoff next=Architect"
    ↓
Architect analyzes issue
Architect provides architectural guidance
    ↓
Architect: "@handoff next=Builder"
    ↓
Builder continues with clear direction
```

---

## Doctor Diagnosis Example

```
Tests fail after Builder implementation
    ↓
User: "Act as Doctor"
    ↓
Doctor gathers context:
  - Checks FEATURE.md
  - Reads workflow.log
  - Runs git diff
  - Validates alignment
    ↓
Doctor identifies root cause
    ↓
Doctor: "Found issue: test expects old property name. Safe fix available."
Doctor shows diff
User confirms
    ↓
Doctor applies fix
    ↓
Doctor: "@handoff next=Enforcer"
    ↓
Enforcer validates fix
```

---

## Planner Escalation to Architect Example

```
User requests feature
    ↓
Planner starts writing story
    ↓
Planner: "Domain behavior unclear. How does X interact with Y?"
    ↓
Planner: "@handoff next=Architect"
    ↓
Architect analyzes domain behavior
Architect provides domain specification
    ↓
Architect: "@handoff next=Planner"
    ↓
Planner writes story with accurate domain understanding
```
