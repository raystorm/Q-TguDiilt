# File Operations Rationale

## Batching File Operations

### Why Batch Multiple Files

Batching multiple files into single fsRead calls reduces user confirmation clicks.

**Why:**
- fsRead requires user confirmation per call
- Reading files one at a time = one confirmation per file
- Batching 10-20 files per call = 10-20x fewer confirmations
- Significantly improves user experience for large-scale operations

**Result:** 3 confirmations instead of 30+ for large-scale operations.

## Git File Renames

### Why Use git mv

Using `git mv` instead of regular `mv` preserves git history.

**Why:**
- Preserves git history and file lineage
- Git tracks the rename operation explicitly
- Enables `git log --follow` to trace file history across renames
- Prevents git from treating rename as delete + add

### Example: Large-Scale Rename

When checking references across many files:

```typescript
// Batch 1: Backend schema files
fsRead({paths: [
  "/amplify/data/Box/Box.graphql",
  "/amplify/data/BoxRequest/BoxRequest.graphql",
  "/amplify/data/Collection/Collection.graphql",
  "/amplify/data/Content.graphql",
  // ... more schema files
]})

// Batch 2: Backend guard files
fsRead({paths: [
  "/amplify/data/Box/createBoxGuarded.js",
  "/amplify/data/Box/updateBoxGuarded.js",
  "/amplify/data/BoxRequest/createBoxRequestGuarded.js",
  // ... more guard files
]})

// Batch 3: Frontend domain files
fsRead({paths: [
  "/src/Box/boxTypes.ts",
  "/src/Box/boxSlice.ts",
  "/src/Box/boxSaga.ts",
  // ... more domain files
]})
```

**Result:** 3 confirmations instead of 30+

## Git File Examples

### Git Add Examples

**Single file additions:**
```bash
# Created new domain file
git add src/NewDomain/NewDomainSlice.ts

# Created new rule file
git add .workflow/rules/workflow/new-rule.md

# Created new test
git add src/NewDomain/__tests__/NewDomain.test.ts
```

### Git Rename Examples

**Single file rename:**
```bash
git mv old-filename.ts new-filename.ts
```

**Multiple file renames:**
```bash
git mv src/Box/createXbiisGuarded.js src/Box/createBoxGuarded.js
git mv src/Box/updateXbiisGuarded.js src/Box/updateBoxGuarded.js
```

**Verification:**
```bash
git status
```

Should show:
```
renamed: old-filename.ts -> new-filename.ts
```

Not:
```
deleted: old-filename.ts
new file: new-filename.ts
```
