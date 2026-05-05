# Profile Activation with Explicit Rule Loading

## CRITICAL: Explicit-Only Loading

This prompt loads ONLY the rules explicitly listed in the profile's "Uses:" section,
plus any files explicitly referenced by loaded files ("See X", "Reference X", "Load X", "Follow X"),
plus task-specific documentation when task keywords match.

No implicit loading. No "for reference" loading.

---

## Step 1: Extract Profile Name and Task

**From user command:**
- `@as Planner create story for user search` → Profile = "Planner", Task = "create story for user search"
- `@as Documentor write commit for current work` → Profile = "Documentor", Task = "write commit for current work"
- `@as PE` → Profile = "PromptEngineer", Task = "" (no task specified)

**Profile name normalization:**
- Case-insensitive matching
- Resolve aliases from _PROFILES.md

**Alias resolution:**
- Read _PROFILES.md
- Find profile section with matching alias in "Aliases:" line
- Use canonical profile name for loading

**Task extraction:**
- Everything after profile name is the task description
- Task description is optional
- Used for task-specific documentation loading (Step 5a)

---

## Step 2: Read Profile Definition

**Location:** `.workflow/rules/_PROFILES.md`

**CRITICAL:** `_PROFILES.md` is a reference document, NOT a rule file.
- Read it to extract profile definitions
- Do NOT load it as a rule
- Do NOT include it in active context
- Do NOT treat it as executable governance

**Extract:**
1. Find profile section (e.g., "## Planner")
2. Extract "Uses:" list
3. Parse file patterns (handle wildcards like `foundation/*`)

**Example - Planner:**
```
Uses:
  foundation/*, communication/user-stories.md, workflow/logging.md,
  workflow/auto-suspend.md, workflow/workflow-mechanics.md, profiles/planner.md
```

---

## Step 3: Expand Wildcards

**Wildcard expansion algorithm:**
1. Detect `*` in path
2. Extract directory (e.g., `foundation/`)
3. List all `.md` files in `.workflow/rules/[directory]/`
4. Add full paths to load list

---

## Step 4: Build Load List

**Combine:**
- Expanded wildcard files
- Explicit file references

**Path resolution:**
- Files in Uses list: Prepend `.workflow/rules/`
- Files from transitive references: Use path as written (allows `docs/` references)

**Example - Planner load list:**
```
.workflow/rules/foundation/general.md
.workflow/rules/foundation/minimal-code.md
.workflow/rules/foundation/terms.md
.workflow/rules/communication/user-stories.md
.workflow/rules/workflow/logging.md
.workflow/rules/workflow/auto-suspend.md
.workflow/rules/workflow/workflow-mechanics.md
.workflow/rules/profiles/planner.md
```

---

## Step 5: Load Rules Files

**Maintain loaded files tracking:**
- Keep list of already-loaded file paths
- Before loading a file, check if already loaded
- Skip if already in loaded list
- This prevents duplicate loading and circular reference loops

**Step 5.1: Load Activation-Level Rules (FIRST)**

Before loading profile-specific rules, load all activation-level rules from `.amazonq/rules/`:

1. List all `.md` files in `.amazonq/rules/`
2. Load each file (e.g., `correctness-over-speed.md`, `profile-activation.md`)
3. Add to loaded files tracking
4. These rules apply to the profile activation process itself

**Step 5.2: Load Profile-Specific Rules**

**For each file in load list:**
1. Check if file already loaded → skip if yes
2. Read file content
3. Add file path to loaded list
4. Add content to active context
5. Follow explicit cross-references ("See X", "Reference X", "Load X", "Follow X")
6. Load transitively ONLY when explicitly referenced (repeat from step 1)

**Path resolution for transitive references:**

1. **Full path (starts with `/` or `docs/`):**
   - Use as-is
   - Example: `docs/dev/commit-style-guide.md` → `docs/dev/commit-style-guide.md`

2. **Category-relative path (contains `/`):**
   - Prepend `.workflow/rules/`
   - Example: `workflow/logging.md` → `.workflow/rules/workflow/logging.md`
   - Example: `foundation/terms.md` → `.workflow/rules/foundation/terms.md`

3. **Bare filename (no `/`):**
   - Search in same directory as referencing file first
   - If not found, search all `.workflow/rules/` subdirectories
   - Example: `terms.md` from `foundation/general.md` → `.workflow/rules/foundation/terms.md`
   - Example: `logging.md` from `workflow/auto-suspend.md` → `.workflow/rules/workflow/logging.md`

**Transitive loading examples:**
- "See workflow/logging.md" → Load `.workflow/rules/workflow/logging.md`
- "Reference foundation/terms.md" → Load `.workflow/rules/foundation/terms.md`
- "Follow terms.md" (from foundation/general.md) → Load `.workflow/rules/foundation/terms.md`
- "See docs/dev/commit-style-guide.md" → Load `docs/dev/commit-style-guide.md`

**Do NOT load implicitly:**
- Mentions without directives ("workflow mechanics" without "See")
- Category wildcards (e.g., `foundation/*`) outside of Uses list
- Files not in Uses list and not explicitly referenced by loaded files

---

## Step 5a: Load Task-Specific Documentation

**After loading rules files, check task description for keywords:**

**Documentor + commit task:**
- Keywords: "commit", "commit message"
- Load: `docs/dev/commit-style-guide.md`

**Architect + architecture task:**
- Keywords: "domain", "architecture", "structure", "design"
- Load: `docs/dev/architecture/domains/domains.md`
- Load: `docs/dev/architecture/domains/frontend-domains.md`
- Load: `docs/dev/architecture/domains/backend-domains.md`
- Load: `docs/dev/architecture/domains/lambda-domains.md`

**If no keywords match:**
- Skip task-specific documentation
- Continue with rules-only context

---

## Step 6: Activate Profile

**Execute:** `Act as [ProfileName]`

**Apply:**
- Only rules from loaded files
- Profile's responsibilities and boundaries
- Profile's output format

**Do NOT:**
- Load files not in Uses list and not explicitly referenced by loaded files
- Reference rules not explicitly loaded
- Use knowledge from unloaded profiles

---

## Step 7: Activate Profile and Begin Work

**Execute:** `Act as [ProfileName]. [Task description]`

**Examples:**
- `Act as Planner. Create story for user search`
- `Act as Documentor. Write commit for current work`
- `Act as Architect. Analyze domain structure`

**If no task provided:**
- `Act as [ProfileName]` (profile activates, waits for user direction)

**CRITICAL: Before modifying any persistent workflow artifact:**
1. Classify the file (Persistent/Transient/System-Owned)
2. If Persistent: Show diff and request confirmation
3. Wait for explicit approval
4. Then execute

**Then begin profile work immediately.**

---

## Error Handling

**Profile not found:**
- List available profiles from _PROFILES.md
- Suggest correct spelling or alias

**File not found:**
- Report missing file path
- Continue with available files
- Warn user about incomplete rule set

**Wildcard expansion fails:**
- Report directory not found
- Skip that wildcard
- Continue with other files

---

## Usage Examples

```
@as Planner create story for user search
@as Documentor write commit for current work
@as Architect analyze domain structure
@as Builder implement email preferences
@as PE create prompt for Builder
@as Doctor diagnose test failure
```

---

## Notes

- This prompt is the single source of truth for rule loading
- Other prompts (start.md, receive.md, debugProfile.md) follow these instructions
- Maintains explicit-only loading guarantee
- Cross-references in loaded files are fine (single source of truth)
- Transitive loading allowed when explicit ("See X", "Reference X", "Load X", "Follow X")
- No implicit transitive loading (mentions without directives)
