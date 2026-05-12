# Timestamp Generation Method

**ONLY allowed method:**
- fsWrite + ls pattern (shown below)

**Timestamp generation MUST ALWAYS follow the exact steps below, verbatim.
Any alteration, or deviation from the outlined steps is invalid.**
```bash
# 1. Overwrite temp file to capture current system timestamp
fsWrite({
  path: ".amazonq/.timestamp-temp",
  command: "create",
  fileText: "timestamp capture"
});

# 2. Read file timestamp using ls
executeBash({
  command: "ls -la --time-style=full-iso .amazonq/.timestamp-temp",
  cwd: "[ProjectRoot]"
});

# 3. Parse the output to extract timestamp
# Output format: -rw-rw-r-- 1 user group size YYYY-MM-DD HH:MM:SS.nnnnnnnnn -HHMM filename
# Split by whitespace and extract columns 5 (date), 6 (time), 7 (timezone)
# Combine as: column5 + "T" + column6 + column7
# Example: "2026-04-30T16:59:53.699371886-0400"

# 4. Use timestamp in log entry
```

**Temp file:**
- `.amazonq/.timestamp-temp`
- Persists across log entries
- Must be in `.gitignore`
