Check if `.amazonq/suspended/INDEX.md` exists.

If it does not exist, display:
"No suspended contexts found. (INDEX.md does not exist)"
Do not continue. Do not log or change workflow state.

Read `.amazonq/suspended/INDEX.md` and display all suspended contexts.

Show Active Contexts section.

Show Completed Contexts section.

Format each entry: `[name] - [description] - [date]`

If no contexts exist, display: "No suspended contexts found."
