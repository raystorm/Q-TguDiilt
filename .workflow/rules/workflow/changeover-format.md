# Changeover File Format

Single canonical format for all changeover files (HANDOFF.md and
MESSAGE.md). Both use the same shape. The filename determines
thread semantics:
- `HANDOFF.md` — linear changeover (main thread progression)
- `MESSAGE.md` — parallel changeover (side trip)

## Canonical Shape

```markdown
# [Changeover Type] to [Profile]

## To
[Target Profile]

## From
[Source Profile]

## WorkflowId
[wf-kebab-case-id]

## Task
[What needs to be done]

## Context Capsule
[Background, decisions, state, and continuity needed
for the receiving profile]

## Artifacts
[Relevant files]

## Expected Outcome
[What receiving profile should produce]
```

## Field Definitions

| Field            | Required | Description                                        |
| ---------------- | -------- | -------------------------------------------------- |
| To               | Yes      | Target profile (machine-parseable routing)         |
| From             | Yes      | Source profile that created the changeover         |
| WorkflowId       | Yes      | Workflow identity (format: wf-[kebab-case])         |
| Task             | Yes      | What the receiving profile needs to do             |
| Context Capsule  | Yes      | Continuity container: background, decisions, state |
| Artifacts        | Yes      | Files created, modified, or relevant to the task   |
| Expected Outcome | Yes      | What the receiving profile should produce          |

## Heading Convention

The heading encodes changeover type and target:
- Handoff: `# Handoff to [Profile]`
- Message: `# Message to [Profile]`

## Locations

- `.amazonq/work/current/HANDOFF.md`
- `.amazonq/work/current/MESSAGE.md`
