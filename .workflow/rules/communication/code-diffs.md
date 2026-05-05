# Code Diff Standards

## Project-Specific Extensions

Projects adopting Q‑TguDiilt should place stack-specific examples in:

```
.workflow/rules/communication/code-diffs-project.md
```

Examples may include:
- When to display code diffs
- How to display code diffs

---

## Change Documentation
- When describing code changes, always show a code diff
- Use proper diff format with color highlighting for additions and deletions
- Include enough context lines to understand the change
- Show file paths in diff headers

## Diff Format
- Use markdown code blocks with `diff` language identifier
- Include line numbers when helpful for context
- Group related changes together in single diff blocks
- Highlight the specific lines being modified
- Do not include + and - symbols, rely on color highlighting only

## Change Descriptions
- Explain the purpose of each change before showing the diff
- Keep explanations concise and focused on the "why"
- Show diffs for all modified files, not just summaries