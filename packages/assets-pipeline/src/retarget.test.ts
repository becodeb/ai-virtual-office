import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildRetargeter, retargetClipWorldDelta } from './retarget.js';
import { sampleBonePositionY } from './verify.js';

/**
 * A minimal two-rig fixture exercising the same shape of problem as the real
 * pipeline (different hip heights, an IK foot bone hanging off the root)
 * without needing a real FBX/GLB file. This proves the ported algorithm's
 * maths independently of any asset.
 */
function makeBone(name: string, x = 0, y = 0, z = 0): THREE.Bone {
  const b = new THREE.Bone();
  b.name = name;
  b.position.set(x, y, z);
  return b;
}

function buildFixtureRig() {
  // Source ("Mannequin-like"): pelvis at y=1, spine child, foot_l sibling.
  const srcRoot = new THREE.Object3D();
  const pelvis = makeBone('pelvis', 0, 1, 0);
  const spine01 = makeBone('spine_01', 0, 0.5, 0);
  pelvis.add(spine01);
  const footL = makeBone('foot_l', -0.2, 0, 0);
  srcRoot.add(pelvis, footL);
  srcRoot.updateMatrixWorld(true);
  const srcSkinned = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  srcSkinned.bind(new THREE.Skeleton([pelvis, spine01, footL]));

  // Target ("Quaternius-like"): Body at y=2 (2x the source hip height), Hips child, FootL sibling.
  const tgtRoot = new THREE.Object3D();
  const body = makeBone('Body', 0, 2, 0);
  const hips = makeBone('Hips', 0, 1, 0);
  body.add(hips);
  const tgtFootL = makeBone('FootL', -0.4, 0, 0);
  tgtRoot.add(body, tgtFootL);
  tgtRoot.updateMatrixWorld(true);
  const tgtSkinned = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  tgtSkinned.bind(new THREE.Skeleton([body, hips, tgtFootL]));

  const boneMap = { Body: 'pelvis', Hips: 'spine_01', FootL: 'foot_l' };

  const rig = buildRetargeter({
    sourceRoot: srcRoot,
    sourceSkinned: srcSkinned,
    targetRoot: tgtRoot,
    targetSkinned: tgtSkinned,
    boneMap,
    hipBone: 'Body',
    ikBones: ['FootL'],
  });

  return { srcRoot, pelvis, footL, rig };
}

describe('buildRetargeter', () => {
  it('derives unitScale from the ratio of hip heights', () => {
    const { rig } = buildFixtureRig();
    expect(rig.unitScale).toBeCloseTo(2, 10); // target hip y=2 / source hip y=1
  });

  it('orders bones parent-first', () => {
    const { rig } = buildFixtureRig();
    expect(rig.order.indexOf('Body')).toBeLessThan(rig.order.indexOf('Hips'));
  });

  it('throws loudly on a bone-map miss instead of failing silently', () => {
    const { srcRoot, rig } = buildFixtureRig();
    void rig;
    const tgtRoot = new THREE.Object3D();
    const ghost = makeBone('Ghost', 0, 0, 0);
    tgtRoot.add(ghost);
    tgtRoot.updateMatrixWorld(true);
    const tgtSkinned = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    tgtSkinned.bind(new THREE.Skeleton([ghost]));
    const srcSkinned = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    srcSkinned.bind(new THREE.Skeleton(srcRoot.children.flatMap((c) => [c as THREE.Bone, ...c.children as THREE.Bone[]])));

    expect(() =>
      buildRetargeter({
        sourceRoot: srcRoot,
        sourceSkinned: srcSkinned,
        targetRoot: tgtRoot,
        targetSkinned: tgtSkinned,
        boneMap: { Ghost: 'does_not_exist' },
        hipBone: 'Ghost',
        ikBones: [],
      })
    ).toThrow(/bone map miss/);
  });
});

describe('retargetClipWorldDelta', () => {
  it('transfers hip and IK-foot translation scaled by unitScale, world-delta style', () => {
    const { srcRoot, rig } = buildFixtureRig();

    const pelvisTrack = new THREE.VectorKeyframeTrack('pelvis.position', [0, 1], [0, 1, 0, 0, 1.5, 0]);
    const footTrack = new THREE.VectorKeyframeTrack('foot_l.position', [0, 1], [-0.2, 0, 0, -0.2, 0.1, 0]);
    const clip = new THREE.AnimationClip('TestClip', 1, [pelvisTrack, footTrack]);

    // 4 frames over duration 1 (fps=4): samples at t=0, 1/3, 2/3, 1. The sampler's
    // underlying THREE.AnimationMixer uses LoopRepeat by default, which wraps
    // `time === duration` back to 0 — a pre-existing property of the ported
    // (unmodified) algorithm, harmless for seamless "_Loop" clips but not
    // asserted on here. Interior frames are unaffected and exercise the
    // interpolated world-delta maths directly.
    const retargeted = retargetClipWorldDelta(rig, clip, { fps: 4, mixerRoot: srcRoot });

    const bodyY = sampleBonePositionY(retargeted, 'Body');
    const footY = sampleBonePositionY(retargeted, 'FootL');

    // rest: Body.y = 2, FootL.y = 0 (target bind pose)
    expect(bodyY[0]).toBeCloseTo(2, 5);
    expect(footY[0]).toBeCloseTo(0, 5);

    // interior frame at t=2/3: source pelvis interpolated to 1 + 0.5*(2/3) = 1.3333,
    // travel +0.3333 -> scaled by unitScale(2) -> +0.6667 on top of rest (2) = 2.6667
    expect(bodyY[2]).toBeCloseTo(2 + (2 / 3), 3);
    // interior frame at t=2/3: source foot interpolated to 0.1*(2/3) = 0.0667,
    // scaled by unitScale(2) -> +0.1333 on top of rest (0)
    expect(footY[2]).toBeCloseTo((0.1 * (2 / 3)) * 2, 3);
  });

  it('emits one quaternion track per ordered bone plus one position track per hip/IK bone', () => {
    const { srcRoot, rig } = buildFixtureRig();
    const clip = new THREE.AnimationClip('TestClip', 1, [
      new THREE.VectorKeyframeTrack('pelvis.position', [0, 1], [0, 1, 0, 0, 1, 0]),
      new THREE.VectorKeyframeTrack('foot_l.position', [0, 1], [-0.2, 0, 0, -0.2, 0, 0]),
    ]);
    const retargeted = retargetClipWorldDelta(rig, clip, { fps: 2, mixerRoot: srcRoot });
    const quatTracks = retargeted.tracks.filter((t) => t.name.endsWith('.quaternion'));
    const posTracks = retargeted.tracks.filter((t) => t.name.endsWith('.position'));
    expect(quatTracks).toHaveLength(3); // Body, Hips, FootL
    expect(posTracks).toHaveLength(2); // Body (hip), FootL (ik)
  });
});
