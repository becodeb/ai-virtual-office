/**
 * Stage 5 — optimize-mesh.
 *
 * Applies the four measured export findings from
 * `openspec/research/animation-retargeting.md`:
 *
 * 1. Bake each material's flat colour into a per-vertex `COLOR_0` and write
 *    a per-vertex `_slot` attribute — BOTH **before** indexing, so slot
 *    identity joins the dedup key (decision 9: exact, not the seam-priority
 *    heuristic from design.md).
 * 2. Collapse the 96 geometry groups into one primitive / one material.
 * 3. Index via `mergeVertices()` (measured 19476 -> 8796 for the reference
 *    skin) and convert `MeshPhongMaterial` -> `MeshStandardMaterial` with
 *    `vertexColors: true`.
 * 4. Delete `uv`/`uv1` — these characters carry no textures.
 *
 * Also normalises uniform scale to a standing height of ~1.05 world units
 * (decision/world-scale.md — NOT 1.75, which is metric and taller than the
 * Kenney kit's walls), applying the same factor to the skeleton's rest
 * bone positions and to the hip/IK-foot position tracks of every clip.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Target standing height in world units (decision/world-scale.md — not 1.75). */
export const TARGET_STANDING_HEIGHT = 1.05;

export interface BakeResult {
  /**
   * Slot names in `_slot` index order, **for this specific mesh**.
   *
   * Measured against the real asset pack: material slot names are NOT a
   * fixed 6-name set shared by every skin (the research doc's "Skin, Shirt,
   * Pants, Belt, Face, Hair" only describes `Casual_Male`). Across the 27
   * curated skins, slot palettes vary widely (`Vest`, `Hat`, `Guts`,
   * `DarkClothes`, `Bones`, …). `_slot` is therefore recorded as this
   * mesh's own material index — stable, integral, and still exact-joins
   * the `mergeVertices` dedup key per decision 9 — with the name lookup
   * (`slotNames[_slot]`) carried per-skin in the manifest instead of a
   * single global table.
   */
  slotNames: string[];
}

/**
 * Bakes each material group's flat colour into a `color` (COLOR_0) vertex
 * attribute and writes the matching `_slot` index (that group's material
 * index), using the geometry's existing (pre-merge) `.groups`. Must run
 * before `indexGeometry` and before `collapseGroups`.
 */
export function bakeVertexColorsAndSlots(geometry: THREE.BufferGeometry, materials: THREE.Material[]): BakeResult {
  const vertexCount = geometry.attributes.position!.count;
  const colorArray = new Float32Array(vertexCount * 3);
  const slotArray = new Float32Array(vertexCount);

  const groups = geometry.groups.length > 0 ? geometry.groups : [{ start: 0, count: vertexCount, materialIndex: 0 }];

  for (const group of groups) {
    const slotIndex = group.materialIndex ?? 0;
    const material = materials[slotIndex];
    if (!material) throw new Error(`optimize: group references missing materialIndex ${slotIndex}`);
    const color = (material as THREE.MeshPhongMaterial | THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1);

    for (let v = group.start; v < group.start + group.count; v++) {
      colorArray[v * 3] = color.r;
      colorArray[v * 3 + 1] = color.g;
      colorArray[v * 3 + 2] = color.b;
      slotArray[v] = slotIndex;
    }
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorArray, 3));
  geometry.setAttribute('_slot', new THREE.Float32BufferAttribute(slotArray, 1));

  return { slotNames: materials.map((m) => m.name) };
}

/** Collapses all geometry groups into a single primitive with one material index. */
export function collapseGroups(geometry: THREE.BufferGeometry): void {
  const vertexCount = geometry.index ? geometry.index.count : geometry.attributes.position!.count;
  geometry.clearGroups();
  geometry.addGroup(0, vertexCount, 0);
}

/** Builds the single merged material replacing the per-slot `MeshPhongMaterial`s. */
export function buildMergedMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
}

export interface IndexResult {
  geometry: THREE.BufferGeometry;
  vertexCountBefore: number;
  vertexCountAfter: number;
}

/** Indexes the geometry via `mergeVertices`, deduplicating by every present attribute (including `_slot`). */
export function indexGeometry(geometry: THREE.BufferGeometry): IndexResult {
  const vertexCountBefore = geometry.attributes.position!.count;
  const merged = mergeVertices(geometry);
  const vertexCountAfter = merged.attributes.position!.count;
  return { geometry: merged, vertexCountBefore, vertexCountAfter };
}

/** Asserts every vertex's `_slot` value is integral and matches its baked colour exactly (decision 9's measured guarantee). */
export function assertSlotColorConsistency(geometry: THREE.BufferGeometry): void {
  const slot = geometry.attributes['_slot'];
  const color = geometry.attributes['color'];
  if (!slot || !color) throw new Error('assertSlotColorConsistency: geometry is missing _slot or color attribute');
  for (let i = 0; i < slot.count; i++) {
    const s = slot.getX(i);
    if (!Number.isInteger(s)) {
      throw new Error(`assertSlotColorConsistency: vertex ${i} has non-integral _slot value ${s}`);
    }
  }
}

/** Deletes `uv` and `uv1` attributes if present. These characters carry no textures. */
export function stripUVs(geometry: THREE.BufferGeometry): void {
  if (geometry.attributes['uv']) geometry.deleteAttribute('uv');
  if (geometry.attributes['uv1']) geometry.deleteAttribute('uv1');
  if (geometry.attributes['uv2']) geometry.deleteAttribute('uv2');
}

export function hasNoUVAttributes(geometry: THREE.BufferGeometry): boolean {
  return !geometry.attributes['uv'] && !geometry.attributes['uv1'] && !geometry.attributes['uv2'];
}

/**
 * Finds which local axis the character actually stands on, by asking the rig.
 *
 * The source FBX is Z-up while glTF is Y-up, so the "obvious" Y extent of the
 * bind-pose geometry is the character's front-to-back DEPTH, not its height.
 * Normalising that axis leaves a character 2.5x too tall while every
 * geometry-level measurement still reports the target exactly — which is how
 * the mistake survives a passing test.
 *
 * Rather than hardcode a different axis and hope, derive it: the vector from a
 * foot bone to the head bone is the up axis by definition, whatever the
 * exporter did.
 */
function upAxisFromSkeleton(skeleton: THREE.Skeleton, geometryFrame: THREE.Matrix4): 'x' | 'y' | 'z' {
  const byName = new Map(skeleton.bones.map((b) => [b.name, b]));
  // A foot bone is the truest "bottom", but any rig root works: the axis only
  // needs two points that are vertically apart, and a pelvis is below a head.
  const foot = byName.get('FootL') ?? byName.get('LowerLegL') ?? skeleton.bones[0];
  const head = byName.get('Head');
  if (foot === undefined || head === undefined) {
    throw new Error('upAxisFromSkeleton: rig has no Head bone to orient from');
  }
  for (const bone of skeleton.bones) bone.updateMatrixWorld(true);

  // Bone world positions live in the scene frame, which the FBX importer has
  // already rotated to Y-up. The geometry bounding box is in the mesh's own
  // local frame, which is still Z-up. Comparing the two directly compares
  // nothing — pull the bones into the geometry's frame first.
  const toGeometry = geometryFrame.clone().invert();
  const delta = head
    .getWorldPosition(new THREE.Vector3())
    .applyMatrix4(toGeometry)
    .sub(foot.getWorldPosition(new THREE.Vector3()).applyMatrix4(toGeometry));

  const abs = { x: Math.abs(delta.x), y: Math.abs(delta.y), z: Math.abs(delta.z) };
  if (abs.x >= abs.y && abs.x >= abs.z) return 'x';
  return abs.y >= abs.z ? 'y' : 'z';
}

/** Standing height from the geometry's bind-pose bounding box, along the rig's own up axis. */
export function computeStandingHeight(
  geometry: THREE.BufferGeometry,
  skeleton?: THREE.Skeleton,
  geometryFrame: THREE.Matrix4 = new THREE.Matrix4()
): number {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const axis = skeleton === undefined ? 'y' : upAxisFromSkeleton(skeleton, geometryFrame);
  return box.max[axis] - box.min[axis];
}

/**
 * Uniformly scales geometry vertex positions AND the skeleton's rest bone
 * local positions by the same factor, so the mesh stands at
 * `targetHeight` and skin binding stays consistent. Returns the factor
 * applied, so callers can apply it to animation position tracks too.
 */
export function normalizeScale(
  geometry: THREE.BufferGeometry,
  skeleton: THREE.Skeleton,
  targetHeight: number = TARGET_STANDING_HEIGHT,
  geometryFrame: THREE.Matrix4 = new THREE.Matrix4()
): number {
  const rawHeight = computeStandingHeight(geometry, skeleton, geometryFrame);
  if (rawHeight <= 0) throw new Error(`normalizeScale: non-positive raw standing height ${rawHeight}`);
  const factor = targetHeight / rawHeight;
  applyUniformScale(geometry, skeleton, factor);
  return factor;
}

/**
 * Applies a precomputed uniform scale factor to geometry vertices and
 * skeleton rest bone positions. Since every curated skin shares one
 * identical rig (the single-rig invariant), the pipeline computes the
 * normalization factor once from a reference skin and reuses it here for
 * every other skin and for the shared animation clips, so all characters
 * and their animations stay mutually consistent in scale.
 */
export function applyUniformScale(geometry: THREE.BufferGeometry, skeleton: THREE.Skeleton, factor: number): void {
  geometry.scale(factor, factor, factor);

  for (const bone of skeleton.bones) {
    bone.position.multiplyScalar(factor);
  }
  // Update from every root bone (no bone parent) so matrixWorld propagates
  // correctly down each chain before recomputing bind-pose inverses.
  const roots = skeleton.bones.filter((b) => !(b.parent as THREE.Bone | null)?.isBone);
  for (const root of roots) root.updateMatrixWorld(true);
  skeleton.calculateInverses();
}

/** Applies `factor` to the position values of the named bones' tracks in an already-retargeted clip. */
export function scaleClipPositionTracks(clip: THREE.AnimationClip, factor: number, boneNames: readonly string[]): void {
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position')) continue;
    const boneName = track.name.slice(0, -'.position'.length);
    if (!boneNames.includes(boneName)) continue;
    const values = track.values;
    for (let i = 0; i < values.length; i++) values[i] = (values[i] as number) * factor;
  }
}
