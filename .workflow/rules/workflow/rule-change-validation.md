# Rule Change Validation

## CRITICAL: Validate Before Committing Rule Changes

When adding or modifying rules, validate:
1. Governance density (actionable rules vs token cost)
2. Contradiction & overlap scan
3. Impact analysis

---

## 1. Governance Density Check

**Governance density** = ratio of actionable rules to token cost

**Qualitative assessment:**
- **High:** Predominantly atomic, constraint-bearing, directly executable
- **Medium:** Mix of atomic constraints with descriptive text
- **Low:** Significant explanation, rationale, narrative, or examples

**Quantitative baseline (current rules average ~1.76 rules per 100 tokens):**
- **High density:** 2.3+ rules per 100 tokens
- **Medium density:** 1.3-2.3 rules per 100 tokens
- **Low density:** <1.3 rules per 100 tokens

**Calculate governance value:**
- Count MUST/MUST NOT statements
- Count decision criteria
- Count validation checklists
- Count workflow invariants
- Count profile boundaries
- Count format specifications

**Calculate token cost:**
- Estimate tokens added (roughly 4 characters per token)

**Decision:**
- High/Medium density → Approve addition
- Low density → Move to docs or consolidate

---

## 2. Contradiction & Overlap Scan

**Before adding rule, search existing rules for:**
- Related concepts
- Similar constraints
- Overlapping responsibilities
- Conflicting requirements

**Search pattern:**
```bash
grep -r "keyword1\|keyword2\|keyword3" .workflow/rules/ --include="*.md"
```

**Check for:**

**Contradictions:**
- Rule conflicts with existing rule
- **Action:** Resolve contradiction before adding

**Redundancy:**
- Rule duplicates existing rule
- **Action:** Don't add, reference existing rule instead

**Overlap:**
- Rule partially covered by existing rule
- **Action:** Consolidate into existing rule or clarify distinction

---

## 3. Impact Analysis

**Identify affected profiles:**
- Which profiles consume this rule?
- Does change affect multiple profile behaviors?
- Does change introduce new cross-references?

**Check for cascade risks:**
- Does rule reference other rules?
- Does rule create dependencies?
- Could change cause context collapse?

**Assess change scope:**
- Single-purpose change (one concept)
- Multi-concept change (multiple ideas)
- Cross-cutting change (affects many profiles)

---

## Validation Checklist

Before committing rule changes:

- [ ] **Governance density:** High or Medium (or moved to docs)
- [ ] **Contradiction scan:** No conflicts with existing rules
- [ ] **Overlap scan:** No redundancy, consolidation considered
- [ ] **Impact analysis:** Affected profiles identified
- [ ] **Cascade risk:** Low or mitigated with phasing
- [ ] **Single-purpose:** Change addresses one concept
- [ ] **Documentation:** Explanatory content moved to docs

**If any check fails, revise before committing.**

---

## Enforcement

**PromptEngineer (when modifying rules):**
- Run validation checklist before creating changes
- Document governance density calculation
- Document contradiction/overlap scan results
- Document impact analysis

**Enforcer (when validating rule changes):**
- Verify validation checklist completed
- Spot-check governance density
- Verify no contradictions introduced
- Verify impact analysis accurate
