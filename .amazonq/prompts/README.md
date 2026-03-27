# Q Saved Prompts

## Installation

Copy prompt templates to your global prompts directory:

```bash
cp .amazonq/prompts/*.md ~/.aws/amazonq/prompts/
```

---

## Available Prompts

### Handoff System

**`@prompt start`**
Reads `.amazonq/work/HANDOFF.md` and activates the profile specified in "To:" field.

**`@prompt handoff next=ProfileName`**
Writes handoff for next profile to `.amazonq/work/HANDOFF.md`.

**Examples:**
```
@prompt handoff next=Tester
@prompt handoff next=Verifier
@prompt handoff next=Builder
```

### Send/Receive System

**`@prompt send to=ProfileName purpose="description"`**
Sends message to another profile for quick validation without full handoff.

**`@prompt send-epr`**
Shortcut to send current work to Enforcer for rule compliance review.

**`@prompt receive`**
Reads `.amazonq/work/MESSAGE.md` and executes the request.

**Examples:**
```
@prompt send to=Analyst purpose="explain this pattern"
@prompt send-epr
@prompt receive
```

### Other

**`@prompt epr`**
Enforcer reviews prompt and response for rule compliance.

---

## Usage

See `.amazonq/work/README.md` for the complete handoff system workflow.
