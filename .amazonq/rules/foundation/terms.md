# Terms (Glossary)
# Project-specific extensions belong in terms-project.md.

Workflow Artifact
: A user-visible project or workflow file whose creation or modification materially affects the workflow.

: **Includes - Persistent Workflow Artifacts**  
Files that represent long-term project state and must be versioned.  
Source code, tests, configuration files, persistent documentation, shared team resources.

: **Includes - Transient Workflow Artifacts**  
Files that represent workflow state and must NOT be versioned.  
HANDOFF.md, MESSAGE.md, baton files, workflow context capsules.

: **Excludes - System-Owned (Not Workflow Artifacts)**  
Internal plumbing and runtime files that are never treated as workflow artifacts.  
System-owned plumbing (workflow.log, auto-suspend state, internal metadata), temporary files, working files.

: **Invariant**  
All creation or modification of workflow artifacts requires explicit user confirmation.


Context Capsule
: A structured container for workflow state, including intent, constraints, history, lineage, and profile roles.
: Enables suspend/resume, multi-step workflows, and continuity across outages.

Handoff
: A workflow artifact that transfers control and context from one profile to another.
: Marks a state transition in the Main Thread.

Thread
: An isolated workflow execution context with its own workflowId and state.

Main Thread
: The primary sequential execution path of a workflow cycle.

Side Trip
: A temporary, isolated workflow branch used for exploration or corrective action without altering the Main Thread.

Workflow ID
: A unique identifier assigned at workflow start.
: Used to correlate artifacts, logs, suspends, resumes, and checkpoints.

Profile Contract
: A formal specification of a profile’s identity, responsibilities, and boundaries.
: Ensures predictable, governed behavior.

Override Grammar
: A formal syntax (`Override:`) used to intentionally break or modify rules.
: Ensures deviations are explicit, grep-able, and auditable.
