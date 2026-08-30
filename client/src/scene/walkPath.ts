/**
 * Walking a broadcast A* route.
 *
 * The hub plans a real path around the furniture and now broadcasts it
 * (`agent_path`). Following it matters for two reasons that are both very
 * visible: a character that lerps straight from desk to kitchen walks through
 * the counter, and — worse — it has nothing to turn towards, so it keeps facing
 * wherever it will eventually sit and appears to moonwalk across the office.
 *
 * Progress is derived from elapsed time and the hub's own `speed`, so the
 * client never invents a position: it replays the same walk the server timed.
 */
export interface Vec2 {
  x: number;
  z: number;
}

export interface WalkSample {
  position: Vec2;
  /** Rotation about Y, facing along the direction of travel. */
  facingRad: number;
  /** True once the whole route has been walked. */
  arrived: boolean;
}

const centre = (cell: readonly [number, number]): Vec2 => ({ x: cell[0] + 0.5, z: cell[1] + 0.5 });

/** Rotation about Y for a direction vector, matching the world's 0 = +z convention. */
export function headingFor(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/**
 * Where along `cells` a walker is after `elapsedSeconds` at `speed` cells per
 * second, and which way it is facing.
 */
export function sampleWalk(
  cells: ReadonlyArray<readonly [number, number]>,
  speed: number,
  elapsedSeconds: number,
  fallbackFacing: number
): WalkSample | null {
  if (cells.length === 0) return null;
  if (cells.length === 1) {
    return { position: centre(cells[0]!), facingRad: fallbackFacing, arrived: true };
  }

  let remaining = Math.max(0, elapsedSeconds) * speed;

  for (let i = 0; i < cells.length - 1; i++) {
    const from = centre(cells[i]!);
    const to = centre(cells[i + 1]!);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length === 0) continue;

    if (remaining <= length) {
      const t = remaining / length;
      return {
        position: { x: from.x + dx * t, z: from.z + dz * t },
        facingRad: headingFor(dx, dz),
        arrived: false,
      };
    }
    remaining -= length;
  }

  // Past the end: hold the last cell, keeping the heading of the final leg so
  // the character does not spin on the spot the instant it arrives.
  const last = cells[cells.length - 1]!;
  const prev = cells[cells.length - 2]!;
  return {
    position: centre(last),
    facingRad: headingFor(last[0] - prev[0], last[1] - prev[1]),
    arrived: true,
  };
}
