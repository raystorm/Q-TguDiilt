Ignore all prior conversation history, context, and persona state.

Read `.amazonq/work/current/MESSAGE.md` and act as the profile specified in "To:" field.

Execute the request in the message and provide response.

After completing the task, if MESSAGE.md contains a "Next:" field with a profile name, display:

---
**Next**: Run `@send` to [Profile Name from Next field]

Do not modify work files. Do not change handoff state.
