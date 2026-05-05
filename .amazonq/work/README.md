# Q Profile Handoff System

## Overview

Coordinate work between Q profiles without copy/paste using shared context files.

---

## Handoff Workflow

**Purpose:** Transfer work between profiles in sequence with cleanup.

1. **Start work:** `@prompt start`
2. **Work with profile** (normal back-and-forth)
3. **End work:** `@prompt handoff next=NextProfile`
4. **Next profile:** `@prompt start`

### Example

**Chat 1 - Builder:**
```
You: @prompt start
Builder: [reads HANDOFF.md, acts as Builder]
[... work happens ...]
You: @prompt handoff next=Tester
Builder: [writes to HANDOFF.md, cleans up old files]
```

**Chat 2 - Tester:**
```
You: @prompt start
Tester: [reads HANDOFF.md, acts as Tester]
[... testing happens ...]
You: @prompt handoff next=Verifier
Tester: [writes to HANDOFF.md, cleans up old files]
```

**Chat 3 - Verifier:**
```
You: @prompt start
Verifier: [reads HANDOFF.md, reviews work]
Verifier: ✅ All checks pass
```

---

## Send/Receive System

**Purpose:** Quick validation without full handoff - no cleanup, no profile change.

### Workflow

1. **Send message:** `@prompt send to=ProfileName purpose="description"` or `@prompt send-epr`
2. **Open new chat:** `@prompt receive`
3. **Get feedback** in new chat
4. **Return to original chat** and continue work
5. **When done:** `@prompt handoff next=NextProfile` (cleans up MESSAGE.md)

### Example

**Chat 1 - Builder working:**
```
You: [working with Builder]
Builder: [proposes changes]
You: @prompt send-epr
Builder: [writes MESSAGE.md, shows it]
```

**Chat 2 - Get validation:**
```
You: @prompt receive
Enforcer: [reads MESSAGE.md, validates approach]
Enforcer: ✅ Approach follows all rules
```

**Back to Chat 1 - Continue:**
```
You: [based on Enforcer feedback]
Builder: [makes changes]
You: Looks good, proceed
Builder: [implements changes]
You: @prompt handoff next=Tester
Builder: [writes HANDOFF.md, cleans up MESSAGE.md and old files]
```

### Send Shortcuts

**`@prompt send-epr`** - Send to Enforcer for rule compliance review

**`@prompt send to=ProfileName purpose="description"`** - Send to any profile

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

## Profiles

- **Builder** - Implements features
- **Tester** - Writes tests
- **Verifier** - Reviews code
- **Enforcer** - Validates compliance
- **Documentor** - Writes documentation
- **Architect** - Designs systems
- **Analyst** - Explains code

See `.workflow/rules/_PROFILES.md` for full profile definitions.

---

## Setup

See `.amazonq/prompts/README.md` for prompt installation instructions.
