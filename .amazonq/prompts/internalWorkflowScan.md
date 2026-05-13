Read `.amazonq/prompts/as.md`
and follow its instructions to load the Analyst profile.

Perform a full‑scope Workflow Engine analysis.

Your intention is to detect and surface all forms of:
drift, contradiction, incompleteness, duplication,
and misalignment across the entire Workflow Engine.
Operate with governed precision, no creativity, no rewriting, no fixing — only analysis.

The Workflow Engine is in (paths relative to project root):
  * .workflow/
  * .amazonq/
  *   docs/
  * README.md

Documentation Scope:
Only analyze documentation that describes the Workflow Engine:
  - workflow mechanics
  - rules
  - governance
  - activation
  - profiles
  - engine architecture

Ignore:
  - project-level documentation
  - tech stack docs
  - domain-specific docs
  - anything not referencing or describing workflow engine mechanics or governed behavior

Scan the full Workflow Engine for the following issues:

1. Contradictions
   - rules contradicting rules
   - rules contradicting docs
   - docs contradicting docs
   - examples contradicting rules
   - diagrams contradicting text

2. Missing Pieces
   Do NOT classify unclear wording or ambiguous phrasing as Missing Pieces.
   Missing Pieces must involve:
   - missing definitions
   - missing invariants
   - missing required fields
   - missing rule steps
   - missing glossary entries
   - missing explanations for referenced concepts
   - missing steps in workflows

3. Duplications
   - duplicated concepts
   - overlapping explanations
   - repeated definitions
   - redundant sections that should collapse into one

4. Drift
   - conceptual drift (concepts changed but docs didn’t)
   - structural drift (paths, filenames, anchors, diagrams)
   - procedural drift (workflows no longer match rules)
   - glossary drift (terms defined inconsistently)

5. Outdated or Incorrect Statements
   - anything that no longer matches the latest merged changes
   - references to removed components
   - stale examples or diagrams

6. Inconsistencies
   - terminology inconsistencies
   - formatting inconsistencies
   - profile boundary inconsistencies
   - rule/doc alignment inconsistencies

7. Gaps in Coverage
   - areas where the architecture implies a rule or doc that does not exist
   - workflows missing edge-case handling
   - incomplete sections or TODO placeholders

8. Structural Issues
   - broken links
   - incorrect paths
   - mismatched filenames
   - missing anchors
   - diagram references that don’t exist

9. Project Specific Contamination
   Surface any example, snippet, or explanation that includes:
   - domain‑specific type names
   - domain‑specific field names
   - domain‑specific structures
   - frontend‑specific terminology
   - historical architecture references
   - impact statements tied to your old domain model
   - any example that mirrors your real codebase instead of a universal pattern
**Flag as contamination** unless the file is explicitly marked as a domain‑specific doc.

These categories define the top-level report structure.

Assign each finding an internal priority:
P0 — Critical: Broken invariants or contradictions that affect workflow execution.
P1 — High: Structural drift or missing rules that affect governed behavior.
P2 — Medium: Documentation drift that creates ambiguity but not execution failure.
P3 — Low: Cosmetic, stylistic, or known limitations. Collapsed into a single section.

Only P0–P2 appear in the main report.  
P3 findings appear in a single collapsed “Low‑Priority Notes” section.

Fixability Tiers:
Every finding must be classified into exactly one fixability tier:

1. Governed Fix:
   - Any change that affects workflow behavior or execution
   - Changes to prompts, invariants, mechanics, profile rules, or Contract structure
   - Multi-file or ripple-effect changes
   - Anything touching canonical shapes (Handoff, Message, Feature)
   - Anything touching routing, activation, confirmation, timestamp method

2. Simple Win:
   - Single file or small number of non-governed files
   - terms.md does not count as a governed file
   - Single line or section per file
   - Terminology inconsistencies
   - Argument syntax inconsistencies,
   - Touches governed-adjacent surfaces (glossary, terms, diagrams)
   - Does NOT modify governed logic or execution
   These may be fixed manually but are not Quick Wins.

3. Quick Win:
   - Single Non Governance file
   - Single line or single section
   - No ripple effects
   - Does NOT modify governed files
   - Is not impacted by governed files
   These may be fixed manually.

**Consolidation Rules**
Before emitting the final report:
- Governed Fix ALWAYS overrides Simple Win or Quick Win.
- If the same issue appears in multiple categories, consolidate into ONE
  entry under the highest applicable fixability tier, and applicable priority.
- If multiple files disagree about the same canonical shape, treat it as
  ONE structural drift.
- If a prompt contradicts a rule AND a doc contradicts the same rule,
  treat it as ONE contradiction with sub‑points.
- If a glossary term is present but used inconsistently, treat it as ONE
  terminology drift, not multiple missing entries.
- Merge all timestamp-method mismatches into one item.
- Merge all workflow-pattern inconsistencies into one item.
- Merge all Analyst-profile contradictions into one item.
- Remove repeated mentions of the same missing file or broken reference.

**SEVERITY INTERPRETATION**
- Contradictions involving governed invariants
  (Change, Confirmation, Timestamp Method, Profile Activation, Routing) are ALWAYS P0.
- Mismatched canonical shapes (Handoff, Message, Feature) are P1 unless they break execution.
- Documentation inconsistencies are P2 unless they mislead governed behavior.
- Typos, alias formatting, missing links, and cosmetic issues are P3.

**Known issues/exceptions**
Analyst and Communicator are conceptual, ignore any findings
Analyst and Communicator do not have profile specific rule files, ignore missing, or broken links
Analyst and Communicator can write files, and need agentic-confirmation
Allowed Duplicates:
  * Profile Lists
  * Command Lists
  * Glossary and Terms
  * Rules are Operational, Docs are Conceptual
user-guide is allowed to use abstract diagrams instead of specific profiles
Only 1 Side-trip at a time.
handoff/send ALWAYS overwrite their changeover file.
@as is an activation command, not a transfer command.
@begin is placeholder for @start/@recieve, only flag issues if the definition of @begin is unclear.
@hello was a diagnostic command/prompt and is to be ignored.
User docs may start workflow diagrams or steps with User
Tactician is an escalation-only profile. ignore if it's not listed.
FAQ links to external sites, and is allowed.
Project References matching the workflow engine are allowed in examples.

STRUCTURAL RULES:
- HANDOFF.md and MESSAGE.md are ephemeral routing artifacts.
  They are regenerated on each command and do not represent persistent state.
- Conceptual placeholders (e.g., @begin) do not require implementation.
- Prompts MUST follow governed invariants:
  - Change invariant
  - Confirmation invariant
  - Timestamp Generation Method
  - Profile Activation rules
  - Routing rules

Only flag “Missing Documentation” when BOTH are true:
1. The system behavior cannot be inferred from rules, prompts, or invariants.
2. The missing documentation creates ambiguity for governed behavior.

Terminology Consistency Rule:
Synonyms for governed terms MUST NOT appear in documentation unless explicitly permitted.
Flag all synonyms as findings.

Assign priority based on impact:
- P2 — Medium:
  The synonym changes meaning, contradicts glossary usage, or obscures the governed concept.
- P3 — Low:
  The synonym is semantically clear and does not alter meaning,
  but violates terminology consistency.

Examples:
- "workflow loop" instead of Cycle → P3 (clear synonym)
- "story" used interchangeably with Cycle in a way that changes scope → P2

OUTPUT FORMAT (CATEGORY → TIER → PRIORITY)

For each category (Contradictions, Missing Pieces, etc.):

1. Quick Win (P1–P3)
    - Bullet list
    - Each bullet includes:
        * file(s)
        * issue
        * why it matters
        * priority (P1–P3)

2. Simple Win (P1–P3)
    - Bullet list
    - Each bullet includes:
        * file(s)
        * issue
        * why it matters
        * priority (P1–P3)

3. Governed Fix (P0–P2)
    - Bullet list
    - Each bullet includes:
        * file(s)
        * issue
        * why it matters
        * priority (P0–P2)

4. Low-Priority Notes (P3)
    - Collapsed section

Do not propose fixes.
Do not rewrite anything.
Do not generate new content.
Do not output “excluded”, “verified”, “no issue”, or "known exception" items.
Only surface issues with precision and completeness.
