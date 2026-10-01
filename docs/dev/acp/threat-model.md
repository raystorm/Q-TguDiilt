# ACP Governance Threat Model

Defines what the ACP governance engine (`.workflow/acp/governance/`) defends
against, so rule changes and security reviews share one definition of
"adversary". Governance gates actions the AI takes on the local machine
(shell commands, file reads/edits, MCP/IDE tool calls) before they execute.

## Protected Party and Untrusted Actor

- **Protected:** the local user, their machine, and their repositories.
- **Untrusted:** the AI. It acts on the user's behalf but is not the user.
- **Not a threat:** the local user. They own the machine and can run any
  command directly; governance does not restrict them.

## Threat Tiers

| Tier      | Threat                                         | Typical failure                                   |
| --------- | ---------------------------------------------- | ------------------------------------------------- |
| Primary   | AI error or overreach                          | `rm -rf` wrong path, `git checkout .`, force push |
| Secondary | Indirect prompt injection via content AI reads | Crafted commands that evade the allowlist         |

**Primary** failures are plain, recognizable commands. Prefix rules and
`default: ask` cover them.

**Secondary** risk scales with how much third-party text the AI reads:
dependency source, cloned repos, API docs, web-fetch results, user-submitted
data, production logs, bug reports. An injected instruction can deliberately
use exec-capable flags in otherwise-safe commands (e.g. `sort
--compress-program`, `rg --pre`, `man -P`, `sed` `e`/`w`, awk pipes,
`git diff --output`). Prefix globs cannot catch these reliably.

## Out of Scope

- A malicious local user
- A compromised machine, toolchain, or `PATH`
- Security of the software the AI produces. A web application's
  "assume worst intent" threat model governs the code being written
  (Builder/Enforcer rules and security review), not governance.

## Choosing a Posture

The tier that applies is determined by what the AI reads, not by what kind
of project it builds.

| Posture    | Applies when                                  | Example                          |
| ---------- | --------------------------------------------- | -------------------------------- |
| `trusted`  | Inputs are the user's own code and docs       | Developing Q-TguDiilt itself     |
| `hardened` | AI routinely reads third-party/untrusted text | Web apps, third-party data flows |

The shipped `config.yaml` targets the `trusted` posture. A `hardened`
preset, and a per-command flag system that makes it practical, are
backlogged.

## Review Guidance

- Security reviews MUST state which tier a finding belongs to.
- A primary-tier path to `approve` for a destructive action is blocking.
- Secondary-tier findings are blocking only under the `hardened` posture.
- Avoid `ask` fatigue: excessive prompts train users to approve blindly,
  which is itself a safety regression.
