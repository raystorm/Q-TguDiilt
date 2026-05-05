# Profile Debug with Explicit Loading

## Step 1: Load Profile Using @as Logic

**Extract profile name from user command:**
- `@debugProfile Planner` → Profile = "Planner"
- `@debugProfile PE` → Profile = "PromptEngineer"

**Load the profile:**
1. Read `.amazonq/prompts/as.md`
2. Follow its instructions to load the specified profile

## Step 2: Generate Debug Report

Generate the full verbose Context Status block, for a single profile activation.

Infer all fields using only the information available in the current context window.
Do not rely on external rules or system extensions.
Do not load categories or rules beyond those already active for the current profile.
This diagnostic is profile‑scoped.

### Rule Index Population

The four Rule Index sections track the loading pipeline from filesystem to activation:

**Discovery:**
- List every file from `.workflow/rules/` that was encountered during loading
- Include all files read via `as.md` loading process
- This is filesystem enumeration - what the loader saw

**Rule-Eligible:**
- List files from Discovery that are in rule directories (`.workflow/rules/`)
- Exclude docs, examples, non-rule directories
- This is structural filtering - what could be a rule

**Discovered Rules:**
- List files from Rule-Eligible that contain rule structures
- Files with operational instructions, constraints, or governance
- This is semantic parsing - what was parsed as a rule

**Activated Rules:**
- List files from Discovered Rules that apply to the active profile
- Based on profile's "Uses:" list and transitive references
- This is profile scoping - what's actually governing behavior

**Critical:** All files loaded in Step 1 must appear in all four sections unless explicitly filtered at a specific stage.

## Classification Logic

Profile Lane:
- "Stable" if the assistant's tone, role, and behavior match the active Profile and do not show generic-assistant fallback, builder-mode phrasing, or helper-mode overreach.
- "Flicker Detected" if any sudden tone shift, generic disclaimers, builder-style language, or Profile inconsistency appears.

Workflow Lineage:
- "Intact" if the workflow ID in HANDOFF.md matches the workflow ID in MESSAGE.md.
- "Reinterpreted" if the workflow ID appears regenerated, altered, or inconsistent.
- "Missing" if no workflow ID is present.

Handoff Integrity:
- "Valid" if exactly one HANDOFF.md is present and structurally complete.
- "Missing" if no HANDOFF.md is detected.
- "Multiple" if more than one HANDOFF-like structure appears.

Rule Density:
- "Low" if rules are short, atomic, and free of examples, rationale, or ceremony.
- "Normal" if rules are clean but moderately sized.
- "High" if rules contain examples, rationale, ceremony, or exceed typical token length.

Semantic Drift Risk:
- "Low" if Profile is stable, lineage intact, handoff valid, and density low/normal.
- "Medium" if any single subsystem shows instability.
- "High" if Profile flicker, lineage reinterpretation, high density, or missing/multiple handoffs are detected.

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
- Compute each category’s percentage as:
  (filesInCategory / totalRuleFiles) * 100
- Round to the nearest whole number.
- Present categories in descending percentage order.
- If a category has 0 files, omit it.
- Print results in a bulleted list, one per line, with 2 leading spaces.
- On each line print category name, file count, %.

## Output Format

Return only this block, populated with inferred values:

=== Profile Debug ===

Profile: {{profileName}}
WorkflowId: {{workflowId}}

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
- HANDOFF: {{handoffPercent}}%
- User Message: {{userPercent}}%
- System/Profile: {{systemPercent}}%

--- Stability Signals ---
Profile Lane: {{ProfileLaneStatus}}
Workflow Lineage: {{workflowLineageStatus}}
Handoff Integrity: {{handoffIntegrityStatus}}
Rule Density: {{ruleDensityStatus}}
Governance Value: {{governanceValue}}
Density/Value Ratio: {{densityValueRatio}}
Semantic Drift Risk: {{driftRiskStatus}}

--- System Flags ---
Unexpected Files: {{unexpectedFiles}}

=== Rule Index: Discovery (count) ===
[List every file the loader discovered]

=== Rule Index: Rule‑Eligible (count) ===
[List every file considered a rule by naming/tag/directory]

=== Rule Index: Discovered Rules (count) ===
[List every file parsed into rule objects]

=== Rule Index: Activated Rules (count) ===
[List every rule actually activated for this profile]

======================

Do not add commentary or explanation.
Return only the block.
