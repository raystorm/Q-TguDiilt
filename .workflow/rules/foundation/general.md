# General Code Quality Standards

## Project-Specific Extensions

Projects adopting Q‑TguDiilt should place stack-specific examples in:

```
.workflow/rules/foundation/general-project.md
```

Examples may include:
- any general rule for the AI to follow when working on the project

---

## Rule Precedence and Overrides

Universal rule files define the baseline behavior for all projects using Q‑TguDiilt.
Project‑specific rule files (*-project.md) may **override, refine, or supersede** universal rules,
but only when the override is **explicitly stated** in the project file.

Overrides MUST use the marker: `Override:` or `**Override:**`

If a project file does not explicitly override a universal rule,
the universal rule remains in full effect.

This ensures:
  * consistent baseline behavior across all projects
  * intentional, documented deviations 
  * no accidental contradictions
  * clear governance lineage

### Example of an Explicit Override

```
Universal Rule: "Profile switches require explicit commands:"

Project Override (in general-project.md):
**Override:**
Profiles may also be switched with:
  - "Become [Profile]"
  - "Identify as [Profile]"
```

---

## Profile Stability
- **Profiles never auto activate from a no-profile state.
    Activation MUST be from user command.**
- Once a profile is activated, stay in that profile until explicitly told to switch
- **Profiles NEVER auto-switch to another profile**
- **Profiles ONLY changeover work, they do not activate the next profile**
- Profile activations require explicit commands:
  - "Act as [Profile]"
  - "As [Profile]"
  - "Switch to [Profile]"
  - "@begin" (reads changeover file)
- Mentioning another profile in conversation does NOT trigger a switch
- Discussing work for another profile does NOT trigger a switch
- Preparing handoffs or messages for other profiles does NOT trigger a switch

see: terms.md for full changeover definition

## PROFILE Activation
- When a Profile is activated it MUST process `@hello`
- When a Profile is activated it MUST display:
  'CANARY: Profile activation block executed.'

## Profile Activation Sequence

When a profile activates (via @as, @start, or @receive), it MUST complete these steps IN ORDER before beginning any task work:

1. **Output Context Status block** (if activated from changeover)
2. **Output CANARY message**
3. **Apply loaded rules** (all governance active before task execution)
4. **Then begin task work** (following all loaded rules including confirmation sequence)

This applies even when task is provided during activation command.

## Profile Internalization (MANDATORY)

After profile activation (Context Status + CANARY), profile MUST check user request against boundaries:

- **Request fits profile role** → Proceed with work
- **Request requires different profile** → Output the in-scope work profile will do instead, then proceed
- **Request is unclear** → Ask user for clarification

This prevents auto-switching to other profile behaviors.

## Profile Routing Rules
- **work for Builder MUST route through PromptEngineer first**
- Any profile that needs Builder implementation must changeover to PE, not Builder directly
- PE creates the Builder prompt, then hands off to Builder
- **Exception: Builder can handoff to Builder for multi-phase work when splitting development and testing**
  - Example: TDD workflow (Phase 1: tests, Phase 2: implementation)
  - Both phases are implementation work, no new prompt needed
- This ensures prompt quality, prevents drift, and maintains consistency

## Profile scoping
Profiles do not perform out‑of‑domain work,
but must still complete their own responsibilities
and communicate via standard workflow mechanics.
When a request is outside a profile’s domain but within its worldview,
the profile must reinterpret the request into its own domain and produce its defined outputs.

## Batching File Operations

### Batch Multiple Files in Single fsRead Call

When reading multiple files for read-only inspection, batch them into single fsRead calls to reduce user confirmation clicks.

**Pattern:**

❌ **Don't do this (one file at a time):**
```typescript
fsRead({paths: ["/path/to/file1.ts"]})  // Click 1
fsRead({paths: ["/path/to/file2.ts"]})  // Click 2
fsRead({paths: ["/path/to/file3.ts"]})  // Click 3
// ... 100 more files = 100 more clicks
```

✅ **Do this (batch multiple files):**
```typescript
fsRead({paths: [
  "/path/to/file1.ts",
  "/path/to/file2.ts",
  "/path/to/file3.ts",
  "/path/to/file4.ts",
  "/path/to/file5.ts",
  // ... up to 10-20 files per batch
]})  // Single click for all files
```

**Batch Size Guidelines:**
- **10-20 files per batch** for read-only inspection
- Smaller batches if files are very large (>50KB each)
- Larger batches acceptable for small files (<10KB each)
- Balance between efficiency and avoiding timeout/memory issues

**When to Batch:**
- Reading multiple files to check for references
- Reading multiple files to verify patterns
- Reading multiple test files
- Reading multiple domain files
- Any read-only operation across multiple files

**When NOT to Batch:**
- Writing/modifying files (use appropriate write tools)
- Files are unrelated and may not all be needed
- Single file operations

## Information Classification and Retrieval

### Classification

Before stating, using, or writing any factual information, classify the information type:

**State** - Information that changes over time or varies by context
- Current date/time
- File contents
- Directory structure
- Git status
- Environment variables
- Running processes
- System configuration
- Project-specific data

**Knowledge** - Information that is stable and universal
- Programming language syntax
- AWS service capabilities
- Standard algorithms
- Best practices
- Technical concepts
- Tool documentation

### Classification Criteria

**Treat as State if:**
- Answer changes based on when/where you ask
- Specific to this system/project/user
- Verifiable through system query
- Could be different tomorrow or on another machine

**Treat as Knowledge if:**
- Answer is the same regardless of context
- Universal across systems/projects
- Part of established standards/documentation
- Stable over time

### Retrieval Strategy

**For State:**
- Use tools to query current state (executeBash, fsRead, listDirectory, fileSearch)
- Never guess or infer from outdated data
- Verify before using
- **If tool exists but access restricted:**
  - Provide command for user to run
  - Explain why direct access isn't available
  - Wait for user to provide output
  - Examples: AWS CLI commands, database queries, sudo commands, git remote operations
- **If no tool available:**
  - Acknowledge limitation: "I don't have access to [information]"
  - Ask user to provide: "What [information] should I use?"
  - Suggest where user can find it
  - Never guess or assume

**For Knowledge:**
- Use existing knowledge base
- Acknowledge uncertainty for rapidly changing domains
- Suggest verification for critical decisions

**When Uncertain:**
- Default to treating as State (query it)
- Better to over-verify than to assume
- Ask user for clarification if classification is ambiguous

## Code Organization
- Follow existing directory structure
- Group related files in feature directories
- Use consistent file naming conventions
- Keep components focused and single-purpose

## Pattern Application
- Patterns must be earned, not applied by default
- Partial pattern implementation is acceptable when full pattern isn't justified
- Apply patterns only when they solve actual problems
- Don't add pattern infrastructure "just in case" or for consistency alone
- Examples:
  - Don't add an error field if errors are handled elsewhere
  - Don't create abstractions until second use case appears

## Naming Conventions
- Follow existing patterns in the codebase
- When adding new features, match the naming style of similar existing features

## Rule File Organization
- Add new rules to existing rule files when they fit the same category
- Only create new rule files when the rule doesn't fit any existing category
- Check existing rule files before creating new ones

## Saved Prompts
- Saved prompts MUST be created AND updated in BOTH locations:
  - `~/.aws/amazonq/prompts/` - Global user prompts (for immediate use)
  - `.amazonq/prompts/` - Project prompts (for version control and team sharing)

## Error Handling
- Use proper error boundaries for React components
- Handle async errors in sagas
- Provide meaningful error messages
- Log errors appropriately for debugging

## Performance
- Use React.memo for expensive components
- Implement proper loading states
- Optimize re-renders with useCallback/useMemo
- Follow existing patterns for data fetching

## Documentation
- Use Document comments for complex functions
- Keep comments focused on "why" not "what"
- Update README when adding new features
- Document API changes and breaking changes
- **Line length**: Use natural line breaks, wrap lines between 80-100
  characters for readability in text editors and version control
  - Apply to: documentation, commit messages, user stories, architecture
    documents, rule files, handoff files, message files, suspend contexts
  - Exceptions: code files (follow tech/formatting.md), log files
    (workflow.log JSONL), generated files, JSON/YAML config files

## Workflow Step Communication

Don't describe next steps until current step is complete.

Wait for user to trigger the next step, don't pre-explain it.

## Workflow Logging

Profiles that reference `workflow/logging.md` MUST follow its MANDATORY logging requirements.

## Documentation Reference Dependencies

- Rules files MUST NOT contain `docs/` references that load, see, or reference content
- Documentation reference files are for human reference only
- Operational content belongs in rules files or saved prompts
- Examples belong in docs files, not rules files (unless absolutely necessary)
- **Exception:** Architecture rules MAY reference `docs/` for anchoring to existing patterns
- **Exception:** `docs/dev/commit-style-guide.md` is written to be referencable