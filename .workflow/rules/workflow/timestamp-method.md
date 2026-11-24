# Timestamp Generation Method

**ONLY allowed method:**
Run one command for each log write, at that moment, and copy its output unchanged.
Never reuse an old value.

**Timestamp generation MUST ALWAYS follow the exact steps below, verbatim.
Any alteration, or deviation from the outlined steps is invalid.**

Pick by the operating system of the shell:

| System          | Command                                              | Example                              |
| --------------- | ---------------------------------------------------- | ------------------------------------ |
| Linux           | `date +%Y-%m-%dT%H:%M:%S.%N%z`                       | `2026-11-24T01:16:08.859714678-0500` |
| macOS           | `date +%Y-%m-%dT%H:%M:%S%z`                          | `2026-11-24T01:16:08-0500`           |
| Windows (PS)    | `Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffffffzzz"`  | `2026-11-24T01:16:08.8597146-05:00`  |

**Notes:**

- **macOS:** BSD `date` has no `%N`, so the time has whole seconds. `gdate` from
  coreutils may be used when installed.
- **Windows:** `zzz` gives `-05:00` with a colon. It is valid ISO 8601. The
  Retrospective timestamp checks (backward jumps, `:00:00.000Z`) do not
  depend on the offset form.

**Procedure:**

1. Run the command for your OS at the moment of logging
2. Copy output unchanged into the timestamp field
3. Use immediately (no delay between generation and logging)
4. Never reuse or store timestamps for later
