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

## Generated Copies

`.workflow/skills/` is the canonical source. The installer writes one rendered
copy of each skill for each agent. It makes no symlinks, because Kiro and Copilot
write an argument differently.

| Provider | Generated copy                   |
| -------- | -------------------------------- |
| Copilot  | `.agents/skills/<name>/SKILL.md` |
| Kiro     | `.kiro/skills/<name>/SKILL.md`   |

- Never edit a copy. Edit the skill here, then run the installer.
- The installer copies the whole skill folder to a target's `.workflow/skills/`.
  A generated copy holds `SKILL.md` only, so a skill names its scripts by their
  path from the project root: `.workflow/skills/<name>/scripts/...`.
