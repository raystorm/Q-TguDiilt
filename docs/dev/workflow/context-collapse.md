# Context Collapse Detection and Recovery

## What is Context Collapse?

Context collapse occurs when a profile loses awareness of its rules and mandatory behaviors during workflow execution. This typically happens due to:
- Token budget exhaustion (context window fills up)
- Rule loading failures
- System resource constraints

## Symptoms

**During workflow:**
- Profile doesn't output Context Status block after @start or @receive
- Profile skips confirmation requests
- Profile makes changes without showing diffs
- Profile behavior seems "off" or inconsistent

**After workflow (in retrospective):**
- Missing log entries in workflow.log
- Profiles mentioned in HANDOFF.md but absent from logs
- Gaps in workflow chain (e.g., PromptEngineer → Documentor with no Builder/Enforcer)

## Detection

### Real-Time Detection (During Workflow)

**Context Status Block:**

When you activate a profile with @start or @receive, you should immediately see:

```
=== Context Status ===
Profile: Builder
WorkflowId: wf-1738190400000
Rules Loaded: 12 files
Logging: ENABLED
Confirmation: ENABLED
======================
```

**If this block is missing:**
- Context collapse has occurred
- Profile did not load rules correctly
- Proceed to recovery steps immediately

### Post-Mortem Detection (After Workflow)

**Retrospective Analysis:**

When you run Retrospective, it will check for context collapse and flag it:

```
## Stop Doing

❌ **CRITICAL: Context collapse detected** - Builder, Enforcer, Documentor executed but failed to log any events
   - PromptEngineer logged handoff_sent to Builder (22:10:00)
   - HANDOFF.md context shows Builder/Enforcer/Documentor completed work
   - But no workflow_start, profile_activated, file_modified, or handoff_sent entries
   - Violates workflow/logging.md MANDATORY requirements
```

## Recovery

### Real-Time Recovery (When Context Status Block Missing)

**Steps:**

1. **Stop immediately** - Don't proceed with collapsed context
2. **Close current tab** - Abandon the collapsed session
3. **Open new tab** - Fresh context window
4. **Retry Begin command** - Type @start or @receive again
5. **Verify Context Status block appears** - Confirms rules loaded correctly
6. **Proceed with work** - Continue workflow normally

**Example:**

```
User: @start
[No Context Status block appears]

User: [Closes tab]
User: [Opens new tab]
User: @start

=== Context Status ===
Profile: Builder
WorkflowId: wf-1738190400000
Rules Loaded: 12 files
Logging: ENABLED
Confirmation: ENABLED
======================

[Profile proceeds normally]
```

### Post-Mortem Recovery (After Discovering Collapse)

If you discover context collapse after work is complete:

1. **Review changes** - Check git diff for what was actually done
2. **Validate manually** - Verify changes are correct
3. **Run tests** - Ensure nothing broke
4. **Document in commit** - Note that work was done with context collapse
5. **Run Retrospective** - Analyze what went wrong

**Prevention for next time:**
- Watch for Context Status block on every @start/@receive
- Close/retry immediately if missing
- Don't proceed without Context Status confirmation

## Why This Happens

**Common causes:**
- **Token budget exhaustion** - Too much context loaded (large files, long conversations)
- **Rule loading failures** - System couldn't load all rule files
- **Memory constraints** - System resource limits reached

**Not your fault:**
- This is a system limitation, not user error
- Recovery is simple: new tab + retry
- Detection mechanisms help catch it early

## Prevention Tips

**Reduce context load:**
- Keep conversations focused
- Use new tabs for new workflows
- Don't load unnecessary files
- Close tabs when work complete

**Watch for signals:**
- Always check for Context Status block
- If profile behavior seems off, check for collapse
- Run Retrospective to catch post-mortem

**Recovery is easy:**
- New tab + retry = fresh context
- Don't panic, just restart
- Verify Context Status block appears

## Related Documentation

- `.workflow/rules/workflow/workflow-mechanics.md` - Context Status block specification
- `.workflow/rules/workflow/logging.md` - Logging requirements
- `.workflow/rules/profiles/retrospective.md` - Context collapse detection
