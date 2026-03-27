# Testing Standards

## Test Requirements
- **MANDATORY**: Create tests for all logic changes, presentation changes, and new features
- **MANDATORY**: Tests must be created alongside the implementation, not as a separate task
- All new features require corresponding test files
- All business logic functions require unit tests

## Test Structure
- Use descriptive test names
- Follow AAA pattern (Arrange, Act, Assert)

## Testing Patterns
- Mock external dependencies properly
- Test user interactions, not implementation details

## Coverage
- Aim for meaningful test coverage
- Focus on critical business logic
- Test error scenarios and edge cases

## Test Data Standards
- **ALWAYS** use shared Mock test data when available
- Use actual IDs and structure from mock files
- Maintain consistency across all tests
- Do not create inline mock objects when mock files exist
