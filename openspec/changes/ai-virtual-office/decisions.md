# Resolved Product Decisions

The proposal phase surfaced five open questions. All five are resolved here. Spec, design and
tasks must treat these as settled input and must not reopen them.

## 1. Session identity is stable across restarts

An `identityKey` is derived as a short hash of `machineId + absolute project path`. The hub
persists a small record per identity — coffee count, completed tasks, rank, assigned skin — to
a JSON file on a mounted volume.

**Why:** "Promotion" is unimplementable with purely ephemeral identity, and the coffee
leaderboard is worthless if it resets every time the hub restarts. This is the smallest amount
of persistence that makes the running jokes land, and it is the *only* state that outlives a
process. Live world state stays in memory as the proposal says.

## 2. One character per session

A friend running three Claude Code windows gets three characters. Sessions on the same machine
share a skin family so they read as coworkers, but each gets its own badge and desk.

**Why:** the product premise is "each session is a person". Collapsing them into one character
with three desks breaks the metaphor and makes subagent choreography ambiguous.

## 3. Task text is shown, with a redaction switch

Floating labels and speech bubbles show the current task summary, truncated to 80 characters.
Setting `OFFICE_REDACT_PROMPTS=true` degrades every label to tool names and metadata only.

**Why:** the task summary on the label was explicitly requested. But this runs on a monitor
several people can see, so the escape hatch ships in the same change rather than after the
first uncomfortable moment. Default is show; the switch is one environment variable.

## 4. Overflow queues in the lounge

The floor is generated from a declarative layout with a fixed desk count (default 12). More
concurrent sessions than desks and the extras path to the lounge, sit on the couches, and play
`Idle_TalkingPhone_Loop` until a desk frees. Desks are hot-desked: freed on despawn, taken by
the longest-waiting character.

**Why:** an unbounded floor that grows on demand ruins the diorama framing and the isometric
camera. A visible queue of people waiting for a desk is funnier and more honest than a room
that silently expands, and it degrades gracefully instead of dropping sessions.

## 5. The ship-it dance is inferred, and says so

A celebration fires when a command whose shape matches a known test runner exits zero. The HUD
labels the event as inferred, not verified.

**Why:** the hook observes tool invocations and exit codes, not test semantics. It will
occasionally celebrate something that was not really a green suite. That is acceptable —
it is a party, not a CI gate — but the UI must not claim more certainty than it has.

---

# Addendum: gaps surfaced by the spec phase

## 6. The fallback role is "Temp"

Any event whose tool and input shape match no entry in the cast table classifies as **Temp**:
skin `BaseCharacter`, badge `?`. The classifier is total — every input maps somewhere.

**Why:** the cast table has no default, and a classifier that can return nothing forces every
consumer to handle null. `BaseCharacter.fbx` is the untextured grey base model that ships in
the pack, so an unclassified worker literally shows up as a faceless temp nobody recognises.
The joke and the engineering want the same thing.

## 7. Heartbeat timeout sub-timings

| Step | Delay | Visible behaviour |
|---|---|---|
| last event -> `SLEEPING` | 15 min | slumps at the desk, `Sitting_Idle_Loop`, head down |
| `SLEEPING` -> `ZOMBIE` | +2 min | skin swaps to the Revenant, stands up |
| `ZOMBIE` lap | ~20 s | one slow `Zombie_Walk_Fwd_Loop` circuit of the floor |
| `ZOMBIE` -> `DESPAWNING` | on lap end | 3 s dissolve, desk released |

Total from last event to gone: about 17 and a half minutes.

**Why:** the proposal fixes only the 15-minute threshold. These sub-timings are chosen so the
turn is legible to someone glancing at a second monitor — long enough to notice, short enough
that a dead session does not haunt the floor. Any event arriving before `DESPAWNING`
cancels the whole chain and returns the character to `SEATED_IDLE`.
