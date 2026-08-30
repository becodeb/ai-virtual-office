# Office Simulation Specification

## Purpose

The floor's spatial and behavioral rules: grid occupancy, pathfinding, seat alignment, and
the choreography that turns hub state transitions into physical movement.

## Requirements

### Requirement: Grid Occupancy

The floor MUST be modeled as a grid of 1x1m cells. Each cell MUST hold at most one occupant
(a character or a piece of static furniture) at a time.

#### Scenario: Two characters cannot occupy the same cell

- GIVEN character A occupies cell (3,4)
- WHEN character B's movement would place it in cell (3,4) while A is still there
- THEN the simulation prevents B from entering that cell until A vacates it

### Requirement: Pathfinding Around Furniture

A character moving to a destination cell MUST follow a path that avoids every cell currently
occupied by static furniture, reaching the destination without passing through blocked cells.

#### Scenario: Path routes around a desk

- GIVEN a straight line between a character's origin and destination passes through a
  furniture-occupied cell
- WHEN the character paths to that destination
- THEN its resulting route contains no furniture-occupied cell

#### Scenario: No valid path exists

- GIVEN a destination cell is fully enclosed by furniture with no open adjacent cell
- WHEN a character is asked to path there
- THEN the simulation reports that the destination is unreachable rather than moving the
  character through blocked cells

### Requirement: Seat-Socket Alignment on Arrival

When a character arrives at a desk or lounge seat, its final position and orientation MUST
match that seat's defined socket transform, with no visible offset or clipping into the
chair or desk.

#### Scenario: Character sits aligned to the chair

- GIVEN a character pathing to an assigned desk
- WHEN it reaches the desk's chair
- THEN its position and facing exactly match the chair's seat-socket transform

### Requirement: Subagent Choreography Sequence

When a session delegates to a subagent (`SubagentStart`), the simulation MUST perform, in
order: (1) the subagent character walks to its parent session's desk, (2) it displays a
speech bubble carrying the delegated task summary (subject to the 80-character truncation and
redaction rules), (3) it walks to and occupies a free secondary desk. On `SubagentStop`, it
MUST: (4) walk back to the parent's desk to report, (5) then move to a lounge seat and rest
there for exactly 15 seconds, (6) then exit the floor (despawn).

#### Scenario: Full subagent lifecycle plays out in order

- GIVEN a parent session at desk D1 sends `SubagentStart`
- WHEN the subagent completes and sends `SubagentStop`
- THEN the sequence observed is: walk to D1, speech bubble, walk to a secondary desk, walk
  back to D1, walk to a lounge seat, rest 15 seconds, exit

#### Scenario: No secondary desk is free

- GIVEN all desks other than the parent's are occupied
- WHEN a subagent needs a secondary desk
- THEN the subagent queues in the lounge under the same overflow rule as any other agent,
  until a desk frees
