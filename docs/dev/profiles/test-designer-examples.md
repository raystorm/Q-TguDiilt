# TestDesigner Examples

## Example: Schema-Only Changes

**FilterInput additions:**
```gherkin
Scenario: Construct filter with new field
  Given new FilterInput field exists in schema
  When TypeScript types are regenerated
  Then filter object can be constructed with new field
  And TypeScript accepts the filter structure
  And filter properties are accessible with type safety
```

**Type additions:**
```gherkin
Scenario: Use new type in component
  Given new type exists in schema
  When TypeScript types are regenerated
  Then component can import and use new type
  And TypeScript validates type structure
  And type properties are accessible
```
