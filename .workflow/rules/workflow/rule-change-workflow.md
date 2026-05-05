# Rule Change Workflow

## CRITICAL: PromptEngineer Owns Rule Modifications

Rules are prompts. PromptEngineer edits rules directly.

---

## Standard Rule Change Workflow

```
Planner → TestDesigner (if needed) → PromptEngineer (rules) → Documentor (docs) → Enforcer → Documentor (commit)
```

**Profile responsibilities:**

1. **Planner:** Write user story for rule change
2. **TestDesigner (if needed):** Determine if validation scenarios needed (usually skip for rules)
3. **PromptEngineer:** Edit rules files directly + create/update documentation
4. **Documentor:** Create/update documentation files (if PE didn't already)
5. **Enforcer:** Validate rules changes and documentation
6. **Documentor:** Create commit message for both rules and docs

---

## PromptEngineer Responsibilities

When modifying rules:

1. **Edit rules files directly** (no Builder handoff)
2. **Follow rules content guidelines** (operational only, no narrative)
3. **Run rule change validation** (governance density, contradictions, impact)
4. **Create/update documentation** (move explanatory content to docs)
5. **Hand off to Documentor** if additional docs work needed
6. **Hand off to Enforcer** for validation

**PromptEngineer does NOT:**
- Create Builder prompt for rules changes
- Hand off to Builder for rules editing
- Builder is for code implementation, not prompt engineering

---

## Documentor Responsibilities

When receiving handoff from PromptEngineer:

1. **Review what rules were changed** (from PE handoff)
2. **Create/update documentation files** (if PE didn't already)
3. **Ensure explanatory content moved from rules to docs**
4. **Hand off to Enforcer** for validation

**If PE already created docs:**
- Review for completeness
- Make minor adjustments if needed
- Hand off to Enforcer

---

## Enforcer Responsibilities

When validating rule changes:

1. **Validate rules changes** (operational content only, no narrative)
2. **Validate documentation changes** (narrative/examples present)
3. **Check alignment** (content moved from rules appears in docs)
4. **Verify no contradictions or overlap** (rule change validation)
5. **Hand off to Documentor** for commit message

---

## Critical Handoff Validation

**PromptEngineer → Documentor handoff MUST include:**
- What rules were changed (files, sections)
- What content was moved/extracted (for docs creation)
- Where docs should be created (path structure)
- Validation checklist for Enforcer

**PromptEngineer → Enforcer handoff MUST include:**
- What rules were changed
- What documentation was created/updated
- Governance density calculation
- Contradiction/overlap scan results
- Impact analysis

---

## When Builder IS Needed

**Exception:** If rule change requires code changes (e.g., updating workflow mechanics that affect both rules AND implementation):

```
Planner → TestDesigner → PromptEngineer (rules) → Builder (code) → Enforcer → Documentor
```

**This is rare. Most rule changes are rules-only.**

---

## Testability Gatekeeper

**Planner decides if TestDesigner needed:**
- Rules changes usually skip TestDesigner (no testable logic)
- Configuration-only changes skip TestDesigner
- Pure documentation updates skip TestDesigner

**Standard routing for rules:**
```
Planner → PromptEngineer (skip TestDesigner)
```

**When TestDesigner needed:**
- Rule change affects runtime behavior
- Validation scenarios needed
- Complex decision criteria requiring test coverage

---

## Enforcement

**Planner:**
- Route rules changes directly to PromptEngineer (skip Builder)
- Skip TestDesigner unless validation scenarios needed

**PromptEngineer:**
- Edit rules directly, don't create Builder prompts for rules
- Hand off to Documentor or Enforcer (not Builder)

**Builder:**
- If receiving rules change request, escalate to Planner
- "Rules changes should route through PromptEngineer, not Builder"
