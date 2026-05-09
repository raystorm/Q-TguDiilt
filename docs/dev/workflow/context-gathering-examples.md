# Context Gathering Examples

This document contains detailed context gathering examples referenced by `.workflow/rules/workflow/context-gathering.md`.

---

## Example: Doctor Context Gathering

```
User: "Act as Doctor. Tests are failing."

Doctor:
1. Checks .amazonq/work/FEATURE.md
   - Found: Story 2 of 3 (Schema changes)
   - Dependencies: Story 1 complete (guards added)

2. Reads .amazonq/workflow.log
   - Builder modified Collection.graphql (22:45:00)
   - Builder added FilterInput types (22:46:00)
   - Enforcer validated changes (22:50:00)

3. Runs git diff
   - Collection.graphql: Added SummaryFilterInput
   - CollectionInput.graphql: Added nested filter fields

4. Validates alignment
   - Changes match workflow log ✓
   - Proceeds with diagnosis

Doctor: "Context gathered. Analyzing test failures..."
```

---

## Example: Enforcer Context Gathering

```
User: "@start"

Enforcer:
1. Checks .amazonq/work/FEATURE.md
   - Found: Story 1 of 3 (Add guards)
   - No dependencies

2. Reads .amazonq/workflow.log
   - Builder created createBoxGuarded.js (21:30:00)
   - Builder created updateBoxGuarded.js (21:32:00)
   - Builder added tests (21:35:00)

3. Runs git diff
   - amplify/data/Box/createBoxGuarded.js (new file)
   - amplify/data/Box/updateBoxGuarded.js (new file)
   - amplify/data/Box/__tests__/guards.test.js (new file)

4. Validates alignment
   - Changes match workflow log ✓
   - Code and tests were changed
   - Asks user to run tests

Enforcer: "Context gathered. Please run the test suite and confirm results."
```
