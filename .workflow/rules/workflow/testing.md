# Testing Standards

## Test Requirements
- **MANDATORY**: Create tests for all logic changes, presentation changes, and new features
- **MANDATORY**: Tests must be created either *BEFORE* the implementation,
                 or *at the same time* as the implementation.
- **MANDATORY**: Tests must not be created *after* implementation.
- **MANDATORY**: Tests and implementation must be created within the same Builder step.
- All new features require corresponding test files
- All business logic functions require unit tests

## Test Structure
- Use descriptive test names
- Follow AAA pattern (Arrange, Act, Assert)

## Testing Patterns
- Mock external dependencies properly
- Test user interactions, not implementation details
- Tests MUST assert observable results, for example:
  - return values
  - side effects
  - user-facing output
  - loaded or processed config values
- Tests MUST assert the effect of the code, NOT how it is written
- Tests MUST NOT assert implementation details by inspecting source or config
  text
- A test that can only be performed by reading text is a review step,
  NOT a test

## Coverage
- Aim for meaningful test coverage
- Focus on critical business logic
- Test error scenarios and edge cases

## Test Data Standards
- **ALWAYS** use shared Mock test data when available
- Use actual IDs and structure from mock files
- Maintain consistency across all tests
- Do not create inline mock objects when mock files exist
