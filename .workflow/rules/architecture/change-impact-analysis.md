# Change Impact Analysis & Validation Strategy

## Project-Specific Extensions

Projects adopting Q‑TguDiilt should place stack-specific examples in:

```
.workflow/rules/architecture/change-impact-analysis-project.md
```

Examples may include:
- API contract changes
- Database schema migrations
- Framework-specific validation steps
- Node/JS/CLI runner integration patterns
- Domain-specific workflows

---

## CRITICAL: Pre-Implementation Impact Analysis

**MANDATORY for:**
- Structural changes  
- Type or contract changes  
- Cross-domain or cross-module changes  
- Changes affecting 5+ files
- Changes combining multiple change types

---

## Change Classification

### Structure Changes

Modifications to the shape, structure, or contract of data, interfaces, or modules.

**Examples:**
- Adding or removing fields
- Changing nesting or hierarchy
- Introducing new interface layers
- Adding/removing/Modifying required/optional attributes
- Changing field types (string → number)

**Impact:**
- Breaks consumers expecting the old structure
- Requires updates across multiple modules
- May invalidate tests or mocks
- Data type expectations change

### Renames

Changing names of types, fields, modules, entities, or operations without changing structure.

**Examples:**
- Renaming a module
- Renaming a field
- Renaming an operation or command

**Impact:**
- References break
- Lookups fail
- Documentation becomes outdated
- Test expectations need updates

### Cross-Domain / Cross-Module Changes

Changes that affect multiple domains, modules, or global concerns.

**Examples:**
- Updating shared data structures
- Updating global utilities
- Changing system-wide conventions
- Adjusting shared workflows
- Modifying schema types used by multiple domains
- Changing authentication/authorization patterns

**Impact:**
- Multiple domains break simultaneously
- Unpredictable cascade effects
- Difficult to isolate failures
- Large manual fix burden

---

## Pre-Implementation Analysis Steps

### 1. Identify Change Type

Classify the change: type, structure, rename, cross-domain, cross-module, or combination.

### 2. Search for Usage

Identify all direct and indirect usage of the affected entity.

**For type structure changes:**
```bash
grep -r "TypeName" src/
grep -r "\.fieldName\." src/
```

**For schema changes:**
```bash
grep -r "queryName" src/
grep -r "mutationName" src/
```

### 3. Identify Affected Domains/Modules

List all domains/modules that will be affected:
- Direct usage (imports or references the type)
- Indirect usage (uses related types)
- Test files

### 4. Predict Breaking Changes

**Type structure changes:**
- Code expecting old structure, shape, or type
- Test mocks using old structure
- Utilities accessing old fields

**Renames:**
- Import statements
- File references
- Type usage / references

**Cross-domain/Cross-Module:**
- All domains/modules using the shared type
- Global utilities

### 5. Flag High-Risk Changes

**High risk indicators:**
- Affects 5+ files
- Affects multiple domains/modules
- Combines multiple change types

**Action:** Recommend phase splitting.

---

## Phase Splitting Strategy

### When to Split

Split when change is:
- High risk (5+ files, multiple domains, multiple modules)
- Combines multiple change types
- Cross-domain/module impact

### How to Split

**Principle:** One change type per phase.

---

## Validation Strategy

### Type Changes

**Before implementation:**
1. Identify all files using the type
2. List expected breaking changes
3. Create validation checklist

**After implementation:**
1. Run available static or runtime validation tools on affected files
2. Run tests for affected domains/modules
3. Manual spot-check critical paths

**Validation checklist example:**
```
□ Fields updated for new structure
□ All consumers updated
□ Test mocks updated
□ Utilities updated for new field access
□ No errors in affected files
□ All tests passing in affected domains/modules
```

### Cross-Domain/Cross-Module Changes

**Before implementation:**
1. List all affected domains/modules
2. Identify domain/module boundaries
3. Plan validation per domain/module

**After implementation:**
1. Validate each affected domain/module separately
2. Check domain/module boundaries (no unintended coupling)
3. Run full test suite (not just affected domains/modules)

**Validation per domain/module:**
```
□ Domain/Module A: types updated, tests passing
□ Domain/Module B: types updated, tests passing
□ Domain/Module C: types updated, tests passing
□ Cross-domain/Cross-module: no unintended coupling
```

### Rename Changes

**Before implementation:**
1. Search for all usages
2. List files to update
3. Verify no dynamic references (string-based lookups)

**After implementation:**
1. Verify all imports/references updated
3. Run available static or runtime validation tools (catch missed references)
4. Run full test suite

---

## Profile Integration

### Architect

- Performs pre-implementation impact analysis
- Classifies change type
- Flags high-risk changes
- Recommends phase splitting
- Hands off to Planner with analysis

### Tactician

- Receives feature/story from Planner
- Defines phase sequence
- Plans validation checkpoints
- Creates execution strategy
- Hands off to PromptEngineer with phase plan

### PromptEngineer

- Receives phase plan from Tactician
- Creates Builder prompt with:
  - Change classification
  - Predicted breaking changes
  - Validation checklist
  - Phase boundaries (if split)

### Builder

- Implements one phase at a time
- Follows validation checklist
- Reports unexpected breaks
- Hands off to Enforcer after each phase

### Enforcer

- Validates against checklist
- Checks predicted breaking changes were addressed
- Verifies no unexpected breaks
- Approves phase or escalates


