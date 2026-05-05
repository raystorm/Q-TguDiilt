# Generated Code Rules

## CRITICAL: Never Edit Generated Files

## Project-Specific Extensions

Projects adopting Q‑TguDiilt should place stack-specific examples in:

```
.workflow/rules/architecture/generated-code-project.md
```

**The actual generated code location**

Examples might include:
- Generated folders
- rules for working with generated code
- rule for updating generated code
- scratch folders and working directories to ignore
- archived folders to ignore

### Default Generated Code Directory (Example)

Location: `/generated`

**These files are:**
- Auto-generated
- Overwritten regularly
- **NEVER manually edited**

## Read-Only Folders

### `build` — Read-Only

**CRITICAL:** Do not manually edit any files in `build`.

If you find yourself needing to edit these files, you're doing it wrong.
Update the source code instead.

### `archive/` — Archived

Legacy folder archived for reference.

**Do not modify.** All new work will be somewhere else
