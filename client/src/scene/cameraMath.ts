/**
 * Pure Focus-Agent camera math (task 4.15's RED scenario: "the camera moves
 * to keep C in view as it moves"), extracted so it is testable without
 * mounting an R3F `<Canvas>`/WebGL context.
 */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** One damped step of the camera toward `agentPos + isoOffset`, per `useFrame`'s `delta`. */
export function stepTowardFocusTarget(current: Vec3Like, agentPos: Vec3Like, isoOffset: Vec3Like, dampingPerSecond: number, delta: number): Vec3Like {
  const target: Vec3Like = { x: agentPos.x + isoOffset.x, y: agentPos.y + isoOffset.y, z: agentPos.z + isoOffset.z };
  const t = Math.min(1, delta * dampingPerSecond);
  return { x: lerp(current.x, target.x, t), y: lerp(current.y, target.y, t), z: lerp(current.z, target.z, t) };
}

function distance(a: Vec3Like, b: Vec3Like): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export { distance };
