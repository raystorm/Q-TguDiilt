# Prompt Engineering Rules

## Prompt Structure (Grammar)

### Required Format
```
Act as <Profile>.

<Task description in imperative form>

<Context and constraints>

<Examples from codebase when anchoring is needed>
```

### Profile Activation
- **ALWAYS** start with explicit profile activation: `Act as <Profile>`
- Use single profile per prompt for clarity
- `Act as <Profile>` is always used for maximum clarity and compatibility

### Task Description
- Write in imperative mood (command form)
- Be specific about what to create/modify/analyze
- State the goal, not the implementation steps
- Keep focused on single responsibility

### Context Commands
- Use `@workspace` to analyze project structure, patterns, or usage across the codebase
- Use `@folder` or `@file` for tasks scoped to specific files/folders

---

## Prompt Constraints

### Context Awareness
- Check if `.amazonq/work/FEATURE.md` exists
- If multi-story feature, reference current story context in prompt
- Include story number and dependencies when relevant

### Brevity
- Write complete instructions, but minimal
- Omit unnecessary context
- Don't repeat what rules already cover
- Don't specify output format unless it matters for the task

### Rule References
- Prompts activate profiles, profiles bring their rules
- Don't embed rule content in prompts
- Only restate CRITICAL rules when essential for task clarity
- Trust that profile rules are followed

### Confirmation
- Prompts must request confirmation for all persistent workflow artifact changes
- Prompt must Include: "Show diffs and request confirmation before modifying any workflow artifact"
- Or: "Request confirmation before proceeding"

---

## Builder Prompt Artifact Type

### When Creating Builder Prompts for Handoffs
- Embed prompt content in HANDOFF.md under "Builder Prompt" section
- Do NOT create saved prompt files in .amazonq/prompts/
- Handoff prompts are transient workflow artifacts, not reusable templates

### When to Create Saved Prompts
- Reusable templates that will be invoked multiple times
- Generic patterns that apply across multiple stories
- User explicitly requests a saved prompt

### Pattern
- One-time handoff → HANDOFF.md
- Reusable template → .amazonq/prompts/

---

## Drift Prevention

### Anchoring to Codebase
- Reference existing implementations when available
- Format: "Follow the pattern in `path/to/file.ts`"
- List specific examples: "Like `AuthorSlice.ts`, `BoxSlice.ts`"
- Specify what NOT to do when preventing anti-patterns

### Prohibited Behaviors
Prompts must prevent:
- Inventing new patterns not in codebase
- Ignoring existing conventions
- Adding unnecessary abstractions
- Creating folders for single files
- Editing `src/graphql/` files

### Anchoring Techniques
- "Follow existing pattern in `<file>`"
- "Match structure of `<domain>`"
- "Use same naming convention as `<example>`"
- "Don't create new patterns, use existing `<pattern>`"

---

## Architecture Rule Integration

### Domain Structure
- Prompts creating domains/modules must mention: required domain/module structure
- Reference: "Follow domain structure (pattern)"

### Testing
- All implementation prompts must include: "Create tests alongside implementation"
- Reference test data: "Use available mock data"

---

## Change Approval Process

**CRITICAL:** This profile follows the universal change approval process defined in
workflow/agentic-confirmation.md. All modifications to workflow artifacts
require the standard confirmation sequence.

## Safe Undo Pattern

**CRITICAL:** This profile follows the safe undo process in `workflow/safe-undo.md`
**Never use git commands to undo during active workflow.**
All undo operations MUST follow the process.

---

## Rules Content Guidelines

When modifying rules files:

**CRITICAL:** Follow rules content guidelines from `workflow/rules-content-guidelines.md`

**Rules contain operational instructions only.**
**Narrative text, examples, and explanations belong in documentation.**

Before adding content to rules:
- Classify as operational or explanatory
- Operational → Rules file
- Explanatory → Documentation file

## Rule Change Validation

When modifying rules files:

**CRITICAL:** Follow rule change validation from `workflow/rule-change-validation.md`

**Before committing rule changes:**
1. Check governance density (actionable rules vs token cost)
2. Scan for contradictions and overlap
3. Analyze impact (affected profiles, cascade risks)

**Run validation checklist before creating changes.**

## Rule Change Workflow

When modifying rules:

**CRITICAL:** Follow rule change workflow from `workflow/rule-change-workflow.md`

**You edit rules directly. Do NOT create Builder prompts for rules changes.**

**Standard workflow:**
```
PromptEngineer (rules) → Documentor (docs) → Enforcer → Documentor (commit)
```

---

## Output Structure

### Response Ordering (when specified)
- Explanation of approach (brief)
- Code diffs
- Confirmation request

### Verbosity Control
- Prompts should include: "Be concise"
- Or: "Minimal explanation"
- Or: "Focus on implementation"

### Format Specification
- Only specify when it matters
- Examples:
```
  "Generate commit message following commit-style-guide.md"  
  "Output as user story format"  
  "Provide as markdown documentation"
```

---

## Legacy Code Handling

### Current State vs Target State
- Prompts use target state (desired patterns)
- Don't reference deprecated patterns
- Migration of legacy code is separate task

### When Legacy Exists
- Prompt uses new pattern
- Don't mention legacy location
- Migration happens via separate migration prompt

---

## Invariants

### Always True
- Profile must be stated
- Confirmation required for file changes
- Follow minimal code principle
- Anchor to existing patterns
- Never edit generated files

### Never True
- Multiple profiles in single prompt
- Embedded rule content
- Inventing new patterns
- Unnecessary abstractions
- Verbose explanations when not needed
