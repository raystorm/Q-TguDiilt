# Q Profile Handoff System

## Overview

Coordinate work between Q profiles without copy/paste using shared context files.

---

## Handoff Workflow

**Purpose:** Transfer work between profiles in sequence with cleanup.

1. **Start work:** `@start`
2. **Work with profile** (normal back-and-forth)
3. **End work:** `@handoff to=NextProfile`
4. **Next profile:** `@start`

### Example

**Chat 1 - Builder:**
```
You: @start
Builder: [reads HANDOFF.md, acts as Builder]
[... work happens ...]
You: @handoff to=Enforcer
Builder: [writes to HANDOFF.md, cleans up old files]
```

**Chat 3 - Enforcer:**
```
You: @start
Enforcer: [reads HANDOFF.md, reviews work]
Enforcer: ✅ All checks pass
```

---

## Send/Receive System

**Purpose:** Quick validation without full handoff - no cleanup, no profile change.

### Workflow

1. **Send message:** `@send to=ProfileName task="description"` or `@send-epr`
2. **Open new chat:** `@receive`
3. **Get feedback** in new chat
4. **Return to original chat** and continue work
5. **When done:** `@handoff to=NextProfile` (cleans up MESSAGE.md)

### Example

**Chat 1 - Builder working:**
```
You: [working with Builder]
Builder: [proposes changes]
You: @send-epr
Builder: [writes MESSAGE.md, shows it]
```

**Chat 2 - Get validation:**
```
You: @receive
Enforcer: [reads MESSAGE.md, validates approach]
Enforcer: ✅ Approach follows all rules
```

**Back to Chat 1 - Continue:**
```
You: [based on Enforcer feedback]
Builder: [makes changes]
You: Looks good, proceed
Builder: [implements changes]
You: @handoff to=Enforcer
Builder: [writes HANDOFF.md, cleans up MESSAGE.md and old files]
```

### Send Shortcuts

**`@send-epr`** - Send to Enforcer for rule compliance review

**`@send to=ProfileName task="description"`** - Send to any profile

Common purposes:
- Validate approach
- Review changes
- Check compliance
- Verify tests
- Explain behavior

---

## Files

- `.amazonq/prompts/` - Prompt templates (version controlled)
- `.amazonq/work/FEATURE.md` - Multi-story feature tracker (gitignored, ephemeral)
- `.amazonq/work/current/HANDOFF.md` - Current story handoff (gitignored, ephemeral)
- `.amazonq/work/current/MESSAGE.md` - Quick messages between profiles (gitignored, ephemeral)
- `.amazonq/work/current/` - Current story scratch files (gitignored, ephemeral)
- `.amazonq/work/README.md` - This file (version controlled)
- `~/.aws/amazonq/prompts/` - Active prompts (user-specific)

---
