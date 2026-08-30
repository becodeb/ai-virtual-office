# World State Hub Specification

## Purpose

The single source of truth for the office: it classifies incoming hook events, owns the
in-memory agent state machine, allocates desks, persists per-identity records, and broadcasts
world state to connected clients over WebSocket.

## Requirements

### Requirement: Agent State Machine

The hub MUST maintain one agent record per session and transition it only in response to
received hook events or elapsed-time rules. Valid states include at least: `SPAWNING`,
`ACTIVE`, `DELEGATING` (has an active subagent), `IDLE`, `SLEEPING`, `ZOMBIE`, `DESPAWNING`,
and `QUEUED` (waiting in the lounge for a desk).

#### Scenario: SessionStart spawns an agent

- GIVEN no agent exists for a given `identityKey`
- WHEN a `SessionStart` event arrives
- THEN the hub creates an agent record in `SPAWNING`, then transitions it to `ACTIVE` once a
  desk (or lounge queue slot) is assigned

#### Scenario: SessionEnd or Stop despawns an agent

- GIVEN an agent in any active state
- WHEN a `SessionEnd` event arrives for its `identityKey`
- THEN the hub transitions it to `DESPAWNING` and removes it, freeing its desk

### Requirement: 15-Minute Heartbeat Timeout Chain

Any lifecycle event other than `SessionEnd` counts as a heartbeat. If the hub receives no
heartbeat for a given agent for 15 continuous minutes, it MUST transition that agent
`SLEEPING`. From `SLEEPING`, the hub MUST transition the agent to `ZOMBIE`, during which it
performs exactly one lap of the floor. On completing that lap, the hub MUST transition the
agent to `DESPAWNING` and remove it.

#### Scenario: Idle session falls asleep after 15 minutes

- GIVEN an agent in `ACTIVE` last heartbeat at time T
- WHEN no further event arrives by T+15min
- THEN the hub transitions the agent to `SLEEPING`

#### Scenario: Sleeping agent zombifies and despawns

- GIVEN an agent in `SLEEPING`
- WHEN the hub advances it to `ZOMBIE` and it completes one lap
- THEN the hub transitions it to `DESPAWNING` and removes its record and desk allocation

#### Scenario: A heartbeat before the 15-minute mark cancels the countdown

- GIVEN an agent in `ACTIVE` with 14 minutes since its last heartbeat
- WHEN a new lifecycle event arrives for that `identityKey`
- THEN the hub resets the heartbeat timer and the agent remains `ACTIVE`

### Requirement: Desk Allocation and Hot-Desking

The floor has a fixed desk count, default 12, from a declarative layout. The hub MUST assign
a free desk to a newly active agent. When an agent despawns, the hub MUST free its desk and
assign it to the longest-waiting agent currently `QUEUED` in the lounge, if any.

#### Scenario: Desk assigned on spawn when one is free

- GIVEN fewer than 12 agents currently hold a desk
- WHEN a new agent becomes `ACTIVE`
- THEN the hub assigns it an unoccupied desk

#### Scenario: Freed desk goes to the longest-waiting queued agent

- GIVEN 12 desks occupied and 2 agents `QUEUED`, queued at T1 and T2 (T1 < T2)
- WHEN an occupied desk's agent despawns
- THEN the hub assigns the freed desk to the agent queued at T1

### Requirement: Lounge Queue Overflow

When no desk is free at spawn time, the hub MUST place the agent in `QUEUED` state assigned
to a lounge seat, rather than expanding the desk count.

#### Scenario: 13th concurrent session queues in the lounge

- GIVEN 12 desks are occupied
- WHEN a 13th session sends `SessionStart`
- THEN the hub sets that agent to `QUEUED` and does not create a 13th desk

### Requirement: Cross-Restart Identity Persistence

The hub MUST derive a stable `identityKey` per session as a hash of `machineId + absolute
project path`. For each `identityKey`, the hub MUST persist a record (coffee count, completed
task count, rank, assigned skin) to a JSON file on a mounted volume, surviving hub process
restarts. Live world state (positions, current activity, in-memory agent state) MUST NOT be
persisted and MUST reset on hub restart.

#### Scenario: Identity record survives a hub restart

- GIVEN a persisted record exists for `identityKey` X with coffee count 5
- WHEN the hub process restarts and X's session sends a new heartbeat
- THEN the hub loads coffee count 5 for X from the persisted file

#### Scenario: Live position state does not survive a hub restart

- GIVEN an agent mid-walk toward a desk
- WHEN the hub process restarts
- THEN no in-memory position/animation state is recovered from disk for that agent

### Requirement: WebSocket Snapshot-Then-Delta Protocol

On WebSocket connection, the hub MUST send one full world-state snapshot before sending any
delta message. After the snapshot, the hub MUST send only delta messages describing changed
agents/desks. On reconnect, the hub MUST resend a full snapshot before resuming deltas.

#### Scenario: New client receives a full snapshot first

- GIVEN a client opens a new WebSocket connection
- WHEN the connection is established
- THEN the first message the client receives is a full snapshot of all agents and desks

#### Scenario: Reconnect triggers a fresh snapshot

- GIVEN a connected client that loses its WebSocket connection
- WHEN it reconnects
- THEN the hub sends a new full snapshot before any further delta
