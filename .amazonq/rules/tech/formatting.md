# Code Formatting Standards

## Project-Specific Extensions

Projects adopting Q‑TguDiilt should place stack-specific examples in:

```
.amazonq/rules/tech/formatting-project.md
```

Examples may include:
- Tabs vs spaces
- how much to indent
- linter rules

---

## Critical Rule for Modifications
- When making code changes, ONLY format the lines being modified
- DO NOT reformat surrounding code, even if indentation differs
- Preserve existing whitespace, indentation, and formatting in unchanged sections
- Match the exact formatting of the code being replaced in oldStr

### Why This Matters
- Prevents unintended changes to working code
- Makes diffs cleaner and easier to review
- Avoids breaking tests due to whitespace changes
- Respects the existing codebase style

## File Modification
- When adding new code to an existing file, do not reformat the rest of the file
- Only format the new code you are adding
- Preserve existing formatting, spacing, and style in unchanged sections

## Indentation & Spacing
- Use 3 spaces for indentation (no tabs)
- Add space after `if`, `for`, `while` keywords
- Use spaces around operators: `a + b`, `x === y`
- No trailing whitespace on lines

## Comparison Operators
- Place constant values on the left side of comparisons: `0 === length`, `null !== value`
- This prevents accidental assignment and improves readability

## Braces & Brackets
- Keep lines under 80 characters when possible
- If entire statement to closing `}` fits in 80-120 chars: keep on one line
- If it doesn't fit: move opening `{` to next line
- If single statement + `}` fits in 80-120 chars (including indent): keep on one line
- Otherwise: `{` and `}` get their own lines with normal indentation
- Use braces even for single-line if statements

## Semicolons & Quotes
- Always use semicolons to end statements
- Use single quotes for strings (existing pattern)
- Use double quotes only for JSX attributes

## Function Formatting
- Arrow functions: `const func = () => {}`
- Function declarations: `function name() {}`
- Multi-line parameters: align parameters or use one per line
- Keep simple methods in one line when possible

## Object & Array Formatting
- Trailing commas in multi-line objects and arrays
- Consistent spacing in object literals: `{ key: value }`
- Break long arrays/objects across multiple lines
- Align multiline array initializers

## Column Alignment
- Align colons in object literals when multiple properties are defined
- Align assignment operators when declaring multiple related variables
- This improves visual scanning and readability
- Property order: `__typename` first, then `id`, then other fields
- Example object alignment:
  ```typescript
  const user = {
     __typename: 'User',
     id:         '123',
     name:       'John',
     email:      'john@example.com',
     createdAt:  '2023-01-01',
  };
  ```
- Example variable alignment:
  ```typescript
  const firstName = 'John';
  const lastName  = 'Doe';
  const email     = 'john@example.com';
  ```

## Line Wrapping
- Soft margins at 80, 100, 120 characters
- Wrap when typing reaches right margin
- Chop down if long: parameters, method calls, binary operations
- Align multiline chained methods, parameters, and operations
- Place operators on next line for wrapped expressions