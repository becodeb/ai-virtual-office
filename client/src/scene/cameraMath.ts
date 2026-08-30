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

/**
 * The orthographic zoom that frames a whole floor in the current viewport.
 *
 * An orthographic camera shows `viewportPixels / zoom` world units, so a fixed
 * zoom crops whatever does not happen to fit. At zoom 60 a phone in portrait
 * shows about 15 world units — a 24-unit floor simply ran off the edge of the
 * screen, and the office looked like it had been cut in half.
 *
 * The floor is viewed from a 45-degree yaw, so the widest thing the camera has
 * to cover is its diagonal footprint. Framing the bounding circle of that
 * footprint handles every viewport aspect ratio, portrait included, without
 * special cases.
 */
export function fitZoomForFloor(
  floorWidth: number,
  floorHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 0.92
): number {
  if (floorWidth <= 0 || floorHeight <= 0) return 1;

  // An isometric floor does not project as a circle, it projects as a wide,
  // short diamond. Fitting its bounding circle wastes most of the screen on a
  // phone in portrait, where the limit is width and there is height to spare.
  // Fit the diamond's real extents instead.
  const projectedWidth = (floorWidth + floorHeight) * Math.SQRT1_2;
  const projectedHeight = projectedWidth * Math.sin(ISO_PITCH_RAD);

  return Math.min(
    (viewportWidth * margin) / projectedWidth,
    (viewportHeight * margin) / projectedHeight
  );
}

/**
 * The camera's downward pitch, from the isometric offset below:
 * `atan(y / horizontal reach)` for offset (0.6r, 0.75r, 0.6r).
 */
export const ISO_PITCH_RAD = Math.atan(0.75 / (0.6 * Math.SQRT2));

/**
 * Camera offset from the floor centre, scaled so it always clears the diorama.
 * A fixed offset that comfortably clears a small floor sits inside a large one.
 */
export function isoOffsetForFloor(floorWidth: number, floorHeight: number): Vec3Like {
  const reach = Math.max(floorWidth, floorHeight);
  return { x: reach * 0.6, y: reach * 0.75, z: reach * 0.6 };
}
