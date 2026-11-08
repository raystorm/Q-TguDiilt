/**
 * A `_PROFILES.md`-shaped text for tests: six profiles. Planner has PO and Strategist, Doctor
 * has Dr and Medic, Enforcer has Verifier, PromptEngineer has PE, TestDesigner has TD, and
 * Architect has no aliases.
 */
export const PROFILE_FIXTURE = `# Profile Definitions

## Planner
Writes user stories.

**Aliases:** PO, Strategist

**Uses:** foundation/*, profiles/planner.md

## Doctor
Diagnoses failures.

**Aliases:** Dr, Medic

**Uses:** foundation/*, profiles/doctor.md

## Enforcer
Reviews code.

**Aliases:** Verifier

**Uses:** foundation/*, profiles/enforcer.md

## PromptEngineer
Writes governed prompts.

**Aliases:** PE

**Uses:** foundation/*, profiles/prompt-engineer.md

## Architect
Defines system design.

**Uses:** foundation/*, profiles/architect.md

## TestDesigner
Identifies test scenarios.

**Aliases:** TD

**Uses:** foundation/*, profiles/test-designer.md
`;
