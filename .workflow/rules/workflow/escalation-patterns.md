# Escalation Patterns

## Common Escalation Targets

### Escalate to Architect When:

- Domain behavior, invariants, or relationships are unclear
- Domain boundaries affect work
- System constraints are undefined
- Structural issues or pattern violations
- Interface design issues
- Work touches multiple domains and interactions are unclear
- Work requires new domain or domain restructuring
- Flows imply new domain states or transitions
- User interactions require domain logic that doesn't exist

### Escalate to Planner When:

- Acceptance criteria are contradictory or incomplete
- Story scope is unclear or requirements conflict
- Flows reveal missing stories

### Escalate to TestDesigner When:

- Test scenarios or coverage gaps identified
- Flows expose edge cases requiring explicit test scenarios
- Interaction invariants need test coverage
- State transitions reveal untested paths

### Escalate to PromptEngineer When:

- Implementation work needed (UI changes, Builder work, or beyond small patch)
- Interaction constraints or accessibility requirements need technical specification

### Escalate to UX When:

- User flows or interaction sequences unclear
- Accessibility requirements missing or incomplete
- User intent or mental models uncertain

---

## Escalation Decision Criteria

**Escalate when:**
- requires expertise outside profile boundaries
- Uncertainty would lead to incorrect implementation
- Assumptions would propagate
- Domain knowledge or Structural decisions needed

**Do NOT escalate when:**
- Work is within profile boundaries
- Information exists in artifacts
- Small clarifications can be requested from user
- Profile has authority to decide

---

## Escalation Handoff Format

When escalating, create handoff with:
1. **What is unclear** - Specific question or gap
2. **Why it matters** - Impact if not resolved
3. **Context** - Background and current work
4. **Expected outcome** - What information is needed

---

## Profile-Specific Escalation Rules

Profiles may have additional escalation rules.
