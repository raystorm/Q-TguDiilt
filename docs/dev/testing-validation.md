# Test-Implementation Alignment

## Principle

Tests must validate actual implementation behavior, not assumed behavior.

## Validation Requirements

**Type alignment:**
- Test assertions reference properties implementation returns
- Test mock data matches domain type structure
- No property name mismatches

**Example violation:**
```typescript
// Implementation returns
{ update: { expressionValues: {...} } }

// Test expects (WRONG)
expect(result.attributeValues).toEqual(...)

// Test expects (CORRECT)
expect(result.update.expressionValues).toEqual(...)
```

## Responsibility Allocation

**TestDesigner (Primary):**
- Specify return type structure in scenarios
- Include expected property paths
- Ensure scenarios reference correct type contracts

**Builder (Primary):**
- Verify test assertions match implementation structure
- Run tests locally before handoff
- Self-check alignment before Enforcer validation

**Enforcer (Safety Net):**
- Validate alignment as final check
- Require test execution confirmation
- Catch what Builder missed

## Enforcer Validation

**Enforcer responsibility:**
- Require test execution before approval
- Validate test assertions match implementation structure
- Escalate to Doctor if tests fail
