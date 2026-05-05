# Debug Full Rule System

## Step 1: Load All Rules

Load every rule file under `.workflow/rules/`:

1. List all directories under `.workflow/rules/`
2. For each directory, read all `.md` files
3. Load all files into context
4. Do NOT activate any profile
5. Do NOT filter by profile scope

## Step 2: Generate Debug Report

Generate the full verbose Context Status block for the complete rule system.

Infer all fields using only the information available in the current context window.
This diagnostic is system-scoped, not profile-scoped.

### Rule Index Population

The four Rule Index sections track the complete rule system:

**Discovery:**
- List every file from `.workflow/rules/` that was loaded
- This is complete filesystem enumeration

**Rule-Eligible:**
- List files from Discovery that are in rule directories (`.workflow/rules/`)
- Exclude docs, examples, non-rule directories
- This is structural filtering - what could be a rule

**Discovered Rules:**
- List files from Rule-Eligible that contain rule structures
- Files with operational instructions, constraints, or governance
- This is semantic parsing - what was parsed as a rule

**Activated Rules:**
- List all files from Discovered Rules (no profile filtering)
- This shows the complete governance system

**Critical:** All files loaded in Step 1 should appear in all four sections unless explicitly filtered at a specific stage.

## Classification Logic

Profile Lane:
- "No Profile Active" (full system scan, no profile activated)

Workflow Lineage:
- "N/A" (system-level diagnostic)

Handoff Integrity:
- "N/A" (system-level diagnostic)

Rule Density:
- "Low" if rules are short, atomic, and free of examples, rationale, or ceremony.
- "Normal" if rules are clean but moderately sized.
- "High" if rules contain examples, rationale, ceremony, or exceed typical token length.

Semantic Drift Risk:
- Assess based on rule density and governance value across entire system

Governance Value:
- "High" if rules are predominantly atomic, constraint‑bearing, and directly executable.
- "Medium" if rules mix atomic constraints with descriptive or interpretive text.
- "Low" if rules contain significant explanation, rationale, narrative, or examples.

Density/Value Ratio:
- Compute as: semanticDensity / governanceValueScore
  where governanceValueScore = 3 for High, 2 for Medium, 1 for Low.
- "Efficient" if ratio < 1.0
- "Balanced" if ratio is between 1.0 and 2.0
- "Inefficient" if ratio > 2.0

Rule Category Breakdown:
- Count how many loaded rule files belong to each category.
- Compute each category's percentage as:
  (filesInCategory / totalRuleFiles) * 100
- Round to the nearest whole number.
- Present categories in descending percentage order.
- If a category has 0 files, omit it.
- Print results in a bulleted list, one per line, with 2 leading spaces.
- On each line print category name, file count, %.

## Output Format

Return only this block, populated with inferred values:

=== Full System Debug ===

Profile: None (System Scan)
WorkflowId: N/A

--- Load Summary ---
Rules Loaded: {{ruleFileCount}} files
Rule Categories: {{ruleCategories}}
Non-Rule Files Loaded: {{nonRuleFileCount}}

--- Context Metrics ---
Context Usage: {{contextPercent}}%
Context Sources:
- Rules: {{rulesPercent}}%
- Rule Category Breakdown:
  {{ruleCategoryBreakdown}}
- User Message: {{userPercent}}%
- System/Profile: {{systemPercent}}%

--- Stability Signals ---
Profile Lane: No Profile Active
Workflow Lineage: N/A
Handoff Integrity: N/A
Rule Density: {{ruleDensityStatus}}
Governance Value: {{governanceValue}}
Density/Value Ratio: {{densityValueRatio}}
Semantic Drift Risk: {{driftRiskStatus}}

--- System Flags ---
Unexpected Files: {{unexpectedFiles}}

=== Rule Index: Discovery (count) ===
[List every file loaded from .workflow/rules/]

=== Rule Index: Rule‑Eligible (count) ===
[List every file considered a rule by naming/tag/directory]

=== Rule Index: Discovered Rules (count) ===
[List every file parsed into rule objects]

=== Rule Index: Activated Rules (count) ===
[List all discovered rules (no profile filtering)]

======================

Do not add commentary or explanation.
Return only the block.
