When command `@_rename` is received then process the following large-scale rename operation patterns.

# Large-Scale Rename Operations

## Initial Reference Search

```bash
grep -r "OldName\|oldFieldName\|relatedOldName" src amplify --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" --include="*.graphql" --exclude-dir=node_modules --exclude-dir=graphql
```

**What to search:**
- Type names (e.g., "Xbiis")
- Field names (e.g., "xbiisOwnerId", "boxXbiisId")
- Related variations (e.g., "createdBoxXbiisId")
- Function names (e.g., "createXbiis", "getXbiis")

**Where to search:**
- `src/` - Frontend code
- `amplify/data/` - Backend schema and guards
- `amplify/functions/` - Lambda functions
- File types: `.ts`, `.tsx`, `.js`, `.mjs`, `.graphql`

**Exclude:**
- `node_modules/` - Dependencies
- `src/graphql/` or `amplify/functions/shared/graphql/` - Generated code

## Scope Identification

Identify affected areas:
- Backend schema files
- Backend guard files
- Frontend domain files
- Lambda functions
- Test files
- Mock data files

Report scope to user:
```
Found X references across:
- Backend: Y files
- Frontend: Z files
- Lambda functions: N files
```

## Implementation Order

1. Backend schema (triggers codegen)
2. User runs codegen
3. Backend guards and resolvers
4. Lambda functions
5. Frontend domains
6. Test files and mock data

## Verification

```bash
grep -r "OldName\|oldFieldName" src amplify --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" --include="*.graphql" --exclude-dir=node_modules --exclude-dir=graphql | wc -l
```

Expected result: 0
