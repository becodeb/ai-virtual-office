import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  TARGET_STANDING_HEIGHT,
  assertSlotColorConsistency,
  bakeVertexColorsAndSlots,
  collapseGroups,
  computeStandingHeight,
  hasNoUVAttributes,
  indexGeometry,
  normalizeScale,
  scaleClipPositionTracks,
  stripUVs,
} from './optimize.js';

function makeMaterial(name: string, hex: number): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({ name, color: hex });
}

/**
 * 3 triangles, 9 non-indexed vertices, two material groups:
 * - two "Skin" triangles sharing two positions (a within-slot duplicate)
 * - one "Shirt" triangle at the exact same positions as the first Skin
 *   triangle (a cross-slot seam) — decision 9 requires these stay distinct.
 */
function makeFixtureGeometry(): { geometry: THREE.BufferGeometry; materials: THREE.Material[] } {
  const positions = new Float32Array([
    // Skin triangle A: p0, p1, p2
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    // Skin triangle A2 (shares p0, p1, new p3)
    0, 0, 0, 1, 0, 0, 1, 1, 0,
    // Shirt triangle B: same positions as Skin triangle A (a seam)
    0, 0, 0, 1, 0, 0, 0, 1, 0,
  ]);
  const normals = new Float32Array(9 * 3).fill(0);
  for (let i = 2; i < normals.length; i += 3) normals[i] = 1; // all facing +Z

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.addGroup(0, 3, 0);
  geometry.addGroup(3, 3, 0);
  geometry.addGroup(6, 3, 1);

  const materials = [makeMaterial('Skin', 0xff0000), makeMaterial('Shirt', 0x0000ff)];
  return { geometry, materials };
}

describe('bakeVertexColorsAndSlots', () => {
  it('writes one _slot index (the material index) and one baked colour per vertex, per-mesh — not a fixed global slot list', () => {
    const { geometry, materials } = makeFixtureGeometry();
    const result = bakeVertexColorsAndSlots(geometry, materials);
    expect(result.slotNames).toEqual(['Skin', 'Shirt']);

    const slot = geometry.attributes['_slot']!;
    const color = geometry.attributes['color']!;
    expect(slot.getX(0)).toBe(0); // Skin is materials[0]
    expect(slot.getX(6)).toBe(1); // Shirt is materials[1]
    expect(color.getX(0)).toBeCloseTo(1, 5); // Skin is red -> r=1
    expect(color.getX(6)).toBeCloseTo(0, 5); // Shirt is blue -> r=0
  });

  it('accepts arbitrary material names — real skins do not share one fixed slot palette', () => {
    const { geometry } = makeFixtureGeometry();
    const result = bakeVertexColorsAndSlots(geometry, [makeMaterial('Vest', 0xffffff), makeMaterial('Guts', 0x0000ff)]);
    expect(result.slotNames).toEqual(['Vest', 'Guts']);
  });
});

describe('collapseGroups + indexGeometry (decision 9: _slot joins the dedup key)', () => {
  it('merges within-slot duplicate vertices but keeps cross-slot seam vertices distinct', () => {
    const { geometry, materials } = makeFixtureGeometry();
    bakeVertexColorsAndSlots(geometry, materials);
    collapseGroups(geometry);
    expect(geometry.groups).toHaveLength(1);

    const { geometry: merged, vertexCountBefore, vertexCountAfter } = indexGeometry(geometry);
    expect(vertexCountBefore).toBe(9);
    // Skin's two triangles share p0 and p1 (2 vertices deduped); Shirt's
    // seam triangle sits at the same positions as Skin's first triangle but
    // must NOT merge because _slot differs. Unique = 4 (Skin) + 3 (Shirt) = 7.
    expect(vertexCountAfter).toBe(7);
    expect(merged.index).not.toBeNull();

    assertSlotColorConsistency(merged);
  });
});

describe('stripUVs', () => {
  it('removes uv, uv1 and uv2 attributes when present', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0], 2));
    geometry.setAttribute('uv1', new THREE.Float32BufferAttribute([0, 0], 2));
    expect(hasNoUVAttributes(geometry)).toBe(false);
    stripUVs(geometry);
    expect(hasNoUVAttributes(geometry)).toBe(true);
  });

  it('is a no-op when no UV attribute exists', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    expect(() => stripUVs(geometry)).not.toThrow();
    expect(hasNoUVAttributes(geometry)).toBe(true);
  });
});

describe('normalizeScale', () => {
  it('scales geometry and skeleton rest positions so standing height matches the target', () => {
    const geometry = new THREE.BufferGeometry();
    // A 175-unit-tall raw geometry (arbitrary "cm-like" source scale).
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 175, 0, 5, 0, 0], 3));

    const root = new THREE.Bone();
    root.name = 'Body';
    root.position.set(0, 90, 0);
    const child = new THREE.Bone();
    child.name = 'Head';
    child.position.set(0, 60, 0); // local offset from Body
    root.add(child);
    root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton([root, child]);

    const factor = normalizeScale(geometry, skeleton, TARGET_STANDING_HEIGHT);

    expect(computeStandingHeight(geometry)).toBeCloseTo(TARGET_STANDING_HEIGHT, 5);
    expect(root.position.y).toBeCloseTo(90 * factor, 5);
    expect(child.position.y).toBeCloseTo(60 * factor, 5);
  });

  it('throws on a degenerate zero-height geometry rather than dividing by zero silently', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 5, 0, 1, 5, 0], 3));
    const skeleton = new THREE.Skeleton([]);
    expect(() => normalizeScale(geometry, skeleton)).toThrow(/non-positive raw standing height/);
  });
});

describe('scaleClipPositionTracks', () => {
  it('scales only the named bones position tracks, leaving quaternion tracks untouched', () => {
    const posTrack = new THREE.VectorKeyframeTrack('Body.position', [0, 1], [0, 90, 0, 0, 95, 0]);
    const otherPosTrack = new THREE.VectorKeyframeTrack('Unrelated.position', [0, 1], [1, 1, 1, 1, 1, 1]);
    const quatTrack = new THREE.QuaternionKeyframeTrack('Body.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
    const clip = new THREE.AnimationClip('C', 1, [posTrack, otherPosTrack, quatTrack]);

    scaleClipPositionTracks(clip, 0.01, ['Body']);

    const scaled = Array.from(posTrack.values);
    [0, 0.9, 0, 0, 0.95, 0].forEach((expected, i) => expect(scaled[i]).toBeCloseTo(expected, 5));
    expect(Array.from(otherPosTrack.values)).toEqual([1, 1, 1, 1, 1, 1]); // untouched — not in boneNames
    expect(Array.from(quatTrack.values)).toEqual([0, 0, 0, 1, 0, 0, 0, 1]); // untouched — not a position track
  });
});
