# Auto-Suspend Examples

## File Naming Examples

- `auto-builder-story-1-wf001.md`
- `auto-enforcer-validation-wf002.md`
- `auto-architect-document-migration-wf003.md`

**Temp files during write:** `auto-[profile]-[subject]-[workflowId].tmp`

## Side Trip Example

**Main thread:**
- WorkflowId: `wf-001`
- File: `auto-builder-story-1-wf001.md`
- ParentContext: (none)

**Side trip:**
- WorkflowId: `wf-002`
- File: `auto-enforcer-validation-wf002.md`
- ParentContext: `wf-001`

### INDEX.md Representation

```markdown
## Auto-Suspend (Active)

- **auto-builder-story-1-wf001** - Builder: Implement Story 1 - 2025-01-27 22:40:00
  - **auto-enforcer-validation-wf002** - Enforcer: Validate changes (side trip) - 2025-01-27 22:45:00
- **auto-architect-document-migration-wf003** - Architect: Analyze Document domain - 2025-01-27 23:00:00
```

Indentation shows parent/child (side trip) relationships.
