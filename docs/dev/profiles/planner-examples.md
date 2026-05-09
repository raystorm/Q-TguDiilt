# Planner Examples

## Example: Incomplete Scope

**❌ Incomplete:**
```
Story: Update Lambda field names
- documentAuthorId (was documentDetailsAuthorId)
- documentContentOwnerUserId (was documentDetailsDocOwnerId)
- documentBoxBoxId (was documentDetailsBoxId)
```

**Missing:** Summary structure migration (DynamoDB nested, OpenSearch flat)

**✅ Complete:**
```
Story: Align Lambda functions with Document schema
- Update field names (documentAuthorId, documentContentOwnerUserId, documentBoxBoxId)
- Migrate Summary structure (read nested from DynamoDB, flatten for OpenSearch)
- Update test data to nested Summary structure
```
