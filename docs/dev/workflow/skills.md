# Skills Reference

Complete reference for skills in the AI Workflow System.

For workflow commands, see `docs/dev/workflow/workflow-commands.md`.

---

## What Is a Skill?

A skill is a provider-neutral, callable unit that encapsulates a workflow
operation. Skills are the canonical primitive for workflow actions that
must be invocable across AI environments (Copilot, Kiro, and future
providers).

Skills replace Q-specific command workarounds. Where Q uses saved prompts
and `@command` syntax, skills use a standard ACP invocation pattern
compatible with multiple providers.

---

## How Skills Relate to the Workflow

Skills are invoked by the ACP Protocol layer during automated workflow execution,
and can also be invoked directly in AI environments that support ACP skill
invocation.

The workflow engine uses skills for:
- Changeover mechanics (`@start`, `@receive`, `@handoff`, `@send`)
- Profile activation (`@as`)
- Workflow commands (listing commands, etc.)

---

## Skill Structure

Each skill lives in its own subdirectory under `.workflow/skills/`:

```
.workflow/skills/
└── skill-name/
    └── SKILL.md    # skill metadata and instructions
```

### Naming Conventions

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

- Never edit a copy. Edit the skill, then run the installer.
- The installer copies the whole skill folder to a target's `.workflow/skills/`.
  A generated copy holds `SKILL.md` only, so a skill names its scripts by their
  path from the project root: `.workflow/skills/<name>/scripts/...`.
- `docs/user/installer.md` describes the installer's options and output.

---

## Reference

- `.workflow/skills/README.md` — skills directory structure document
- `docs/dev/workflow/workflow-commands.md` — workflow commands reference
- `.workflow/rules/workflow/workflow-mechanics.md` — MANDATORY mechanics
