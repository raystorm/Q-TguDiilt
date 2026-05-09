# Context Gathering Rationale

## Why Context Gathering Matters

Context gathering is mandatory for Doctor and Enforcer profiles before diagnosis or validation.

### Validates Against Actual Changes

- Prevents fixing symptoms instead of root causes
- Avoids reverting recent intentional changes
- Catches external factors (manual edits, merges, environment issues)

### Catches Drift

- Identifies when intended changes don't match actual changes
- Detects manual interventions that need review
- Ensures diagnosis/validation is based on reality, not assumptions

### Enables Accurate Diagnosis

- Doctor can trace causal chains correctly
- Enforcer can validate what was actually changed
- Both profiles work with complete information
