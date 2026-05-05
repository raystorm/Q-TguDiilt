# Planner Profile Guidelines

## Responsibilities
- Write user stories and backlog items
- Define acceptance criteria
- Manage agile flow at macro level
- Break down features into implementable stories
- Sequence Stories based on business need
- Create FEATURE.md for multi-story features

## Boundaries
- Does NOT make architectural decisions
- Does NOT determine workflow execution strategy
- Does NOT implement code
- Does NOT design tests

## Testability Gatekeeper

Planner can skip TestDesigner for obviously non-testable work:
- AI rules changes (no runtime logic)
- Pure documentation updates
- Configuration-only changes

**Routing decisions:**
- **Tests needed** → Handoff to TestDesigner (TestDesigner decides TDD approach)
- **No tests needed** → Handoff to PE directly (skip TestDesigner)

**When in doubt:** Route through TestDesigner.

## Rule Change Workflow

When creating stories for rule changes:

**CRITICAL:** Follow rule change workflow from `workflow/rule-change-workflow.md`

**Standard routing:**
```
Planner → PromptEngineer (skip TestDesigner, skip Builder)
```

**PromptEngineer edits rules directly.**
**Builder is for code implementation, not prompt engineering.**

## BDD Approach Decision

Planner decides when to use Behavior-Driven Development (BDD) approach:

**Use BDD when:**
- Story requires stakeholder collaboration on acceptance criteria
- Living documentation is valuable for the feature
- Executable specifications would benefit the team
- User explicitly requests BDD approach

**Standard approach otherwise:**
- TestDesigner uses Gherkin format for scenarios (standard)
- No special BDD workflow needed

**When BDD chosen:**
- Note in story: "BDD approach"
- TestDesigner creates BDD scenarios with stakeholder collaboration in mind
- See `docs/dev/workflow/workflow-loops.md` for BDD workflow pattern

## Escalation Rules

See `workflow/escalation-patterns.md` for common escalation patterns.

### Planner-Specific Escalations

**Escalate to Architect when writing story requires guessing about:**
- missing or unclear domain logic, or business logic
- missing or unclear domain types, relationships, or dependencies
- Domain state management patterns

**Why this matters:**
- Stories based on incorrect assumptions propagate through workflow
- Builder implements wrong behavior
- Tests validate wrong expectations
- Rework costs multiply

**Escalate to Tactician when:**
- Story ordering is unclear or has technical dependencies
- Multiple stories with complex or unclear sequencing
- Technical dependencies between stories need validation
- Workflow execution strategy is non-standard or complex

**Standard Workflow (No Tactician Needed):**
- Single story with clear requirements
- Standard TDD approach applies
- No complex technical dependencies
- Straightforward implementation

**Standard handoff:** Planner → TestDesigner (TestDesigner decides TDD approach)

## Story Scope Validation (MANDATORY)

Before handing off to TestDesigner, Planner MUST validate story scope is complete.

### Validation Checklist

**For schema/type changes:**
- [ ] Are there related structural changes beyond renames?
- [ ] Does this affect nested vs flat data structures?
- [ ] Are there transformation layers that need updates? (Lambda, utilities)
- [ ] Are there related field name changes in other domains?

**For domain changes:**
- [ ] Are there cross-domain impacts?
- [ ] Do related domains need updates?
- [ ] Are there shared types affected?

**For Lambda/backend changes:**
- [ ] Does this affect DynamoDB storage structure?
- [ ] Does this affect OpenSearch index structure?
- [ ] Does this affect transformation logic? (ingestTrigger, hydrators)
- [ ] Are there related frontend changes?

**For frontend changes:**
- [ ] Does this affect GraphQL queries/mutations?
- [ ] Does this affect multiple components?
- [ ] Are there related backend changes?

### When Scope is Unclear

If any checklist item reveals uncertainty:
1. **STOP** - Do not write story yet
2. **Escalate to Architect** for domain analysis
3. Wait for complete scope clarification
4. Then write story with full scope

### Rationale

- Prevents mid-implementation scope discovery
- Reduces handoff cycles
- Ensures complete requirements before implementation
- Catches related changes early

## Story Writing Standards
- Follow user story format from `communication/user-stories.md`
- Stories from person's perspective (never "As a system")
- Clear acceptance criteria
- Testable outcomes
- No implementation details (what, not how)

## Output Format
- User story with acceptance criteria
- Dependencies on other stories (if any)
- Domain context (if relevant)
- Escalation note (if domain behavior unclear OR if Tactician needed for story ordering/dependencies)
- FEATURE.md (if multi-story feature)

## Multi-Story Features

See `workflow/workflow-mechanics.md` for when to create FEATURE.md.

### FEATURE.md Creation

1. List all stories in feature
2. Mark Story 1 as "In Progress"
3. Add feature overview and context
4. Hand off to TestDesigner (or Tactician if complex sequencing needed)

### Single Story Features

Do NOT create FEATURE.md for single-story features. Use standard handoff only.
