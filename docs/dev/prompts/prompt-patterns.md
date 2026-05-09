# Prompt Patterns

## New Domain

```
Act as Builder.

Create new <DomainName> domain.

Follow domain structure (Slice/Saga/Types pattern).
Match naming conventions from Author/ and Box/ domains.
Create tests alongside implementation.

Request confirmation before proceeding.
```

## Code Analysis

```
Act as Analyst.

Explain how <feature> works in <file>.

Trace the flow from user action to state update.
```

## Refactoring

```
Act as Builder.

Refactor <component> to <new pattern>.

Follow existing pattern in <example file>.
Preserve all functionality.
Show diffs and request confirmation.
```

## Documentation

```
Act as Documentor.

Write commit message for <changes>.

Follow commit-style-guide.md format.
```

## Context Commands Examples

- `@workspace Act as Architect.` (analyzing Q feature usage)
- `@folder Act as Builder.` (implementing in one domain)

## Story Context Example

"Implementing Story 2 of 3: [story title]"

## Legacy Code Handling Example

Prompts place hooks in domain folders, not `components/hooks/`
