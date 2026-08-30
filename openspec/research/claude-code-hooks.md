# Claude Code Hook Events — Verified

Verified by string inspection of the installed Claude Code binary,
**version 2.1.251** (`~/.local/share/claude/versions/2.1.251`), not from memory or docs.

All eight events the design relies on exist in this build:

| Event | Occurrences in binary | Used for |
|---|---|---|
| `SessionStart` | 57 | SPAWN — character rides the elevator in |
| `UserPromptSubmit` | 47 | new task; drives the speech bubble and label text |
| `PreToolUse` | 83 | role classification; `Task` matcher also signals delegation |
| `PostToolUse` | 81 | exit codes — failure streaks (bear debugging), green suites (ship-it dance) |
| `SubagentStart` | 19 | SUBAGENT_SPAWN choreography |
| `SubagentStop` | 30 | SUBAGENT_DONE — report, lounge rest, exit |
| `Stop` | — | agent returns to SEATED_IDLE |
| `SessionEnd` | 28 | clean despawn |

`PreCompact` (27) and `Notification` (216) also exist but are not used by this change.

`SubagentStart` was worth verifying specifically: it is the newest of the eight and the
subagent choreography is built entirely on it. The binary contains the literal string
`SubagentStart hooks cancelled (control stream closed)`, confirming it is a dispatched hook
event and not an internal identifier.

**Consequence for the design:** subagent spawn does NOT need to be inferred from a
`PreToolUse` `Task` matcher. Use the real event. Keep the `Task` matcher only as a fallback
for older Claude Code builds, and say so in the generated `.claude/settings.json` example —
friends on the home network will not all be on the same version.
