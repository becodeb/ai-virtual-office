/**
 * The on-screen scale drei applies to an `<Html>` overlay.
 *
 * Mirrors `@react-three/drei`'s `Html` implementation: when `distanceFactor` is
 * given, the label is scaled by `objectScale(camera) * distanceFactor`, and for
 * an orthographic camera `objectScale` is simply `camera.zoom`. That multiplier
 * is the trap — a "reasonable looking" `distanceFactor` of 8 becomes a 296x
 * scale at a zoom of 37, and every character's name chip grows large enough to
 * black out the whole screen.
 *
 * Kept as a pure function purely so that arithmetic is pinned by a test rather
 * than rediscovered by staring at a dark phone.
 */
export function labelScreenScale(cameraZoom: number, distanceFactor: number | undefined): number {
  return distanceFactor === undefined ? 1 : cameraZoom * distanceFactor;
}

/** What `AgentLabel` passes. `undefined` means constant on-screen size. */
export const AGENT_LABEL_DISTANCE_FACTOR: number | undefined = undefined;
