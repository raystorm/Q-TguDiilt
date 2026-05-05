When command `@_troubleshootFeatureTracking` is received then process the following FEATURE.md troubleshooting procedures.

# FEATURE.md Troubleshooting

## When to Load This Prompt

Load when encountering FEATURE.md issues:
- FEATURE.md not found but expected
- Wrong story marked as "In Progress"
- Analysis artifacts missing
- Story dependencies unclear
- Format errors or corruption

---

## Troubleshooting Scenarios

### FEATURE.md Not Found

**Symptoms:**
- Profile expects FEATURE.md but file doesn't exist
- Error reading `.amazonq/work/FEATURE.md`

**Diagnosis:**
1. Check if `.amazonq/work/FEATURE.md` exists
2. Check if feature is single-story (no FEATURE.md needed)
3. Check if FEATURE.md was deleted (feature complete)

**Actions:**
- If single-story: No FEATURE.md needed, proceed without it
- If multi-story and missing: Ask user if FEATURE.md should exist
- If feature complete: Confirm with user, proceed without it

---

### Wrong Story Marked In Progress

**Symptoms:**
- Current Story section shows wrong story number
- Story marked "In Progress" doesn't match actual work
- Multiple stories marked "In Progress"

**Diagnosis:**
1. Read FEATURE.md Current Story section
2. Check which story is actually being worked on
3. Verify story status checkboxes

**Actions:**
- Documentor should update after each story completion
- If wrong story marked: Manually correct Current Story section
- Update story status checkbox to match reality
- Ensure Documentor reads FEATURE.md before updating

**Correction Pattern:**
```markdown
## Stories
- [x] Story 1: [Title] - Complete
- [ ] Story 2: [Title] - In Progress  ← Correct this
- [ ] Story 3: [Title] - Not Started

## Current Story
**Story 2: [Title]**  ← Update this

Status: In Progress
```

---

### Analysis Artifacts Missing

**Symptoms:**
- FEATURE.md references analysis document that doesn't exist
- Analysis Artifacts section has broken links
- Profiles can't find referenced analysis

**Diagnosis:**
1. Check `.amazonq/work/` directory for analysis files
2. Verify analysis artifacts should survive workflow cleanup
3. Check if analysis was never created

**Actions:**
- Search `.amazonq/work/` for analysis files
- If missing and needed: May need to recreate analysis
- If not needed: Remove reference from FEATURE.md
- Analysis artifacts should survive workflow cleanup (not deleted)

**Where to Look:**
- `.amazonq/work/*.md` (not in current/ subdirectory)
- Files like `*-analysis.md`, `*-findings.md`
- Check FEATURE.md Analysis Artifacts section for filenames

---

### Story Dependencies Unclear

**Symptoms:**
- Unclear why stories must be done in specific order
- Technical dependencies not documented
- Profiles unsure if story can be reordered

**Diagnosis:**
1. Read Story Dependencies section in FEATURE.md
2. Check if dependencies are documented
3. Verify if technical constraints exist

**Actions:**
- If dependencies unclear: Escalate to Architect for clarification
- Architect analyzes technical dependencies
- Update Story Dependencies section with findings
- Add technical context for sequencing

**Escalation Pattern:**
```
Planner: "Story dependencies unclear. Need Architect analysis."
User: "@handoff next=Architect"
Architect: [Analyzes dependencies]
Architect: [Provides dependency analysis]
User: "@handoff next=Planner"
Planner: [Updates FEATURE.md with dependencies]
```

---

### Format Errors or Corruption

**Symptoms:**
- FEATURE.md doesn't match expected format
- Missing required sections
- Malformed markdown

**Diagnosis:**
1. Read FEATURE.md content
2. Compare to format in `workflow/workflow-mechanics.md`
3. Identify missing or malformed sections

**Actions:**
- If minor formatting issue: Correct inline
- If major corruption: Recreate from workflow log and git history
- If unsure: Ask user to verify FEATURE.md content

**Required Sections:**
- Goal
- Stories (checkbox list)
- Current Story
- Progress Notes (optional but recommended)

**Optional Sections:**
- Analysis Artifacts
- Story Dependencies

---

### Story Status Out of Sync

**Symptoms:**
- Story marked "Complete" but work not done
- Story marked "Not Started" but work in progress
- Checkbox status doesn't match Current Story section

**Diagnosis:**
1. Check git log for story completion commits
2. Verify which story is actually being worked on
3. Compare checkbox status to Current Story section

**Actions:**
- Sync checkbox status with reality
- Update Current Story section to match
- Add progress note explaining correction
- Ensure Documentor updates after each commit

---

### Multiple Stories In Progress

**Symptoms:**
- Multiple stories marked "In Progress"
- Current Story section ambiguous
- Unclear which story is active

**Diagnosis:**
1. Check which story is actually being worked on
2. Verify recent commits and workflow log
3. Identify which story should be active

**Actions:**
- Mark only one story as "In Progress"
- Mark others as "Not Started" or "Complete"
- Update Current Story section to match active story
- Add progress note explaining correction

---

## Prevention Patterns

### For Planner (Creation)
- Always include Goal section
- List all stories with checkboxes
- Mark only Story 1 as "In Progress"
- Add Analysis Artifacts section if analysis exists
- Document Story Dependencies if they exist

### For Documentor (Updates)
- Always read FEATURE.md before updating
- Mark completed story as "Complete"
- Mark next story as "In Progress"
- Update Current Story section
- Add progress note with date and summary

### For Retrospective (Cleanup)
- Check all stories marked "Complete" before deleting
- Preserve analysis artifacts in `.amazonq/work/`
- Confirm with user before deleting FEATURE.md

---

## Recovery Patterns

### Recreate FEATURE.md from Workflow Log

If FEATURE.md is lost or corrupted:

1. Read `.amazonq/workflow.log`
2. Find workflow_start events for feature stories
3. Extract story titles and completion dates
4. Reconstruct FEATURE.md format
5. Ask user to verify reconstructed content

### Sync FEATURE.md with Git History

If status out of sync:

1. Run `git log --oneline` to see recent commits
2. Identify which stories have completion commits
3. Update FEATURE.md to match git history
4. Add progress note explaining sync

---

## When to Escalate

**Escalate to Architect when:**
- Story dependencies are unclear
- Technical constraints need analysis
- Domain behavior affects story ordering

**Escalate to Planner when:**
- Story scope is unclear
- New stories need to be added
- Story breakdown needs revision

**Ask user when:**
- FEATURE.md should exist but doesn't
- Unsure if feature is complete
- Major corruption requires recreation
- Story status ambiguous

---

## Related Documentation

- `workflow/workflow-mechanics.md` - FEATURE.md format and decision criteria
- `docs/dev/workflow/feature-tracking.md` - Detailed examples and patterns
- `profiles/planner.md` - FEATURE.md creation steps
- `profiles/documentor.md` - FEATURE.md update steps
- `profiles/retrospective.md` - FEATURE.md cleanup steps
