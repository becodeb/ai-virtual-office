import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  RETARGET_BASELINES,
  assertNoFlatPelvisAcrossAllClips,
  detectFlatPelvisAcrossAllClips,
  sampleBonePositionY,
  verifyClip,
  verifyClips,
} from './verify.js';

function clipWithPositions(name: string, bodyYs: number[], footYs: number[]): THREE.AnimationClip {
  const n = bodyYs.length;
  const times = Array.from({ length: n }, (_, i) => i);
  const bodyValues = bodyYs.flatMap((y) => [0, y, 0]);
  const footValues = footYs.flatMap((y) => [0, y, 0]);
  return new THREE.AnimationClip(name, Math.max(1, n - 1), [
    new THREE.VectorKeyframeTrack('Body.position', times, bodyValues),
    new THREE.VectorKeyframeTrack('FootL.position', times, footValues),
  ]);
}

describe('sampleBonePositionY', () => {
  it('extracts every Y sample from a position track', () => {
    const clip = clipWithPositions('C', [1, 2, 3], [0, 0, 0]);
    expect(sampleBonePositionY(clip, 'Body')).toEqual([1, 2, 3]);
  });

  it('returns an empty array when the track is absent', () => {
    const clip = clipWithPositions('C', [1], [0]);
    expect(sampleBonePositionY(clip, 'Nonexistent')).toEqual([]);
  });
});

describe('verifyClip against measured baselines', () => {
  it('passes Idle_Loop: pelvis constant 92, foot constant 2', () => {
    const baseline = RETARGET_BASELINES.find((b) => b.clip === 'Idle_Loop')!;
    const clip = clipWithPositions('Idle_Loop', [92, 92, 92], [2, 2, 2]);
    const result = verifyClip(clip, baseline);
    expect(result.pass).toBe(true);
  });

  it('passes Walk_Loop: pelvis bobs 91..97, foot lifts 2..27', () => {
    const baseline = RETARGET_BASELINES.find((b) => b.clip === 'Walk_Loop')!;
    const clip = clipWithPositions('Walk_Loop', [91, 94, 97, 93], [2, 15, 27, 5]);
    const result = verifyClip(clip, baseline);
    expect(result.pass).toBe(true);
  });

  it('passes Sitting_Idle_Loop: pelvis constant 57', () => {
    const baseline = RETARGET_BASELINES.find((b) => b.clip === 'Sitting_Idle_Loop')!;
    const clip = clipWithPositions('Sitting_Idle_Loop', [57, 57], [2, 2]);
    const result = verifyClip(clip, baseline);
    expect(result.pass).toBe(true);
  });

  it('passes Sitting_Enter: pelvis travels from 92 down to 57', () => {
    const baseline = RETARGET_BASELINES.find((b) => b.clip === 'Sitting_Enter')!;
    const clip = clipWithPositions('Sitting_Enter', [92, 80, 57], [2, 2, 2]);
    const result = verifyClip(clip, baseline);
    expect(result.pass).toBe(true);
  });

  it('fails a clip whose pelvis range falls outside the baseline + tolerance', () => {
    const baseline = RETARGET_BASELINES.find((b) => b.clip === 'Idle_Loop')!;
    const clip = clipWithPositions('Idle_Loop', [92, 120], [2, 2]); // way outside 92±2
    const result = verifyClip(clip, baseline);
    expect(result.pass).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('verifyClips reports one result per baseline, in order', () => {
    const clips = new Map<string, THREE.AnimationClip>(
      RETARGET_BASELINES.map((b) => [b.clip, clipWithPositions(b.clip, [b.pelvisY[0], b.pelvisY[1]], [b.footLY[0], b.footLY[1]])])
    );
    const results = verifyClips(clips);
    expect(results).toHaveLength(RETARGET_BASELINES.length);
    expect(results.every((r) => r.pass)).toBe(true);
  });
});

describe('flat-pelvis regression detection (RED — known SkeletonUtils.retargetClip failure mode)', () => {
  it('detects a pelvis track that is constant across every sampled clip', () => {
    const clips = new Map<string, THREE.AnimationClip>([
      ['Idle_Loop', clipWithPositions('Idle_Loop', [92, 92], [2, 2])],
      ['Walk_Loop', clipWithPositions('Walk_Loop', [92, 92], [2, 2])],
      ['Sitting_Idle_Loop', clipWithPositions('Sitting_Idle_Loop', [92, 92], [2, 2])],
      ['Sitting_Enter', clipWithPositions('Sitting_Enter', [92, 92], [2, 2])],
    ]);
    expect(detectFlatPelvisAcrossAllClips(clips)).toBe(true);
    expect(() => assertNoFlatPelvisAcrossAllClips(clips)).toThrow(/known SkeletonUtils\.retargetClip failure mode|flat hip track/i);
  });

  it('does not flag legitimately varying, correctly retargeted clips', () => {
    const clips = new Map<string, THREE.AnimationClip>([
      ['Idle_Loop', clipWithPositions('Idle_Loop', [92, 92], [2, 2])],
      ['Walk_Loop', clipWithPositions('Walk_Loop', [91, 97], [2, 27])],
      ['Sitting_Idle_Loop', clipWithPositions('Sitting_Idle_Loop', [57, 57], [2, 2])],
    ]);
    expect(detectFlatPelvisAcrossAllClips(clips)).toBe(false);
    expect(() => assertNoFlatPelvisAcrossAllClips(clips)).not.toThrow();
  });
});
