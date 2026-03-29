Commit Style Guide
==================

The AI workflow engine uses a structured, domain‑driven commit style designed
for clarity, traceability, and long‑term maintainability.
Commits should use plain language, be concise, expressive, and easy to skim.

---

> [!NOTE]
> Commit bodies summarize conceptual changes.
> Bullets clarify the summary, with context, without clutter.
> Bullets distill. They don't list every detail.

---

1. Summary
----------

A good commit message:

  * starts with a clear, imperative header
  * uses plain, easy-to-understand language
  * uses semantic bullets to describe what changed
  * orders bullets by importance
  * groups related changes
  * uses sub‑items when helpful
  * wraps file names and code objects in backticks (ex: `` `someObjectName` ``)
  * uses domain vocabulary
  * documents invariants when relevant

The goal is to keep the commit history clean, expressive,
and easy to follow.

> [!NOTE]
> **Markdown Formatting**
> Commit messages use Markdown formatting.
> They should be easy to read in plain text or rendered Markdown.
> They use semantics and syntax (2.1 and 2.7) that still render in Markdown.

### 1.1 Plain Language

All commit text: headers, bullets, and sub‑items,
should be written in clear, intention‑revealing plain language.
Avoid noise, meaningless jargon, and unnecessary ceremony.
Write for future maintainers.

### 1.2 Summary Prefixes

Summary Lines may include prefixes that encode additional information. 
Prefixes are separated with a `-`

```
[link] - [status] - [summary]
```

#### 1.2.1 Story/Issue Linking

When working in environments with issue tracking,
Commit summaries will often begin with the link text.
Exact format to be determined by the project and tracking/linking software.

#### 1.2.2 Status

Status prefixes indicate when work is incomplete,
or when the commit represents work in a non-standard state.

  * WIP - Work in Progress - a commit with untested or in progress changes.

---

2. Bullets
----------

The bullet system is the core of this project’s commit‑message DSL.  
Bullets communicate the *type*, *importance*, and *structure* of the change.
They make commits skimmable, predictable, and easy to reason about months or years later.

Bullets are a core component of this DSL, but they are still optional.
Bullets that repeat information without contributing clarity should be omitted.

The following subsections define:
  1. how bullets work,
  2. how they should be used,
  3. how they should be ordered,
  4. and how they should be grouped.

---

### 2.1 Bullet Meaning

Commit bodies use a semantic bullet system:

- `+` **Added**
- `*` **Changed / Updated / Improved** -
  *Note:* Can be used to clarify, or highlight, when something hasn't changed.
- `-` **Removed**

Bullets are indented by two spaces for clean Markdown rendering.

Example:

```
  + add validation rule for new entity type `myNewType`
  * updated UI behavior for disabled state
  - remove deprecated configuration flag `someDeprecatedFlag`
```

Use past‑tense or neutral phrasing in bullets.

---

### 2.2 Bullet Text

As stated in rule 1.1, each Bullet Text entry should be written in plain language.

---

### 2.3 Bullet Semantic Integrity

Bullet text for semantic bullets with meaning `+` and `-`
must clearly state that meaning in the text.

  - `+` bullets must use additive language.
  - `-` bullets must use subtractive language.

If the change cannot be written as an addition or removal using natural language,
then a `*` bullet must be used instead. 

---

### 2.4 Bullet Ordering

Bullets should be ordered by importance and impact:

  1. **Production‑meaningful changes**  
     (logic, behavior, domain rules, UI behavior, sagas, reducers, etc.)
  2. **Test changes**  
     (new tests, updated tests, reorganized tests)
  3. **Documentation changes**  
     (comments, inline docs, README updates)
  4. **Formatting or incidental changes**  
     (spacing, reorganizing imports, renames that don’t affect behavior)

This ordering keeps the most important information at the top and makes commits easier to skim.

---

### 2.5 Bullet Grouping

Group bullets by conceptual area to keep commits readable.

Typical groups include:

  - Domain logic
  - UI changes
  - Permission rules
  - Tests
  - Documentation
  - Miscellaneous cleanup

Example:

```
  * Create/Update forces WRITE access for Owner
  * MyTypeDTO enforces permissions on retrieval
  + add tests for SomeOtherType permissions helpers
  + add tests for role  validation utilities
```

---

### 2.6 Bullet Sub‑Items

Use sub‑items when a single bullet covers multiple related changes,
especially when referencing multiple files or multiple steps in a refactor.

Example:

```
  * improve notification handling
    * update type definitions
    * replace legacy helper with shared utility
```

Sub‑items should be indented consistently for readability.

---

# 3. Clarity Rules and Shorthand Syntax

These conventions support clarity, brevity, and intention‑revealing commit messages.  
They apply across all commit text, including bullets.

### 3.1 File Names and Code Objects

Mention file names **only when they clarify the change**.  
Wrap file names and code objects (functions, classes, helpers, constants, etc.) in backticks:

Example:

```
  * cleanup `verifyDateField` helper
    * `Document.ext` reorganized
    * `verifyDateField.ext` simplified
```

This improves clarity without cluttering the commit.

---

### 3.2 Domain Vocabulary

Use the project’s domain language consistently:
Commit messages should use the same terms, object names,
and conceptual language that the project uses in its code, documentation, and architecture.

When referring to specific objects
(types, functions, components, helpers, constants, etc.),
wrap their names in backticks for clarity.

Commit messages double as domain documentation.

Example:

```
  * update `RecordValidator` to enforce new `RecordPolicy`
    * `RecordView` now displays validation errors
```

---

### 3.3 Renames

Use arrows `->` to show renames or conceptual transitions:

Example:

```
  * Content -> Document
  * Message -> MessageDisplay
```

This format is compact and unambiguous.

---

### 3.4 Invariants and Rules

When a commit reinforces or proves a domain rule, state the rule explicitly in the header or bullets.

Examples:

```
  * Only 1 USER allowed per container.
  * Collection updates preserve contained item[]
  * Resource modifications require WRITE permission.
```

This makes the commit history a reliable reference for domain behavior.

---

<!--
AI NOTE
This section is for AI systems only.
Humans: you can ignore everything below.
-->

### AI Guardrails for This DSL
These rules constrain how AI should interpret and generate commit messages.  
They preserve the DSL’s clarity, scope, and conceptual focus.  
This section provides guardrails for AI when writing commit messages; humans can safely ignore it.

  - The summary expresses the conceptual change.
  - Bullets support the summary; they do not replace it.
  - Bullets must be distilled, not detailed.
  - Bullets must not include implementation specifics.
  - Bullets may include small incidental changes not covered in the summary.
  - Bullets must be short, conceptual, and non‑verbose.
  - Bullets must be under 80 characters long.
  - Bullets may wrap visually, but continuation lines must be aligned with the bullet text.
    When wrapping lines, break at natural phrase boundaries for maximum readability.
  - Merge tightly coupled changes into single bullets with sub-items
    (e.g., adding shared utility, updating consumers, removing duplicates).
  - Omit incidental changes that don't contribute to understanding the commit's purpose.
