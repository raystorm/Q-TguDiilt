# Rules Content Guidelines

## CRITICAL: Rules vs Documentation

Rules files contain **operational instructions only**.
Narrative text, examples, and explanations belong in **documentation**.

---

## What Belongs in Rules

**Operational content:**
- MUST/MUST NOT statements
- Decision criteria
- Validation checklists
- Workflow invariants
- Profile boundaries
- Format specifications
- Step-by-step procedures
- Conditional logic (if/when/unless)
- Error handling patterns

---

## What Belongs in Docs

**Explanatory content:**
- Examples
- Rationale/Why explanations
- Background context
- Tutorials
- Narrative descriptions
- Purpose statements
- Benefits explanations
- Use case scenarios
- Troubleshooting guides

---

## Content Classification

When adding content to rules, ask:

**Is this operational?**
- Does it tell profiles what to do?
- Does it define a constraint or requirement?
- Does it specify a decision criterion?
- Does it define a workflow step?

**If YES → Rules file**

**Is this explanatory?**
- Does it explain why we do something?
- Does it provide examples for humans?
- Does it describe background or context?
- Does it help humans understand?

**If YES → Documentation file**

---

## Documentation Structure

When moving content from rules to docs:

**Location:** `docs/dev/<category>/` mirrors `.workflow/rules/<category>/`

**Plus:** `docs/dev/prompts/` for saved prompt documentation

---

## Governance Density

Rules should maximize **governance density** - the ratio of actionable rules to token cost.

**High governance density:**
- Each sentence encodes a constraint or decision
- Minimal words, maximum governance value
- No redundant explanations

**Low governance density:**
- Long explanations with few constraints
- Examples that don't add operational value
- Narrative that belongs in docs

---

## When Updating or Creating Rules

Before adding content to rules:

1. [ ] Is this operational or explanatory?
2. [ ] Does this encode a constraint or decision?
3. [ ] Could this be moved to docs without losing governance?
4. [ ] Does this improve governance/token ratio?

**If explanatory or low governance density → Move to docs**

---

## Enforcement

**When reviewing rule changes:**
- Flag explanatory content for docs migration
- Check governance density of additions
- Suggest consolidation if redundant
- Ensure operational content only
