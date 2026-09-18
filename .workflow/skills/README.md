# Skills Directory

This directory contains ACP skills for the workflow engine.
Skills are provider-neutral, callable units that encapsulate workflow
operations for invocation by ACP-compatible AI environments.

---

## Purpose

Skills replace Q-specific command workarounds with callable, referenceable
primitives that work across supported AI environments (Copilot, Kiro, and
future providers).

---

## Skill File Layout

Each skill lives in its own subdirectory:

```
.workflow/skills/
└── skill-name/
    └── SKILL.md    # skill metadata and instructions
```

---

## Naming Conventions

- Directory name: lowercase, hyphen-separated (e.g., `list-commands`)
- No provider-specific names in the skeleton
- Names must be meaningful and action-oriented

---

## Symlink Targets

Skills are shared across providers via symlinks managed by the installer
(A5). The installer creates these symlinks — do not create them manually.

| Provider | Symlink Target    |
| -------- | ----------------- |
| Copilot  | `.agents/skills/` |
| Kiro     | `.kiro/skills/`   |

The `.workflow/skills/` directory is the canonical source.
Provider directories are symlinked to it.
