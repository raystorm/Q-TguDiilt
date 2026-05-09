# Domain Reference Guide

## What is a Domain?

A **domain** represents a distinct area of business logic, data,
and behavior in the application.
Domains are first-class architectural units that encapsulate related functionality
and provide clear boundaries for organization.

---

## Domain Principles

### Domain Boundaries
Each domain owns its data, logic, and rules.
Domains should depend on as few other domains as possible.

### Group Existence
Groups exist only when they earn their existence.
No premature abstraction or unnecessary hierarchy.

### Consistent Structure
All domains of the same type follow consistent structural patterns for predictability and maintainability.

---

## Domain Types
Applications can have multiple Domain Types.

---

## Current Domains
Applications should document known domains and their type.

---

## Domain Interactions
Domains do not exist in complete isolation.

### Cross-Domain Relationships
Known interactions and relationships should be documented.

### Domain Dependencies
When a domain depends on another domain document it.

**High-level domains depend on low-level domains:**
```
Search -> Content or Item Type -> User
```

---

## Domain Naming Conventions

### PascalCase = Domain Objects
Domain objects representing business entities use PascalCase.

### lowercase = Features/Flows
Application features and workflows use lowercase.

### camelCase = Functional Domains
Functional types use camelCase.

### Special Cases
Global UI or cross-cutting concerns may use PascalCase.

---

## Adding a New Domain

### Entity Domain Checklist
If there are specific steps to create a new domain, document them.

Suggested Universal list: 
1. **Create Group/Container** 
2. **Create Types**
3. **Create Logic**
4. **Create tests** for all logic
5. **Update documentation**

---

## Domain Anti-Patterns

### ❌ Don't Create Premature Abstractions
Don't create groups for single entities or add patterns until second use case appears.

### ❌ Don't Mix Domain Logic with UI Infrastructure
Keep domain logic in domain layer, UI infrastructure in UI Layer.

### ❌ Don't Edit Generated Files
Never edit `/generated/` files. Update proper location(s) regenerate instead.

---

## Domain Best Practices

### ✅ Clear Domain Boundaries
Each domain owns its data, logic, and rules.

### ✅ Minimal Dependencies
Domains should depend on as few other domains as possible.

### ✅ Test Coverage
All domain logic requires tests.

### ✅ Consistent Naming
Follow naming conventions for predictability.

### ✅ Domain Hooks in Domain Groups
Keep domain-specific hooks with their domains.

---

## Summary

**Domains are the primary organizational unit.**

All domains follow consistent structure rules and maintain clear boundaries.
Domains encapsulate all related logic, state, and behavior.

---
