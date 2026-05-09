# Retrospective Examples

## Example: Context Collapse Detection Output

```
## Stop Doing

❌ **CRITICAL: Context collapse detected** - Builder, Enforcer, Documentor executed but failed to log any events
   - PromptEngineer logged handoff_sent to Builder (22:10:00)
   - HANDOFF.md context shows Builder/Enforcer/Documentor completed work
   - But no workflow_start, profile_activated, file_modified, or handoff_sent entries
   - Violates workflow/logging.md MANDATORY requirements
   - Suggests context window exhaustion or rule loading failure
```

## Improvement Options Menu Examples

**Example with changes:**
```
Improvement Options:
1. Rule draft (send to PE)
2. Commit improvements (send to Documentor)
3. Done (proceed to cleanup)
```

**Example without changes:**
```
Improvement Options:
1. Rule draft (send to PE)
2. Done (proceed to cleanup)
```
