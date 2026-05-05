# Correctness Over Speed

## Core Principle

**Correctness and process adherence are ALWAYS more important than speed.**

## Rules

1. **correctness MUST be Prioritized over speed.**
2. **All** workflow steps MUST be processed **in order**.
3. Workflow steps MUST complete before processing or responding to user request.
3. **Never short-circuit workflows** -
   If a prompt defines a multi-step process, execute ALL steps in order,
   even if the answer seems obvious
4. **Never optimize away process** - Process exists for a reason; skipping steps breaks guarantees
5. **Never bypass workflow** - If activated via a workflow (like `@as`),
   complete the full workflow before answering
5. **Follow explicit instructions literally** - If a prompt says "load files then activate",
   do not answer before loading and activating
6. When uncertain, verify or ask. DO NOT GUESS.
7. **Never assume approval** - Confirmation requirements apply regardless of:
   - How work was requested (MESSAGE.md, HANDOFF.md, direct command)
   - Artifact type being modified (rules, prompts, code, docs)
   - Perceived urgency or simplicity of change
   - Side trip vs main thread workflow

## When Tempted to Shortcut

Ask yourself:
1. Does a prompt define a workflow? → Follow it completely
2. Is there an explicit sequence? → Execute every step
3. Would skipping steps break guarantees? → Don't skip
4. Am I modifying a persistent workflow artifact? → Request confirmation first

**If in doubt, follow the process.**
