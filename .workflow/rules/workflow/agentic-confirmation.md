# Agentic Changes Confirmation

## File Classification Before Modification (MANDATORY)

Before modifying or creating ANY file, profiles MUST classify it using the same criteria from workflow/git-management.md:

- **Persistent Workflow Artifact** → Confirmation required
- **Transient Workflow Artifact** → No confirmation required  
- **System-Owned** → No confirmation required

See foundation/terms.md for Workflow Artifact definitions.

**CRITICAL: Profiles MUST output a classification block before ANY fsReplace/fsWrite call:**

```
File: [path]
Classification: [Persistent Workflow Artifact | Transient Workflow Artifact | System-Owned]
Confirmation Required: [Yes | No]
```

**This output is MANDATORY. File operations without visible classification are prohibited.**

**When classification is unclear, the user MUST be asked.**

After classification, if confirmation is required:
1. Show diff
2. Request approval
3. Wait for explicit confirmation
4. Execute

## CRITICAL: Zero-Tolerance Confirmation Policy

**ALL profiles MUST request confirmation before modifying ANY persistent workflow artifact.**

See foundation/terms.md for Workflow Artifact definition.

**No exceptions. No "small safe fixes" exemption. No "just rules" exemption.**

**Applies to:**
- Doctor (even "small safe" fixes)
- Enforcer (including rule updates)
- Builder (all code changes)
- PromptEngineer (all rule/prompt changes)
- Documentor (all documentation changes)
- ALL profiles that modify persistent workflow artifacts

## Change Approval Process
- Before making any agentic modifications to any workflow artifact, show what will be changed
- Use code diffs to clearly display proposed modifications
- Ask for explicit confirmation before modifying any workflow artifacts
- Wait for user approval before proceeding with any modifications

## Confirmation Sequence (MANDATORY)

The confirmation sequence MUST follow this exact order:

1. **Classify** - Determine if file is Persistent Workflow Artifact (requires confirmation) or Transient/System-Owned (no confirmation)
2. **Diagnose** - Identify the issue and root cause
3. **Propose** - Show the specific code changes with diffs
4. **Ask** - Request explicit confirmation
5. **Wait** - Wait for approval
6. **Execute** - Make the changes

**CRITICAL:** Always show diffs before requesting confirmation.
Asking "Should I proceed?" without showing what you'll do is a blanket approval trap.

**Approval validity:** Approval is only valid when a diff is visible.
Approval given before a diff MUST be ignored.

### Persistent Workflow Artifacts Require Confirmation

This applies to ALL types of modifications to persistent workflow artifacts, including but not limited to:
- Code modifications (adding, changing, or removing code)
- Test framework conversions (Jest → Vitest, etc.)
- File transformations (ES modules → CommonJS, etc.)
- Refactoring operations (renaming, restructuring)
- Configuration changes (package.json, tsconfig.json, etc.)
- Doctor's "small safe" fixes (even single-line changes)

### Exempt Files (No Confirmation Required)

Transient, temporary, and working files do NOT require confirmation:
- `.amazonq/work/` (all files, including HANDOFF.md, MESSAGE.md, etc.)
- `.amazonq/suspended/` (all files, including INDEX.md, context files)
- `.amazonq/workflow.log`
- Auto-suspend files (auto-*.md, auto-*.tmp)
- Any temporary or working context files

**Rule:** Persistent workflow artifacts require confirmation. Transient workflow artifacts do not.

## Confirmation Scope

**Confirmation does not persist across steps or operations.**

- Each file modification requires fresh confirmation
- Each distinct operation requires fresh confirmation
- Approval for Step 1 does NOT imply approval for Step 2
- Approval in previous message does NOT carry forward to current message

## What Counts as Explicit Confirmation
- "Yes", "Yes, proceed", "Go ahead", "Do it", "Make the changes"
- "Approved", "LGTM", "Looks good"
- "Proceed", "Continue", "Apply changes"

## What Does NOT Count as Confirmation
- Clarifying questions or acknowledging understanding ("good call", "that makes sense")
- Choosing between options ("stick with option 1")
- Asking follow-up questions
- General agreement with approach without explicit approval to execute

## Files Requiring Confirmation
- Persistent Workflow Artifacts
- All source code files
- Configuration files
- Application settings and environment files
- Build and deployment configuration files
- Any file that affects application behavior

## Confirmation Format
- Show file path and purpose of changes
- Display code diff with clear before/after comparison
- Ask: "Should I proceed with these changes?"
- Only execute changes after receiving explicit user approval

## Updating Workflow Artifact Definitions

When a versioned file requiring confirmation is not listed
in foundation/terms.md Persistent Workflow Artifacts, update the appropriate category.