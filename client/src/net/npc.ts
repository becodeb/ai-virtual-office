/**
 * Client-side mirror of `server/src/world/machine.ts`'s `NpcRecord` shape.
 * `WorldSnapshot.npcs` is `unknown[]` on the wire; the hub serialises
 * `world.npcs.values()` verbatim, so this mirrors that shape structurally.
 */
import type { Vec3Like } from './floorLayout.js';

export interface ArchitectNpc {
  npcId: string;
  kind: 'architect';
  cell: readonly [number, number];
  position: Vec3Like;
  facingRad: number;
  clip: 'Idle_FoldArms_Loop' | 'Idle_No_Loop';
  clipUntil: number | null;
}

export function isArchitectNpc(value: unknown): value is ArchitectNpc {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.kind === 'architect' && typeof v.npcId === 'string' && (v.clip === 'Idle_FoldArms_Loop' || v.clip === 'Idle_No_Loop');
}
