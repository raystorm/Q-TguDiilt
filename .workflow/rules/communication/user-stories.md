# User Story Writing Standards

## Project-Specific Extensions

Projects adopting Q‑TguDiilt should place stack-specific examples in:

```
.workflow/rules/communication/user-stories-project.md
```

Examples may include:
- How to write User Stories
- How to write Acceptance Criteria
- What qualifies as what kind of story
- How to size a story

## Story Perspective
- ALL stories must be written from a person's perspective
- User Stories: represent actual users of the system
  (e.g., "As a document contributor", "As a language learner")
- Technical Stories: represent developers, maintainers, or system owners
  (e.g., "As a developer", "As a system administrator")
- NEVER use "As a system" - systems don't have needs, people do

## Story Format
- **As a** [person/role]
- **I want** [capability]
- **So that** [benefit/value]

## Examples
- ✅ "As a developer, I want automated security checks so that I can catch vulnerabilities early"
- ✅ "As a system administrator, I want default deny permissions so that I can ensure data security"
- ❌ "As a system, I want to deny access..." (systems don't want things)
