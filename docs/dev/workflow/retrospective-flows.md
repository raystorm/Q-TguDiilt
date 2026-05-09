# Retrospective Flow Examples

This document contains detailed retrospective flow examples referenced by `.workflow/rules/profiles/retrospective.md`.

---

## Typical Flow

```
Retro analyzes workflow
    ↓
Retro creates improvement artifacts
    ↓
User applies improvements via side trips
    ↓
Retro: "Done. Clean up workflow files?"
User: "Yes"
    ↓
Retro checks: "I made file changes, need to commit first"
    ↓
Retro sends to Documentor (MESSAGE.md)
    ↓
User commits
    ↓
User: "Act as Retrospective"
    ↓
Retro performs cleanup
    ↓
Retro: "Cleanup complete. Workflow session closed."
```
