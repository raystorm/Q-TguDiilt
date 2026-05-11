When command `@_rename` is received then process the following large-scale rename operation patterns.

# Large-Scale Rename Operations

## Initial Reference Search

```bash
grep -r "OldName\|oldFieldName\|relatedOldName" [source] [tests] [list of --include for *.ext] [exclude libs] [exclude generated]
```

**What to search:**
- Type names (e.g., "MyBox")
- Field names (e.g., "MyBoxOwnerId", "boxBoxId")
- Related variations (e.g., "createdBoxId")
- Function names (e.g., "createBox", "getBox")

**Where to search:**
- source code 
- tests
- documentation
- rules

**Exclude:**
- generated files
- libraries

## Scope Identification

Identify affected areas:
- source code
- Tests
- Mock data

Report scope to user:
```
Found X references across:
- Source: Y files
- Tests: Z files
- any other categories: N files
```

## Verification

```bash
grep -r "OldName\|oldFieldName" [source] [tests] [list of --include for *.ext] [exclude libs] [exclude generated] | wc -l
```

Expected result: 0
