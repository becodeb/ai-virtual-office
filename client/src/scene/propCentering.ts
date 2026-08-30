/**
 * Centres Kenney props on their own grid cell.
 *
 * The kit does not author its props around their origin — most have the origin
 * at a corner of the footprint. `desk` sits 0.357 to one side and 0.184 to the
 * other; `floorFull` is offset by a full half tile in both axes. Placing a prop
 * at `cell + 0.5` therefore centres its ORIGIN on the cell and leaves the
 * visible object hanging off the edge, which reads on screen as furniture that
 * is not on the grid at all — and puts the floor tiles half a tile out of step
 * with everything standing on them.
 *
 * The offset is measured from the loaded geometry rather than hardcoded per
 * prop, so it stays correct if the asset pack is ever regenerated or swapped.
 * Only X and Z are corrected: every prop already sits on `minY = 0` and must
 * keep resting on the floor.
 */
import * as THREE from 'three';

/** Horizontal offset that must be subtracted to centre `object` on its cell. */
export function footprintOffset(object: THREE.Object3D): [number, number] {
  const box = new THREE.Box3().setFromObject(object);
  const centre = box.getCenter(new THREE.Vector3());
  return [centre.x, centre.z];
}

/**
 * Returns a copy of `geometry` shifted by a single, prop-wide offset.
 *
 * The offset MUST come from the whole prop, never from the sub-mesh: `wall` is
 * three sub-meshes that together form one wall, and centring each of them on
 * its own footprint would pull the prop apart.
 */
export function shiftGeometry(
  geometry: THREE.BufferGeometry,
  [dx, dz]: readonly [number, number]
): THREE.BufferGeometry {
  const shifted = geometry.clone();
  shifted.translate(-dx, 0, -dz);
  return shifted;
}
