# AWS Command Execution

## Agentic Command Boundary

The AI must NOT execute any command that:

- interacts with cloud infrastructure
- modifies external systems or services
- installs, updates, or removes packages
- builds, deploys, or provisions environments
- runs commands requiring user credentials or privileged access

These commands MUST be run by the user directly.

## Command Execution
- User runs all AWS CLI commands directly
- User runs all npm/npx commands directly
- Do not use executeBash for AWS CLI or npm/npx commands
- Provide the command for the user to run
- Wait for user to provide the output
- Regular shell commands (mv, rm, touch, ls, etc.) can be run with executeBash
