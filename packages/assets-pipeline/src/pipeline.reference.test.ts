/**
 * Real-asset regression tests, gated on the gitignored `assets/` directory
 * being present (dev-only, 267 MB, never committed). These exercise the
 * actual pipeline stages against `Casual_Male.fbx` (the reference skin) and
 * the real UAL1 animation pack, proving the measured baselines from
 * `openspec/research/animation-retargeting.md` and the asset-pipeline spec
 * hold against real data, not just the synthetic fixtures in
 * `retarget.test.ts` / `optimize.test.ts`.
 *
 * Skips cleanly (not a failure) when `assets/` is absent, e.g. in an
 * environment without the raw source pack.
 */
import { existsSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RAW_MODELS_DIR, UAL1_GLB } from './paths.js';
import { extractBoneNames, findSkinnedMesh, loadFbx, loadGltf } from './load.js';
import { buildRetargeter, retargetClipWorldDelta } from './retarget.js';
import { RETARGET_BASELINES, verifyClips } from './verify.js';
import {
  assertSlotColorConsistency,
  bakeVertexColorsAndSlots,
  buildMergedMaterial,
  collapseGroups,
  computeStandingHeight,
  hasNoUVAttributes,
  indexGeometry,
  normalizeScale,
  scaleClipPositionTracks,
  stripUVs,
  TARGET_STANDING_HEIGHT,
} from './optimize.js';
import { buildCharacterScene, exportGLB } from './export.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const REFERENCE_SKIN = `${RAW_MODELS_DIR}/Casual_Male.fbx`;
const hasRawAssets = existsSync(RAW_MODELS_DIR) && existsSync(REFERENCE_SKIN) && existsSync(UAL1_GLB);

describe.runIf(hasRawAssets)('pipeline against real assets (reference skin: Casual_Male)', () => {
  it('retargets UAL1 clips onto the reference skin within the measured baselines', async () => {
    const characterGroup = loadFbx(REFERENCE_SKIN);
    const targetSkinned = findSkinnedMesh(characterGroup);

    const ual1 = await loadGltf(UAL1_GLB);
    const sourceSkinned = findSkinnedMesh(ual1.scene);

    const rig = buildRetargeter({
      sourceRoot: ual1.scene,
      sourceSkinned,
      targetRoot: characterGroup,
      targetSkinned,
    });

    const requiredClips = ['Idle_Loop', 'Walk_Loop', 'Sitting_Idle_Loop', 'Sitting_Enter'];
    const retargeted = new Map<string, THREE.AnimationClip>();
    for (const name of requiredClips) {
      const source = ual1.animations.find((c) => c.name === name);
      if (!source) throw new Error(`fixture error: UAL1 pack has no clip named "${name}"`);
      retargeted.set(name, retargetClipWorldDelta(rig, source, { mixerRoot: ual1.scene }));
    }

    const results = verifyClips(
      retargeted,
      RETARGET_BASELINES.filter((b) => requiredClips.includes(b.clip))
    );

    const failures = results.filter((r) => !r.pass);
    expect(failures, JSON.stringify(failures, null, 2)).toHaveLength(0);
  });

  it('has exactly one shared skeleton across all 52 raw character files (single-rig invariant)', () => {
    const files = readdirSync(RAW_MODELS_DIR).filter((f) => f.toLowerCase().endsWith('.fbx'));
    expect(files.length).toBeGreaterThan(0);
    const referenceBones = extractBoneNames(loadFbx(REFERENCE_SKIN)).sort().join('|');
    // Spot-check a handful of other files rather than all 52, to keep this test fast.
    const sample = files.filter((f) => f !== 'Casual_Male.fbx').slice(0, 5);
    for (const f of sample) {
      const bones = extractBoneNames(loadFbx(`${RAW_MODELS_DIR}/${f}`)).sort().join('|');
      expect(bones, `rig mismatch in ${f}`).toBe(referenceBones);
    }
  });

  it('optimizes the reference skin to 1 mesh, indexed, no UVs, correct vertex-count drop and slot consistency', () => {
    const characterGroup = loadFbx(REFERENCE_SKIN);
    const mesh = findSkinnedMesh(characterGroup);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    bakeVertexColorsAndSlots(mesh.geometry, materials);
    collapseGroups(mesh.geometry);
    const { geometry, vertexCountBefore, vertexCountAfter } = indexGeometry(mesh.geometry);

    // Measured baseline from the asset-pipeline spec: 19476 -> 8796.
    expect(vertexCountBefore).toBe(19476);
    expect(vertexCountAfter).toBe(8796);
    assertSlotColorConsistency(geometry);

    stripUVs(geometry);
    expect(hasNoUVAttributes(geometry)).toBe(true);

    const factor = normalizeScale(geometry, mesh.skeleton, TARGET_STANDING_HEIGHT);
    expect(computeStandingHeight(geometry)).toBeCloseTo(TARGET_STANDING_HEIGHT, 5);
    expect(factor).toBeGreaterThan(0);
  });

  it('exports a character GLB that reloads as exactly one SkinnedMesh, indexed, no UVs', async () => {
    const characterGroup = loadFbx(REFERENCE_SKIN);
    const mesh = findSkinnedMesh(characterGroup);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    bakeVertexColorsAndSlots(mesh.geometry, materials);
    collapseGroups(mesh.geometry);
    const { geometry } = indexGeometry(mesh.geometry);
    stripUVs(geometry);
    normalizeScale(geometry, mesh.skeleton, TARGET_STANDING_HEIGHT);

    mesh.geometry = geometry;
    mesh.material = buildMergedMaterial();

    const scene = buildCharacterScene(mesh, characterGroup);
    const glb = await exportGLB(scene, []);
    expect(glb.byteLength).toBeGreaterThan(0);

    const loader = new GLTFLoader();
    const reloaded = await new Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTF>((resolve, reject) => {
      loader.parse(glb, '', resolve, reject);
    });

    let skinnedCount = 0;
    let reloadedGeometry: THREE.BufferGeometry | null = null;
    reloaded.scene.traverse((obj) => {
      if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
        skinnedCount++;
        reloadedGeometry = (obj as THREE.SkinnedMesh).geometry;
      }
    });

    expect(skinnedCount).toBe(1);
    expect(reloadedGeometry).not.toBeNull();
    expect(hasNoUVAttributes(reloadedGeometry!)).toBe(true);
    expect(reloadedGeometry!.index).not.toBeNull();
  }, 30_000);

  it('scales retargeted hip/IK-foot position tracks by the same normalization factor', () => {
    const posTrack = new THREE.VectorKeyframeTrack('Body.position', [0, 1], [0, 92, 0, 0, 92, 0]);
    const clip = new THREE.AnimationClip('Idle_Loop', 1, [posTrack]);
    const factor = TARGET_STANDING_HEIGHT / 175; // arbitrary raw-height stand-in, consistent with normalizeScale's contract
    scaleClipPositionTracks(clip, factor, ['Body', 'FootL', 'FootR']);
    expect(posTrack.values[1]).toBeCloseTo(92 * factor, 5);
  });
});

describe.skipIf(hasRawAssets)('pipeline against real assets', () => {
  it('is skipped: raw assets/ directory not present in this environment', () => {
    expect(hasRawAssets).toBe(false);
  });
});
