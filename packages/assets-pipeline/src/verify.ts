/**
 * Stage 4 — verify.
 *
 * The pass/fail gate over retargeted clips, consuming the measured
 * baselines from `openspec/research/animation-retargeting.md` and the
 * asset-pipeline spec. These values are pre-normalisation (raw retarget
 * output, before the ~1.05-world-unit scale bake), in the loaded rig's
 * native units.
 */
import type * as THREE from 'three';

export interface ClipBaseline {
  clip: string;
  pelvisY: [number, number];
  footLY: [number, number];
}

/** Measured baselines: pelvis (`Body`) and left-foot (`FootL`) Y ranges, centimetres. */
export const RETARGET_BASELINES: readonly ClipBaseline[] = [
  { clip: 'Idle_Loop', pelvisY: [92, 92], footLY: [2, 2] },
  { clip: 'Walk_Loop', pelvisY: [91, 97], footLY: [2, 27] },
  { clip: 'Sitting_Idle_Loop', pelvisY: [57, 57], footLY: [2, 2] },
  { clip: 'Sitting_Enter', pelvisY: [57, 92], footLY: [2, 2] },
  { clip: 'Dance_Loop', pelvisY: [89, 96], footLY: [2, 2] },
];

/** Tolerance applied around each measured baseline range (design testing strategy). */
export const VERIFY_TOLERANCE_CM = 2;

/** Reads the Y component of every keyframe in a bone's position track. Empty if the track is absent. */
export function sampleBonePositionY(clip: THREE.AnimationClip, boneName: string): number[] {
  const track = clip.tracks.find((t) => t.name === `${boneName}.position`);
  if (!track) return [];
  const values = track.values;
  const out: number[] = [];
  for (let i = 1; i < values.length; i += 3) out.push(values[i]!);
  return out;
}

export interface VerifyResult {
  clip: string;
  pass: boolean;
  pelvisRange: [number, number];
  footLRange: [number, number];
  reasons: string[];
}

function rangeOf(values: number[]): [number, number] {
  if (values.length === 0) return [NaN, NaN];
  return [Math.min(...values), Math.max(...values)];
}

function withinTolerance(actual: [number, number], expected: [number, number], toleranceCm: number): boolean {
  const [actMin, actMax] = actual;
  const [expMin, expMax] = expected;
  return actMin >= expMin - toleranceCm && actMax <= expMax + toleranceCm;
}

/** Verifies one retargeted clip's pelvis and left-foot Y ranges against a measured baseline. */
export function verifyClip(
  clip: THREE.AnimationClip,
  baseline: ClipBaseline,
  toleranceCm: number = VERIFY_TOLERANCE_CM
): VerifyResult {
  const pelvis = sampleBonePositionY(clip, 'Body');
  const footL = sampleBonePositionY(clip, 'FootL');
  const pelvisRange = rangeOf(pelvis);
  const footLRange = rangeOf(footL);
  const reasons: string[] = [];

  if (pelvis.length === 0) reasons.push('no Body.position track found');
  if (footL.length === 0) reasons.push('no FootL.position track found');
  if (pelvis.length > 0 && !withinTolerance(pelvisRange, baseline.pelvisY, toleranceCm)) {
    reasons.push(`pelvis Y range [${pelvisRange}] outside baseline [${baseline.pelvisY}] ± ${toleranceCm}cm`);
  }
  if (footL.length > 0 && !withinTolerance(footLRange, baseline.footLY, toleranceCm)) {
    reasons.push(`FootL Y range [${footLRange}] outside baseline [${baseline.footLY}] ± ${toleranceCm}cm`);
  }

  return { clip: baseline.clip, pass: reasons.length === 0, pelvisRange, footLRange, reasons };
}

export function verifyClips(
  clipsByName: ReadonlyMap<string, THREE.AnimationClip>,
  baselines: readonly ClipBaseline[] = RETARGET_BASELINES,
  toleranceCm: number = VERIFY_TOLERANCE_CM
): VerifyResult[] {
  const results: VerifyResult[] = [];
  for (const baseline of baselines) {
    const clip = clipsByName.get(baseline.clip);
    if (!clip) {
      results.push({ clip: baseline.clip, pass: false, pelvisRange: [NaN, NaN], footLRange: [NaN, NaN], reasons: ['clip not found'] });
      continue;
    }
    results.push(verifyClip(clip, baseline, toleranceCm));
  }
  return results;
}

/**
 * Known failure mode: `SkeletonUtils.retargetClip` emitted a hip position
 * track that was constant across every frame of every clip (design.md,
 * "Retargeting implementation" decision). Detects that pattern: pelvis Y
 * has zero variance within each clip AND is identical across every clip.
 */
export function detectFlatPelvisAcrossAllClips(clipsByName: ReadonlyMap<string, THREE.AnimationClip>): boolean {
  const constantValues: number[] = [];
  for (const clip of clipsByName.values()) {
    const ys = sampleBonePositionY(clip, 'Body');
    if (ys.length === 0) return false;
    const [min, max] = rangeOf(ys);
    if (min !== max) return false; // this clip already varies — not the flat-pelvis failure mode
    constantValues.push(min);
  }
  if (constantValues.length < 2) return false;
  const first = constantValues[0];
  return constantValues.every((v) => v === first);
}

export function assertNoFlatPelvisAcrossAllClips(clipsByName: ReadonlyMap<string, THREE.AnimationClip>): void {
  if (detectFlatPelvisAcrossAllClips(clipsByName)) {
    throw new Error(
      'Retargeting regression: pelvis (Body) Y is constant across every sampled clip. ' +
        'This is the known SkeletonUtils.retargetClip failure mode (a flat hip track). Aborting export.'
    );
  }
}
