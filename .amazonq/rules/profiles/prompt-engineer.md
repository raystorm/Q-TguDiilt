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
- Examples:
  - `@workspace Act as Architect.` (analyzing Q feature usage)
  - `@folder Act as Builder.` (implementing in one domain)

---

## Prompt Constraints

### Context Awareness
- Check if `.amazonq/work/FEATURE.md` exists
- If multi-story feature, reference current story context in prompt
- Include story number and dependencies when relevant
- Example: "Implementing Story 2 of 3: [story title]"

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
- All file changes require confirmation
- Prompt must request: "Show diffs and ask for confirmation before modifying any workflow artifact"
- Or: "Request confirmation before proceeding"

---

## Drift Prevention

### Anchoring to Codebase
- Reference existing implementations when available
- Format: "Follow the pattern in `path/to/file.ts`"
- List specific examples
- Specify what NOT to do when preventing anti-patterns

### Prohibited Behaviors
Prompts must prevent:
- Inventing new patterns not in codebase
- Ignoring existing conventions
- Adding unnecessary abstractions
- Creating folders for single files
- Editing generated, read-only, archived files or folders

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

## Confirmation Requirements

### When Required
- Any file modification
- Any file creation
- Schema changes
- Refactoring

### Format
- "Show code diffs before modifying any workflow artifact"
- "Request confirmation before proceeding"
- "Ask for approval after showing proposed changes"

### Diff Display
- Use diff format with color highlighting
- Show file paths
- Include context lines
- No + and - symbols, rely on color

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

## Prompt Patterns

### New Domain
```
Act as Builder.

Create new <DomainName> domain.

Follow domain structure (pattern).
Match naming conventions from <names here> domains/modules.
Create tests alongside implementation.

Request confirmation before proceeding.
```

### Code Analysis
```
Act as Analyst.

Explain how <feature> works in <file>.

Trace the flow from user action to state update.
```

### Refactoring
```
Act as Builder.

Refactor <component> to <new pattern>.

Follow existing pattern in <example file>.
Preserve all functionality.
Show diffs and request confirmation.
```

### Documentation
```
Act as Documentor.

Write commit message for <changes>.

Follow commit-style-guide.md format.
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
