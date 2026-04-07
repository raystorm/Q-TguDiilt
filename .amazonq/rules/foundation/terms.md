# Terms (Glossary)
# Project-specific extensions belong in terms-project.md.

Workflow Artifact
: A user-visible project or workflow file whose creation or modification materially affects the workflow.

: **Includes - Persistent Workflow Artifacts**  
Files that represent long-term project state and must be versioned.  
Source code, tests, configuration files, persistent documentation, shared team resources.

: **Includes - Transient Workflow Artifacts**  
Files that represent workflow state and must NOT be versioned.  
any file inside `.amazonq/work/`, or subdirectories

: **Excludes - System-Owned (Not Workflow Artifacts)**  
Internal plumbing and runtime files that are never treated as workflow artifacts.  
System-owned plumbing (workflow.log, auto-suspend state, internal metadata), temporary files, working files.

: **Invariant**  
All creation or modification of workflow artifacts requires explicit user confirmation.


Context Capsule
: A structured container for workflow state, including intent, constraints, history, lineage, and profile roles.
: Enables suspend/resume, multi-step workflows, and continuity across outages.

Changeover
: A governed workflow operation where one profile prepares control and
context for another profile. All changeovers follow the same invariant:
user-triggered, summarized, confirmed, approved, then written.  
Handoffs (linear) and Side Trips (parallel) are two types of changeovers.

Change
: A rule-facing categorization that groups the commands which *initiate* a Changeover.  
The Change category includes `@handoff` (linear) and `@send` (parallel).  
Rules referring to "Change" apply uniformly to both commands.

Begin
: A rule-facing categorization that groups the commands which *activate* a Changeover.  
The Begin category includes `@start` (linear) and `@receive` (parallel).  
Rules referring to "Begin" apply uniformly to both commands.

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
