/**
 * Mirrors `server/src/world/machine.ts`'s `effectiveRole()` client-side, and
 * approximates its Revenant skin swap for zombie hour (task 4.18).
 *
 * DEVIATION (documented): `server/src/net/hub.ts`'s `diffAgents()` only
 * diffs `state` and `label.taskText` — `role` and `skin` are never
 * re-broadcast after the agent's initial `agent_add`, even though the hub
 * itself swaps both at the `ZOMBIE` transition (`preZombieSkin`/`pickSkin('Revenant', ...)`
 * in `machine.ts`). The one field the client IS guaranteed to receive live
 * is `state` (via the `agent_state` delta op), so this module derives the
 * zombie-hour visual purely from `state === 'ZOMBIE'`, exactly like the
 * server's own `effectiveRole()`. The exact Revenant skin variant the
 * server picked cannot be reproduced client-side — `pickSkin` needs
 * `identityKey`, which is not part of `AgentSnapshot` — so this picks a
 * deterministic Revenant skin from the agent's own id instead of the
 * server's real (but unobservable) choice. Reported as a risk, not shipped
 * as if it were exact.
 */
import { pickSkin } from '@virtual-office/shared';
import type { AgentSnapshot, Role } from '@virtual-office/shared';

export function effectiveDisplayRole(agent: AgentSnapshot): Role {
  return agent.state === 'ZOMBIE' ? 'Revenant' : agent.role;
}

export function effectiveDisplaySkin(agent: AgentSnapshot): string {
  if (agent.state !== 'ZOMBIE') return agent.skin;
  // `pickSkin` only needs a stable string to vary Male/Female; the agentId is stable and deterministic enough for this cosmetic approximation.
  return pickSkin('Revenant', agent.agentId, agent.label.machineId).skin;
}
