# Git Management

## Automatic Git Add

When creating new **persistent workflow artifacts**,
automatically stage them with: `git add`.

(See terms: Workflow Artifact)

### Decision Criteria

**Add to git when the file is a Persistent Workflow Artifact.**  
**Do NOT add to git when the file is a Transient Workflow Artifact.**

**Do NOT add to git when file is:**
- Temporary or transient (will be deleted soon)
- Working context (workflow state, handoffs, messages)
- Generated (will be regenerated from source)
- Environment-specific (secrets, local config)
- Personal tracking (TODO lists, status tracking)

### Project Boundary Constraint

**CRITICAL:** Only `git add` files inside the project folder.

**Before running `git add`, verify:**
- File path is within workspace root
- File is NOT in global directories (`~/.aws/`, `~/`, `/tmp/`, etc.)
- File is NOT in transient folders (`.amazonq/work/`, `.amazonq/suspended/`)

### Specific Patterns

**Always add:**
- Configuration files that do not have sensitive information
- Source code: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.java`, etc.
- Tests: `.test.ts`, `.spec.ts`, test fixtures
- Configuration: `package.json`, `tsconfig.json`, `jest.config.js`
- Schemas: `.graphql`, `.sql` files
- Documentation in `docs/` directory
- Rules: `.amazonq/rules/`, `.workflow/rules/` files
- Prompts: `.amazonq/prompts/` files

**Never add:**
- Files outside project folder (`~/.aws/`, `~/`, `/tmp/`, etc.)
- Temporary files: `.tmp`, build artifacts
- Working files: `.amazonq/work/`, `.amazonq/workflow.log`, `.amazonq/suspended/`
- Generated files: `/generated`
- Secrets: `.env` files (use `.env.example` instead)
- Tracking files: Files with STATUS, TODO, or TRACKING in name
- Working directories

### File Classification

- Any Files created must immediately be classified as:
  - persistent, to be added to git
  - transient, not to be added to git
- When classification is unclear the user MUST be asked.

### Implementation

After creating a persistent file:

```bash
git add <file-path>
```

### When to Skip Git Add

- File is in `.gitignore`
- The file is a Transient Workflow Artifact
- The file is System‑Owned (see glossary Excludes)
- File is transient, temporary or working context
- File is generated (will be regenerated)
- File contains secrets or environment-specific data
- File name contains STATUS, TODO, or TRACKING
- File is in working directory
- User explicitly requests not to add

### Verification

After `git add`, profiles should confirm:
```
Added to git: <file-path>
```

If file should not be added:
```
Created <file-path> (not added to git -transient/system-owned)
```

## File Renames in Git Repositories

### Use git mv for File Renames

When renaming files in git-tracked repositories,
always use `git mv` instead of regular `mv` or filesystem operations.

**Pattern:**
```bash
git mv old-filename.ts new-filename.ts
```

**When to use:**
- Renaming Persistent Workflow Artifacts
- Renaming source files (`.ts`, `.tsx`, `.js`, `.jsx`, etc.)
- Renaming test files
- Renaming configuration files
- Renaming any git-tracked file

**When NOT to use:**
- Transient Workflow Artifacts
- System-Owned Artifacts
- Files in working directories
- Files not tracked by git (temporary files, generated files)
- Files in `.gitignore`
- Moving files between repositories

### Verification

After `git mv`, verify with:
```bash
git status
```