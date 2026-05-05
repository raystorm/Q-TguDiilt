# Safe Undo Pattern

## When to Use

When profile needs to undo changes during active workflow:
- Made changes without confirmation (violation)
- Made incorrect changes (user correction)
- Need to reverse changes and try again

## CRITICAL: Never Use Git Commands During Active Workflow

**NEVER use during active workflow:**
- `git restore`
- `git revert`
- `git reset`
- `git checkout`
- Any git command that modifies working directory

**Why:**
- Active workflow often has uncommitted changes in multiple files
- Git commands can lose uncommitted work
- Retrospective improvements, side trip artifacts, work-in-progress all at risk

**Exception:**
- Only use git commands if user explicitly requests it
- Only use git commands if no uncommitted changes exist (verify with `git status`)

## Safe Undo Pattern

### Step 1: Acknowledge the Error

State what was done wrong:
```
I made changes without requesting confirmation first. This violated agentic confirmation requirements.

Files modified without approval:
- file1.ts
- file2.ts
```

### Step 2: Show What Will Be Reversed

Display diffs showing current state vs original state:
```
I will reverse these changes manually using fsReplace.

**file1.ts reversal:**
[Show diff: current → original]

**file2.ts reversal:**
[Show diff: current → original]
```

### Step 3: Request Confirmation for Reversal

```
Should I proceed with reversing these changes?
```

Wait for user approval.

### Step 4: Execute Manual Reversal

Use fsReplace to restore original content:
```typescript
fsReplace({
  path: "file1.ts",
  diffs: [{
    oldStr: "[current incorrect content]",
    newStr: "[original correct content]"
  }]
});
```

### Step 5: Confirm Reversal Complete

```
Changes reversed. Files restored to original state.

Ready to proceed with correct approach?
```

### Step 6: Show Correct Approach

Display correct changes with diffs and request confirmation:
```
Here is the correct approach with confirmation:

**Proposed changes:**
[Show diffs]

Should I proceed with these changes?
```

Wait for user approval before executing.

## Manual Reversal Pattern

**Use fsReplace to reverse changes:**

```typescript
// Read current file content
const currentContent = fsRead("file.ts");

// Identify what needs to be reversed
// (compare to git diff or memory of original)

// Use fsReplace to restore original content
fsReplace({
  path: "file.ts",
  diffs: [{
    oldStr: "[incorrect content added]",
    newStr: "[original content]"
  }]
});
```

**If original content unknown:**
- Ask user to provide original content
- Or ask user to run `git diff file.ts` and provide output
- Never guess at original content

## Verification

After manual reversal:
- Show `git diff` to verify reversal is correct
- Confirm with user that files are restored
- Proceed with correct approach only after confirmation
