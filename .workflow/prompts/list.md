---
name: list
version: 1.1.0
description: "Show all suspended and auto-suspended contexts."
---
Check for the file by its exact path, never with a file search, glob or
directory listing. `.amazonq/suspended/` is ignored by git, and those tools
skip ignored paths.

1. Read `.amazonq/suspended/INDEX.md` with the file read tool.
2. If the read fails or returns nothing, confirm with the terminal:
   - Linux and macOS: `ls -la .amazonq/suspended/INDEX.md`
   - Windows (cmd and PowerShell): `type .amazonq\suspended\INDEX.md`
3. If the terminal command also reports the file is missing, display:
   "No suspended contexts found. (INDEX.md does not exist)"
   Do not continue. Do not log or change workflow state.
4. If the two disagree, the terminal result is the authority. Use its output
   as the content (`cat` on Linux and macOS, `type` on Windows).

Read `.amazonq/suspended/INDEX.md` and display all suspended contexts.

Show Active Contexts section.

Show Completed Contexts section.

Format each entry: `[name] - [description] - [date]`

If no contexts exist, display: "No suspended contexts found."
