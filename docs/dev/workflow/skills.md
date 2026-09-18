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

Skills are invoked by the ACP Wrapper during automated workflow execution,
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

## Symlink Targets

Skills are shared across providers via symlinks. The installer (A5) creates
these symlinks — they are documented here for reference only.

| Provider | Symlink Target    |
| -------- | ----------------- |
| Copilot  | `.agents/skills/` |
| Kiro     | `.kiro/skills/`   |

`.workflow/skills/` is the canonical source. Provider directories symlink
to it, so a single skill definition works across all supported
environments.

---

## Reference

- `.workflow/skills/README.md` — skills directory structure document
- `docs/dev/workflow/workflow-commands.md` — workflow commands reference
- `.workflow/rules/workflow/workflow-mechanics.md` — MANDATORY mechanics
