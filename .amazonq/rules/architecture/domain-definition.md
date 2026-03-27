# Domain Definition Rules

## Project-Specific Extensions

Projects adopting Q‑TguDiilt should place stack-specific examples in:

```
.amazonq/rules/architecture/domain-definition-project.md
```

Examples might include:
- Frontend Domains rules
- Backend API Domains rules
- Database schema domain patterns
- Domain‑specific naming or folder conventions

---

## Domain Definition

A domain is a boundary of responsibility — a grouping of related logic, data,
or behavior that changes together.

Domains help:
- isolate change
- reduce cascade effects
- structure impact analysis
- validate changes in smaller units
- maintain clear boundaries

This workflow does not prescribe any specific domain methodology.  
Projects may define domains using DDD, modular monolith patterns, microservices,
frontend/backend modules, CLI command groups, or any other boundary‑oriented structure.

---

## CRITICAL: Domain Reference Documentation

**Architect MUST check domain reference docs before making domain
changes.**

**When to check:**
- Before adding new domains
- Before modifying existing domains
- Before analyzing domain relationships
- Before making architectural decisions about domains

**Purpose:**
- Understand existing domain inventory
- Verify domain type classification
- Avoid duplicate domains
- Maintain consistency with existing patterns
- Prevent documentation drift

**Architect responsibility:**
- Check docs before domain changes
- Update docs when adding/modifying domains
- Ensure domain matches documentation

---

## CRITICAL: No Premature Abstraction

**Do not create structural abstractions until they are justified.**

If only one file or module exists, keep it at the parent level
until a second related file justifies grouping.

Premature abstraction increases:
- cognitive load
- unnecessary indirection
- maintenance cost

---

## Folder Naming Guidelines

### PascalCase = Domain Objects/Concepts (guideline)

Domain objects typically use PascalCase:

Used for:
- Core domain entities
- Stable business concepts
- Modules representing real-world objects or responsibilities

Characteristics:
- Represent real entities in the system or meaningful concepts
- Often (not always) contain domain logic
- Singular, not plural
- Change infrequently

### lowercase = Features/Flows (guideline)

Application features typically use lowercase:

Used for:
- User-facing flows
- Operational processes
- Infrastructure or utility modules

Characteristics:
- Represent user flows or infrastructure
- Contain ui, or supporting logic
- Often plural
- Change more frequently

### Special Cases

Cross-cutting concerns.
Follows the naming of the conceptual domain they represent.

**Note:** These are guidelines, not hard rules.
Use judgment based on what the folder represents.

---

## Domain Boundaries

### Infrastructure Layer

Infrastructure code (framework setup, configuration, adapters, glue code)
**CRITICAL:** No domain logic lives here.

### Domain Types Stay in Domains

Domain-specific types, schemas, or contracts **MUST** stay within the domain.
Shared or global types belong in a clearly defined shared layer.

### Domain UI Placement

**Tightly coupled UI:** Lives inside the domain.

Shared interface components belong in a shared layer.

When in doubt:
- Place code inside the domain
- Move to shared only when reused across multiple domains
