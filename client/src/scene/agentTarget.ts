/**
 * Resolves where an agent's rendered body should be heading, given only
 * what the frozen wire protocol actually broadcasts.
 *
 * DEVIATION (documented, not a silent guess): `server/src/net/hub.ts`'s
 * `diffAgents()` only diffs `state` and `label.taskText` — it never re-sends
 * `position` after the initial `agent_add`, and the `agent_path` delta op
 * exists in the protocol type but is never emitted. So the renderer cannot
 * play back the server's exact A* path. Instead, this module derives a
 * plausible destination from signals the wire DOES send continuously — desk
 * occupancy (`desk` ops) and agent state — and `scene/Agent.tsx` lerps the
 * character toward it at the same `AGENT_MOVE_CELLS_PER_SEC` the hub uses
 * for its own arrival-time estimate (`server/src/world/machine.ts`), snapping
 * exactly onto the seat socket on arrival (task 4.11). This is an honest
 * approximation of movement, not exact path fidelity — reported as a risk in
 * apply-progress, not silently shipped as if it were the real path.
 */
import type { AgentSnapshot } from '@virtual-office/shared';
import type { FloorLayout, SeatSocket, Vec3Like } from '../net/floorLayout.js';

/** Mirrors `server/src/world/machine.ts`'s `AGENT_MOVE_CELLS_PER_SEC` (documented there as a cosmetic, non-spec-pinned tuning constant). */
export const AGENT_MOVE_CELLS_PER_SEC = 2;

export interface AgentTarget {
  position: Vec3Like;
  facingRad: number;
  /** True when this is an exact socket (desk/lounge seat) the agent should snap onto; false for a coarse elevator/last-known fallback. */
  isSocket: boolean;
}

const SETTLED_AT_DESK_STATES = new Set(['SEATED_TYPING', 'SEATED_IDLE', 'SLEEPING']);
const LOUNGE_STATES = new Set(['LOUNGING', 'QUEUED']);

function fromSeat(seat: SeatSocket): AgentTarget {
  return { position: seat.position, facingRad: seat.facingRad, isSocket: true };
}

/**
 * Returns the best-known destination for `agent`, or `null` when no better
 * information exists than the agent's last broadcast position (e.g.
 * mid-delegation, mid-report, or on its zombie lap).
 */
export function resolveAgentTarget(
  agent: AgentSnapshot,
  layout: FloorLayout,
  desks: ReadonlyMap<string, string | null>
): AgentTarget | null {
  for (const desk of layout.desks) {
    if (desks.get(desk.id) === agent.agentId) return fromSeat(desk.seat);
  }

  if (SETTLED_AT_DESK_STATES.has(agent.state) && agent.deskId !== null) {
    const desk = layout.desks.find((d) => d.id === agent.deskId);
    if (desk !== undefined) return fromSeat(desk.seat);
  }

  if (LOUNGE_STATES.has(agent.state)) {
    // machine.ts always targets `loungeSeats[0]` for both overflow queueing
    // and subagent rest — a real quirk of Phase 2, not a client guess.
    const seat = layout.loungeSeats[0];
    if (seat !== undefined) return fromSeat(seat);
  }

  if (agent.state === 'SPAWNING') {
    return { position: { x: layout.elevatorCell[0] + 0.5, y: 0, z: layout.elevatorCell[1] + 0.5 }, facingRad: 0, isSocket: false };
  }

  return null;
}
