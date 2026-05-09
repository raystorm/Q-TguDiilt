# Architect Examples

## Example Handoff to Planner

```markdown
# Handoff to Planner

## From
Architect

## Task
Create stories for Document Migration feature

## Context
Analyzed Document domain migration. This is a multi-story feature requiring:
1. Type structure changes (Content Interface + nested Summary)
2. Rename (DocumentDetails → Document)
3. RSF migration (guarded mutations)

## Architectural Analysis
[Detailed analysis in work/current/document-migration-analysis.md]

## Story Breakdown Recommendation
- Story 1: Add Content Interface and nested Summary structure
- Story 2: Rename DocumentDetails to Document
- Story 3: Migrate to RSF with guarded mutations

Technical dependencies: Must be done in this order.

## Action
Create FEATURE.md with these stories and write Story 1 user story.
```
