# Installing the Engine

The installer copies the workflow engine into a repository and writes the saved
prompts and skills in the form each agent runs. Kiro and Copilot write an
argument differently, so each agent gets its own copy.

## Before You Start

- Node.js, and a checkout of the engine repository.
- Once, in the checkout: `cd installer && npm ci`.
- The target is an existing folder, usually a git repository. The installer does
  not create it.
- Run every command from the root of the engine checkout.

## Run It

```bash
node installer/install.mjs <target> [--dry-run] [--force]
```

| Option      | What it does                                     |
| ----------- | ------------------------------------------------ |
| `--dry-run` | Prints what a real run would do. Writes nothing. |
| `--force`   | Overwrites or removes a file that is a conflict. |

`--dry-run` writes nothing, not even a folder. Start with it, read the list, then
run without it.

## What It Prints

```text
warning .workflow/prompts/hello.md: not a prompt or a helper, so not copied
conflict .kiro/prompts/handoff.md
create .agents/skills/handoff/SKILL.md
--------
create .workflow/installed.json
```

- The lines come in this order: `stop:`, `warning`, `conflict`, `update`, `create`,
  `remove`, then a line of dashes and the line for the marker. Each kind is sorted
  by path.
- A file that is already right prints nothing. When there is nothing to do, the
  last line is `nothing to write`.
- `--force` prints `update <path> (forced)` or `remove <path> (forced)`.
- A real run prints the same list as a dry run, after it has written.
- Exit code 0 means the run did what was asked. Exit code 1 means a conflict
  (also in a dry run), a stop, a failed write or a bad command line.

## What It Writes

- `.workflow/`: rules, saved prompts, skills and the ACP service sources.
- `.amazonq/rules/`: the activation rules, as they stand.
- `.amazonq/work/`, `.amazonq/suspended/` and `.workflow/work/`: only the structure
  markers (`.gitignore`, `.gitkeep`, `README.md`).
- `docs/`: the pages the rules and prompts name, `docs/user/`, the overview and
  command pages, and the pages those link to.
- `.kiro/prompts/`: one Kiro prompt for each saved prompt.
- `.agents/skills/`: one Copilot skill for each saved prompt and each skill.
- `.kiro/skills/`: one Kiro skill for each skill in `.workflow/skills/`.
- A `.gitignore` in each generated folder, in `.amazonq/` and in `.workflow/`.
- `.workflow/installed.json`: the marker (see below).

Details:

- A helper prompt (`send-template`) is copied with the other prompts and not
  rendered, because other prompts read it by path.
- A skill folder is copied whole to the target's `.workflow/skills/`, scripts
  included. The generated copies hold `SKILL.md` only.
- Left out: `node_modules`, tests, `registry.yaml`, every `*-project.md`, logs,
  workflow state, and any file in `.workflow/prompts/` that is not a prompt (it gets
  a warning).
- Never touched: your home folder, `.amazonq/prompts/`, `.github/`, the target's own
  root `.gitignore`, and any file in a generated folder that the installer did not
  write.
- Not set up yet: the ACP service (`acp.json`, its dependencies, `registry.yaml`).
  See [ACP with JetBrains](acp-jetbrains.md).

## Conflicts, Re-runs and Removal

The marker records a hash of every file the installer wrote.

| The file in the target                      | Without `--force`     | With `--force` |
| ------------------------------------------- | --------------------- | -------------- |
| Missing                                     | Created               | Created        |
| The same as the engine's                    | Left alone            | Left alone     |
| Different, still as the installer wrote it  | Updated               | Updated        |
| Different, edited by hand or from elsewhere | Conflict, not written | Overwritten    |

- A conflict does not stop the run. The other files are still written, and the exit
  code is 1.
- A file the installer wrote whose source is gone (a deleted rule, doc or prompt) is
  removed, with its generated copies, when nobody edited it. An edited one is a
  conflict, and `--force` removes it.
- Run it again after the engine changes. A run with nothing to change writes nothing.
- There is no uninstall command. `.workflow/installed.json` lists every file the
  installer manages.

## Stops and Warnings

The installer writes nothing, with or without `--force`, when it prints `stop:`:

- a name breaks the name rule, two names give one folder, or two names differ only by
  letter case
- a prompt's folder is the same as a skill's folder
- a prompt's `name` differs from its file name, or a skill's from its folder
- the frontmatter of a prompt or skill is not valid YAML
- `.workflow/installed.json` cannot be read
- the engine lacks a file the installer needs, or the command line is wrong

It warns, and goes on, when the target holds `.github/skills/<name>` for a name the
installer generates: Copilot reads `.github/skills/` first, so that skill hides the
generated one.

## Which Agents

Type `/name argument` yourself. A line pasted with its backticks is sent as plain
text and is not expanded. Agents read prompts and skills when a chat starts, so open
a new chat after an install.

| Client                                            | Result                    |
| ------------------------------------------------- | ------------------------- |
| Kiro (CLI and IDE)                                | Works                     |
| JetBrains AI Assistant with a Copilot agent (ACP) | Works                     |
| Copilot interactive CLI                           | Works, except a `_` skill |
| Copilot IDE plugin, free plan                     | Skills are off            |

- The Copilot CLI does not load a skill whose name starts with `_`.
- In the Copilot IDE plugin, `/debugProfile Planner` ran only because the agent found
  the prompt file by name.
- `/` completion does not list the generated prompts in Kiro or the AI Assistant; the
  Copilot CLI does.

## In the Engine's Own Repository

Running the installer with the engine's own repository as the target is a
self-install. Nothing is copied onto itself. The generated copies, the ignore files
and the marker are written.

After you create, edit or remove a saved prompt or skill, run
`node installer/install.mjs .`, then `node installer/install.mjs . --dry-run`. The
change is complete when the last line is `nothing to write`. The first run over
hand-made copies needs `--force`.

## Git

- Each generated folder gets a `.gitignore` that lists exactly the generated names,
  so the copies stay out of git and your own files in those folders do not. Track the
  `.gitignore` files. Delete one if you want the generated files committed.
- `.workflow/installed.json` is ignored.
- `.amazonq/work/current/.gitkeep` and `.amazonq/work/status/.gitkeep` are empty. The
  installed `.amazonq/work/.gitignore` hides their folders in a new repository. To
  keep the two folders:
  `git add -f .amazonq/work/current/.gitkeep .amazonq/work/status/.gitkeep`

## Known Limits

- Six prompts have no guard for an empty argument: `debugProfile`, `dr`, `epr`,
  `inquiry`, `send` and `send-epr`. A bare `/inquiry` keeps the chat in inquiry mode.
- A symlink in the target is followed when the installer writes through it.
- Do not rely on a leading `_` in a skill name for the Copilot CLI.
