/**
 * Stage 3 — retarget.
 *
 * Ported from `openspec/research/retarget-validated.mjs` unchanged in
 * behaviour. World-delta retargeting: for every frame, take the rotation
 * the source bone has travelled away from its own bind pose, in world
 * space, and replay that same travel on top of the target bone's bind
 * pose. Each side is expressed relative to its own rest orientation, so the
 * two skeletons never need matching bind poses — which is what makes the
 * Mannequin T-pose vs Quaternius ~74-degree-arms mismatch a non-issue.
 *
 * Do NOT use `SkeletonUtils.retargetClip`: measured to emit a hip position
 * track constant across every frame of every clip (decision, design.md).
 *
 * `Body` is the pelvis and carries hip translation; `FootL`/`FootR` are IK
 * targets driven by position (they hang off the armature root, not the leg
 * chain, per the research doc); bones are processed parent-first so a
 * bone's target world rotation is known before its children consume it.
 */
import * as THREE from 'three';

/**
 * Target (Quaternius, three.js-sanitised names) <- Source (Unreal Mannequin).
 * Sanitised means `Fist.L` (Blender/FBX) becomes `FistL` once three.js loads
 * it, because dots are `AnimationClip` track-name property separators and
 * strip silently otherwise.
 */
export const QUATERNIUS_FROM_MANNEQUIN_BONE_MAP: Record<string, string> = {
  Body: 'pelvis',
  Hips: 'spine_01',
  Abdomen: 'spine_02',
  Torso: 'spine_03',
  Neck: 'neck_01',
  Head: 'Head',
  ShoulderL: 'clavicle_l',
  UpperArmL: 'upperarm_l',
  LowerArmL: 'lowerarm_l',
  FistL: 'hand_l',
  ShoulderR: 'clavicle_r',
  UpperArmR: 'upperarm_r',
  LowerArmR: 'lowerarm_r',
  FistR: 'hand_r',
  UpperLegL: 'thigh_l',
  LowerLegL: 'calf_l',
  UpperLegR: 'thigh_r',
  LowerLegR: 'calf_r',
  FootL: 'foot_l',
  FootR: 'foot_r',
};

export const HIP_BONE = 'Body';
export const IK_BONES = ['FootL', 'FootR'] as const;

export interface RetargetRig {
  boneMap: Record<string, string>;
  hipBone: string;
  ikBones: readonly string[];
  srcBones: Map<string, THREE.Bone>;
  tgtBones: Map<string, THREE.Bone>;
  srcRestQ: Map<string, THREE.Quaternion>;
  tgtRestQ: Map<string, THREE.Quaternion>;
  srcHip: THREE.Bone;
  tgtHip: THREE.Bone;
  srcHipRest: THREE.Vector3;
  tgtHipRest: THREE.Vector3;
  /** Ratio of target-rig to source-rig hip height (measured: ~105.38). */
  unitScale: number;
  /** Bone processing order, parent-first. */
  order: string[];
  parentOf: Record<string, string | null>;
}

export interface BuildRetargeterOptions {
  sourceRoot: THREE.Object3D;
  sourceSkinned: THREE.SkinnedMesh;
  targetRoot: THREE.Object3D;
  targetSkinned: THREE.SkinnedMesh;
  boneMap?: Record<string, string>;
  hipBone?: string;
  ikBones?: readonly string[];
}

export function buildRetargeter({
  sourceRoot,
  sourceSkinned,
  targetRoot,
  targetSkinned,
  boneMap = QUATERNIUS_FROM_MANNEQUIN_BONE_MAP,
  hipBone = HIP_BONE,
  ikBones = IK_BONES,
}: BuildRetargeterOptions): RetargetRig {
  sourceRoot.updateMatrixWorld(true);
  targetRoot.updateMatrixWorld(true);

  const srcBones = new Map<string, THREE.Bone>(sourceSkinned.skeleton.bones.map((b) => [b.name, b]));
  const tgtBones = new Map<string, THREE.Bone>(targetSkinned.skeleton.bones.map((b) => [b.name, b]));

  const srcRestQ = new Map<string, THREE.Quaternion>();
  const tgtRestQ = new Map<string, THREE.Quaternion>();
  for (const [tgtName, srcName] of Object.entries(boneMap)) {
    const s = srcBones.get(srcName);
    const t = tgtBones.get(tgtName);
    if (!s || !t) throw new Error(`bone map miss: ${tgtName} -> ${srcName} (src=${!!s} tgt=${!!t})`);
    srcRestQ.set(tgtName, s.getWorldQuaternion(new THREE.Quaternion()));
    tgtRestQ.set(tgtName, t.getWorldQuaternion(new THREE.Quaternion()));
  }

  const srcHipName = boneMap[hipBone];
  if (!srcHipName) throw new Error(`bone map has no entry for hip bone "${hipBone}"`);
  const srcHip = srcBones.get(srcHipName);
  const tgtHip = tgtBones.get(hipBone);
  if (!srcHip || !tgtHip) throw new Error(`hip bone missing on one side: src=${!!srcHip} tgt=${!!tgtHip}`);
  const srcHipRest = srcHip.getWorldPosition(new THREE.Vector3());
  const tgtHipRest = tgtHip.getWorldPosition(new THREE.Vector3());
  const unitScale = tgtHipRest.y / srcHipRest.y;

  const order: string[] = [];
  const visit = (bone: THREE.Object3D) => {
    if (boneMap[bone.name]) order.push(bone.name);
    bone.children.forEach((c) => (c as THREE.Bone).isBone && visit(c));
  };
  targetSkinned.skeleton.bones.filter((b) => !(b.parent as THREE.Bone | null)?.isBone).forEach(visit);
  for (const n of Object.keys(boneMap)) if (!order.includes(n)) order.push(n);

  const parentOf: Record<string, string | null> = Object.fromEntries(
    order.map((n) => {
      let p = tgtBones.get(n)!.parent as THREE.Bone | null;
      while (p && !boneMap[p.name]) p = p.parent as THREE.Bone | null;
      return [n, p && boneMap[p.name] ? p.name : null];
    })
  );

  return {
    boneMap,
    hipBone,
    ikBones,
    srcBones,
    tgtBones,
    srcRestQ,
    tgtRestQ,
    srcHip,
    tgtHip,
    srcHipRest,
    tgtHipRest,
    unitScale,
    order,
    parentOf,
  };
}

export interface RetargetClipOptions {
  fps?: number;
  mixerRoot: THREE.Object3D;
}

export function retargetClipWorldDelta(
  rig: RetargetRig,
  clip: THREE.AnimationClip,
  { fps = 30, mixerRoot }: RetargetClipOptions
): THREE.AnimationClip {
  const { srcRestQ, tgtRestQ, srcBones, tgtBones, srcHipRest, tgtHipRest, unitScale, order, parentOf, hipBone, ikBones, boneMap } =
    rig;
  void srcHipRest;
  void tgtHipRest;

  // IK targets hang off the armature root rather than off the limb they drive,
  // so they are transferred by position the same way an IK handle is posed.
  const posBones = [hipBone, ...ikBones];
  const restPos = new Map<string, THREE.Vector3>(posBones.map((n) => [n, tgtBones.get(n)!.getWorldPosition(new THREE.Vector3())]));
  const srcRestPos = new Map<string, THREE.Vector3>(
    posBones.map((n) => [n, srcBones.get(boneMap[n]!)!.getWorldPosition(new THREE.Vector3())])
  );
  const mixer = new THREE.AnimationMixer(mixerRoot);
  const action = mixer.clipAction(clip);
  action.play();

  const frames = Math.max(2, Math.round(clip.duration * fps));
  const dt = clip.duration / (frames - 1);
  const times = new Float32Array(frames);
  const quatValues = new Map<string, Float32Array>(order.map((n) => [n, new Float32Array(frames * 4)]));
  const posValues = new Map<string, Float32Array>(posBones.map((n) => [n, new Float32Array(frames * 3)]));

  const worldQ = new Map<string, THREE.Quaternion>();
  const tmp = new THREE.Quaternion();
  const sw = new THREE.Quaternion();
  const pos = new THREE.Vector3();

  mixer.setTime(0);
  for (let f = 0; f < frames; f++) {
    mixer.setTime(f * dt);
    mixerRoot.updateMatrixWorld(true);
    times[f] = f * dt;

    for (const name of order) {
      srcBones.get(boneMap[name]!)!.getWorldQuaternion(sw);
      // delta = how far the source bone has rotated away from its own bind pose
      tmp.copy(sw).multiply(srcRestQ.get(name)!.clone().invert());
      const targetWorld = tmp.multiply(tgtRestQ.get(name)!);
      worldQ.set(name, targetWorld.clone());

      const p = parentOf[name];
      const local = p ? worldQ.get(p)!.clone().invert().multiply(targetWorld) : targetWorld.clone();
      local.toArray(quatValues.get(name)!, f * 4);
    }

    for (const n of posBones) {
      srcBones
        .get(boneMap[n]!)!
        .getWorldPosition(pos)
        .sub(srcRestPos.get(n)!)
        .multiplyScalar(unitScale)
        .add(restPos.get(n)!);
      pos.toArray(posValues.get(n)!, f * 3);
    }
  }

  action.stop();
  mixer.uncacheRoot(mixerRoot);

  const tracks: THREE.KeyframeTrack[] = order.map(
    (n) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, quatValues.get(n)!)
  );
  for (const n of posBones) tracks.push(new THREE.VectorKeyframeTrack(`${n}.position`, times, posValues.get(n)!));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
