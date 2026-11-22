# Prompt Format

How a saved prompt or an authored skill is written once, and what each agent gets from it.
The transform in `installer/transform.ts` is pure: it takes the text of a file and returns the
Kiro text and the Copilot skill. It reads and writes no files. The installer uses it to write
the forms into a target repository (see `docs/user/installer.md`).

## Canonical files

| Path                               | Holds                            |
| ---------------------------------- | -------------------------------- |
| `.workflow/prompts/<name>.md`      | Saved prompts, written by hand   |
| `.workflow/skills/<name>/SKILL.md` | Authored skills, written by hand |

A canonical file starts with a frontmatter block: a first line of `---`, and a closing line of
`---`. The first closing line ends the frontmatter. Any later `---` line belongs to the body.

| Key                        | Required | Meaning                       | Kiro   | Copilot        |
| -------------------------- | -------- | ----------------------------- | ------ | -------------- |
| `name`                     | Yes      | Names the command             | Copied | Copied         |
| `version`                  | Yes      | Prompt version                | Copied | Copied         |
| `description`              | Yes      | One sentence for the picker   | Copied | Copied         |
| `arguments`                | No       | Ordered argument names        | Copied | Not copied     |
| `argument-hint`            | No       | Picker text, written by hand  | Copied | Copied         |
| `user-invocable`           | No       | `false` marks a helper prompt | Copied | Not copied     |
| `disable-model-invocation` | No       | Stops the model running it    | Copied | Set, see below |
| any other key              | No       |                               | Copied | Not copied     |

Copied means the key is in that agent's text, as written, when the source has it. Required means
every prompt carries it. The transform checks only `name`: a prompt with no `version` or
`description` still renders, and the Copilot form leaves the missing key out. The form each
agent gets, below, says how `disable-model-invocation` is set.

A file is one of three kinds:

- **prompt**: frontmatter with a `name`. A command the user can run.
- **helper**: frontmatter with a `name` and `user-invocable: false`. Other prompts read it by path.
  The transform classifies it and does not render it.
- **neither**: no frontmatter, frontmatter that never closes, or no `name`. A blank `name` counts as
  none. A byte-order mark before the opening `---` also makes a file neither.

## Arguments

A prompt that takes input lists its arguments by name in `arguments` and writes `{{name}}` in the
body where the value is used. The position in `arguments` is the argument number.

- An argument name is letters, numbers, hyphens and underscores, starting with a letter. Letters
  are A to Z and a to z.
- A token is exactly `{{name}}`: no spaces inside, and case matters. `{{ to }}` and `{{To}}`
  are text.
- Only declared arguments are replaced. Any other `{{...}}` stays as written. It is output text,
  such as the fields a debug report fills in.
- `input` is reserved for free text: everything typed after the command. A prompt uses `input`
  alone or positional arguments, never both.
- A `$` in the body is text. The replacement never treats it as a pattern.
- Every declared argument appears in the body at least once.

Writing a prompt:

- Put a token only where its value is used. No sentence talks about the token. A guard for a missing
  value reads "an empty value, or placeholder text that was not replaced".
- Give an argument a name that no other `{{...}}` in the file has. An argument named like an output
  field cannot be told apart from it, so both would be replaced.

## Names

The rule applies to a prompt name, an authored skill name and a folder name:

- at most 64 characters
- the first character is a letter, a number or `_` (`_` marks an internal skill, as in `_commands`)
- after that, letters, numbers, hyphens and underscores only. No spaces, dots or colons
- letters are A to Z and a to z only, so `café` is invalid
- an authored skill's name is also lower-case. A prompt's name is not: `debugProfile` is valid
- a doubled or trailing hyphen is accepted (the Agent Skills specification does not allow it;
  this rule does)

The Agent Skills specification lists lower-case letters, numbers and hyphens only, so an agent may
refuse a skill whose name starts with `_`. This has not been confirmed on Kiro or on Copilot.

The folder of a prompt is its name in lower case, with a hyphen at each word break: between a
lower-case letter or a number and a capital, and between a run of capitals and the capital that
starts the next word. No hyphen goes at the start, after `_`, or beside an existing hyphen. The
folder of an authored skill is its name.

Examples of names and the folders they give:

| Example name           | Folder                   |
| ---------------------- | ------------------------ |
| `debugProfile`         | `debug-profile`          |
| `internalWorkflowScan` | `internal-workflow-scan` |
| `Debug`                | `debug`                  |
| `_Commands`            | `_commands`              |
| `HTTPServer`           | `http-server`            |
| `getHTTPResponse`      | `get-http-response`      |
| `v2Beta`               | `v2-beta`                |
| `foo-Bar`              | `foo-bar`                |
| `ABC`                  | `abc`                    |

The `name` in the Copilot form stays as written, so `/debugProfile` keeps working.

The transform sees one file at a time. It does not check that two names differ only by letter case
(Windows ignores case), or that two names give one folder. The installer checks both.

## The form each agent gets

|                                | Kiro                              | Copilot                    |
| ------------------------------ | --------------------------------- | -------------------------- |
| Positional argument `{{to}}`   | `${n}`                            | `$(n)`                     |
| Free-text argument `{{input}}` | `$ARGUMENTS`                      | `$(input)`                 |
| Frontmatter                    | All keys, kept exactly as written | Only the keys marked above |
| Output                         | The text                          | A folder name and the text |

- A skill made from a prompt always gets `disable-model-invocation: true`, so Copilot runs it only
  when the user types the command. A value in the prompt is ignored.
- An authored skill gets no `disable-model-invocation` unless its source has one. The value is
  kept as written.
- The Copilot frontmatter is written with `\n` line endings. The body keeps the source's line
  endings, CRLF included.
- The Kiro text equals the source except for the tokens. A file with no declared argument comes
  back unchanged.

## Stops

The transform stops and renders nothing for either agent. The error carries the reason, the label
the caller gave the file, and a `detail`. The reasons `slot_repeated` and `slot_unused` keep the
word slot, as the code does.

| Reason              | When                                                 | `detail`           |
| ------------------- | ---------------------------------------------------- | ------------------ |
| `name_invalid`      | The name breaks the rule, or there is no usable name | The name, or empty |
| `arguments_invalid` | `arguments` is not a list of valid argument names    | The value, as JSON |
| `input_mixed`       | `input` is declared with another argument            | `input`            |
| `slot_repeated`     | An argument is declared twice                        | The argument       |
| `slot_unused`       | A declared argument is not in the body               | The argument       |

The checks run in that order: name, then the shape of `arguments`, then `input_mixed`,
`slot_repeated` and `slot_unused`. A blank `arguments:` means none. Invalid YAML is not caught here:
the error of the YAML parser (`js-yaml`) passes through.
