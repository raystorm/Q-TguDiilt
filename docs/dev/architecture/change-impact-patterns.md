# Change Impact Analysis Patterns

This document provides detailed examples and patterns for change impact analysis.

For MANDATORY requirements and core specifications,
see `.workflow/rules/architecture/change-impact-analysis.md`.

---

## Change Type Examples

### Structure Changes

Changes to the shape, structure, or contract of data types or interfaces.

**Example 1: Adding nested interfaces**
```typescript
// Before
interface Document {
  title: string;
  description: string;
}

// After
interface Document {
  name: Summary;
}

interface Summary {
  title: string;
  description: string;
}
```

**Impact:**
- All code accessing `document.title` breaks
- Must change to `document.eng.title`
- Component props expecting flat structure break
- Test mocks need restructuring
- Saga response handling changes

**Example 2: Flat fields → nested objects**
```typescript
// Before
interface User {
  firstName: string;
  lastName: string;
  email: string;
}

// After
interface User {
  name: Name;
  contact: Contact;
}

interface Name {
  first: string;
  last: string;
}

interface Contact {
  email: string;
}
```

**Impact:**
- `user.firstName` → `user.name.first`
- `user.email` → `user.contact.email`
- All consumers need updates
- Form handling changes
- Validation logic changes

### Rename Examples

Changing names without changing structure.

**Example 1: Type rename**
```typescript
// Before
interface DocumentDetails { ... }

// After
interface Document { ... }
```

**Impact:**
- All imports break: `import { DocumentDetails }` → `import { Document }`
- Type annotations break: `const doc: DocumentDetails` → `const doc: Document`
- GraphQL operations may need updates
- File references in comments/docs

**Example 2: Field rename**
```typescript
// Before
interface User {
  dob: string;
}

// After
interface Box {
  dateOfBirth: string;
}
```

**Impact:**
- All field access breaks: `user.dob` → `user.dateofBirth`
- GraphQL queries need updates
- Lambda functions accessing field break
- Test expectations need updates

### Cross-Domain Change Examples

Changes affecting multiple domains.

**Example 1: Shared type change**
```typescript
// Content type used by: docs, collections, browse, Search

// Before
interface Content {
  title: string;
  description: string;
}

// After
interface Content {
  name: Summary;
}
```

**Impact:**
- All 4 domains break simultaneously
- Each domain's components need updates
- Each domain's sagas need updates
- Each domain's tests need updates
- Cascade effect across entire system

**Example 2: Global utility change**
```typescript
// Orthography converter used by: docs, Author, collections

// Before
function convertAtoB(text: string): string

// After
function convertAtoB(content: Content): Content
```

**Impact:**
- All 3 domains break
- Call sites need restructuring
- May need data transformation before calling
- Tests for all 3 domains need updates

---

## Impact Analysis Patterns

### Pattern 1: Grep for Direct Usage

```bash
# Find all direct references
grep -r "TypeName" src/ --include="*.ts" --include="*.tsx"

# Find field access
grep -r "\.fieldName" src/ --include="*.ts" --include="*.tsx"

# Find GraphQL operations
grep -r "queryName\|mutationName" src/ --include="*.ts" --include="*.tsx"
```

### Pattern 2: Identify Affected Domains

```bash
# Group results by domain
grep -r "TypeName" src/ --include="*.ts" | cut -d'/' -f2 | sort | uniq

# Example output:
# Author
# Box
# collections
# docs
```

### Pattern 3: Predict Breaking Changes

**For structure changes:**
1. Find all component props using type
2. Find all saga response handlers
3. Find all test mocks
4. Find all utility functions accessing fields

**For renames:**
1. Find all imports
2. Find all type annotations
3. Find all GraphQL operation names
4. Find all file references

**For cross-domain:**
1. List all domains using shared type
2. Identify domain boundaries
3. Map cascade effects

---

## Profile Integration Workflow

### Architect → Tactician → PromptEngineer → Builder → Enforcer

**Architect:**
- Performs impact analysis
- Classifies change type
- Flags high-risk changes
- Recommends phase splitting
- Creates analysis document

**Tactician:**
- Receives impact analysis
- Defines phase sequence
- Plans validation checkpoints
- Creates execution strategy

**PromptEngineer:**
- Receives phase plan
- Creates Builder prompt with:
  - Change classification
  - Predicted breaking changes
  - Validation checklist
  - Phase boundaries

**Builder:**
- Implements one phase at a time
- Follows validation checklist
- Reports unexpected breaks

**Enforcer:**
- Validates against checklist
- Checks predicted breaks addressed
- Verifies no unexpected breaks

---

## Complete Example Workflow

### User Request
"Migrate Document to use Content Interface"

### Step 1: Architect Analysis

**Change type:** Type structure change + rename (combined)

**Affected domains:**
- docs (direct usage)
- collections (direct usage)
- browse (direct usage)
- Search (indirect usage via queries)

**Predicted breaks:**
- 50+ files affected
- DocumentsTable component (expects flat structure)
- ContentGrid component (expects flat structure)
- documentSaga (response handling)
- collectionSaga (response handling)
- browseSaga (response handling)
- All test files with Document mocks

**Risk:** HIGH - recommend splitting into 3 phases

### Step 2: Architect Recommendation

**Phase 1: Content Interface + nested Summary**
- Add Content Interface to Document
- Implement nested Summary structure
- Update frontend to use nested fields
- Tests alongside changes
- Validate + Commit

**Phase 2: DocumentDetails → Document rename**
- Rename type
- Update imports and references
- Update GraphQL operation names
- Tests alongside changes
- Validate + Commit

**Phase 3: RSF migration**
- Switch to guarded mutations
- Update saga patterns
- Tests alongside changes
- Validate + Commit

### Step 3: Tactician Sequencing

**Phase 1 workflow:**
- Architect → PE → Builder → Enforcer → Documentor

**Phase 2 workflow:**
- PE → Builder → Enforcer → Documentor

**Phase 3 workflow:**
- PE → Builder → Enforcer → Documentor

### Step 4: PE Creates Builder Prompt (Phase 1)

```
Act as Builder.

Implement Content Interface + nested Summary structure for Document.

Validation checklist:
□ Component props updated for new structure
□ Saga response handling updated
□ Test mocks restructured
□ Utilities updated for new field access

Predicted breaks:
- DocumentsTable (expects document.title)
- ContentGrid (expects document.description)
- documentSaga (response handling)

Show diffs and request confirmation.
```

### Step 5: Builder Implementation

- Updates Document type with nested Summary
- Updates DocumentsTable: `document.title` → `document.eng.title`
- Updates ContentGrid: `document.description` → `document.eng.description`
- Updates documentSaga response handling
- Updates test mocks to nested structure
- Reports: "All checklist items addressed"

### Step 6: Enforcer Validation

- Checks validation checklist
- Runs TypeScript compiler (no errors)
- Runs tests (all passing)
- Approves Phase 1

### Step 7: Documentor Commits Phase 1

```
Add Content Interface with nested Summary to Document

  * Document type now uses nested Summary structure (eng/bc/ak)
  * DocumentsTable updated for nested field access
  * ContentGrid updated for nested field access
  * documentSaga response handling updated
  * test mocks restructured to nested Summary
```

### Step 8: Repeat for Phase 2 and Phase 3

Each phase follows same workflow:
- PE creates prompt
- Builder implements
- Enforcer validates
- Documentor commits

---

## Benefits of Phased Approach

**Each phase is validatable:**
- Can run tests after each phase
- Can verify TypeScript compilation
- Can spot-check critical paths

**Smaller fixes if something breaks:**
- Only need to fix current phase
- Don't have to untangle multiple change types
- Clear rollback point

**Can stop/adjust between phases:**
- User can review after each phase
- Can adjust approach based on learnings
- Can pause if issues discovered

**Reduces manual fix burden:**
- Smaller scope per phase
- Easier to reason about changes
- Less cognitive load

## Example: Document Migration

**❌ Too large:**
- Content Interface + Summary + DocumentDetails → Document + RSF migration (all at once)

**✅ Split into phases:**

**Phase 1: Type Structure Change**
- Add Content Interface to Document
- Implement nested Summary structure
- Update frontend to use nested fields
- Tests alongside changes
- Validate + Commit

**Phase 2: Rename**
- DocumentDetails → Document
- Update imports and references
- Update GraphQL operation names
- Tests alongside changes
- Validate + Commit

**Phase 3: RSF Migration**
- Switch to guarded mutations
- Update saga patterns
- Tests alongside changes
- Validate + Commit

**Benefits:**
- Each phase is validatable
- Smaller fixes if something breaks
- Can stop/adjust between phases
- Reduces manual fix burden
