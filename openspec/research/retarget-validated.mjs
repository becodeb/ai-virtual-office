import * as THREE from 'three';

/**
 * World-delta retargeting.
 *
 * Both rigs are read at their bind pose to capture a reference orientation per
 * bone. For every frame we take the rotation the source bone has travelled away
 * from its own bind pose, in world space, and replay that same travel on top of
 * the target bone's bind pose. Because each side is expressed relative to its
 * own rest orientation, the two skeletons never need matching bind poses — which
 * matters here, since the Mannequin rests in a T-pose and Quaternius rests with
 * the arms hanging at ~74 degrees.
 */
export function buildRetargeter({ sourceRoot, sourceSkinned, targetRoot, targetSkinned, boneMap, hipBone = 'Body', ikBones = [] }) {
  sourceRoot.updateMatrixWorld(true);
  targetRoot.updateMatrixWorld(true);

  const srcBones = new Map(sourceSkinned.skeleton.bones.map((b) => [b.name, b]));
  const tgtBones = new Map(targetSkinned.skeleton.bones.map((b) => [b.name, b]));

  // Bind-pose world orientation of every mapped bone on both sides.
  const srcRestQ = new Map();
  const tgtRestQ = new Map();
  for (const [tgtName, srcName] of Object.entries(boneMap)) {
    const s = srcBones.get(srcName);
    const t = tgtBones.get(tgtName);
    if (!s || !t) throw new Error(`bone map miss: ${tgtName} -> ${srcName} (src=${!!s} tgt=${!!t})`);
    srcRestQ.set(tgtName, s.getWorldQuaternion(new THREE.Quaternion()));
    tgtRestQ.set(tgtName, t.getWorldQuaternion(new THREE.Quaternion()));
  }

  // Hip translation is transferred as a bind-pose-relative delta, rescaled by the
  // ratio between the two rigs' hip heights. That keeps the vertical travel of a
  // sit or a walk bob intact without either rig's units leaking through.
  const srcHip = srcBones.get(boneMap[hipBone]);
  const tgtHip = tgtBones.get(hipBone);
  const srcHipRest = srcHip.getWorldPosition(new THREE.Vector3());
  const tgtHipRest = tgtHip.getWorldPosition(new THREE.Vector3());
  const unitScale = tgtHipRest.y / srcHipRest.y;

  // Ordered parent-first so a bone's target world rotation is known before its children.
  const order = [];
  const visit = (bone) => {
    if (boneMap[bone.name]) order.push(bone.name);
    bone.children.forEach((c) => c.isBone && visit(c));
  };
  targetSkinned.skeleton.bones.filter((b) => !b.parent?.isBone).forEach(visit);
  for (const n of Object.keys(boneMap)) if (!order.includes(n)) order.push(n);

  const parentOf = Object.fromEntries(
    order.map((n) => {
      let p = tgtBones.get(n).parent;
      while (p && !boneMap[p.name]) p = p.parent;
      return [n, p && boneMap[p.name] ? p.name : null];
    })
  );

  return { boneMap, hipBone, ikBones, srcBones, tgtBones, srcRestQ, tgtRestQ, srcHip, tgtHip, srcHipRest, tgtHipRest, unitScale, order, parentOf };
}

export function retargetClipWorldDelta(rig, clip, { fps = 30, mixerRoot }) {
  const { srcRestQ, tgtRestQ, srcBones, tgtBones, srcHip, srcHipRest, tgtHipRest, unitScale, order, parentOf, hipBone, ikBones, boneMap } = rig;
  // IK targets hang off the armature root rather than off the limb they drive,
  // so they are transferred by position the same way an IK handle is posed.
  const posBones = [hipBone, ...ikBones];
  const restPos = new Map(posBones.map((n) => [n, tgtBones.get(n).getWorldPosition(new THREE.Vector3())]));
  const srcRestPos = new Map(posBones.map((n) => [n, srcBones.get(boneMap[n]).getWorldPosition(new THREE.Vector3())]));
  const mixer = new THREE.AnimationMixer(mixerRoot);
  const action = mixer.clipAction(clip);
  action.play();

  const frames = Math.max(2, Math.round(clip.duration * fps));
  const dt = clip.duration / (frames - 1);
  const times = new Float32Array(frames);
  const quatValues = new Map(order.map((n) => [n, new Float32Array(frames * 4)]));
  const posValues = new Map(posBones.map((n) => [n, new Float32Array(frames * 3)]));

  const worldQ = new Map();
  const tmp = new THREE.Quaternion();
  const sw = new THREE.Quaternion();
  const pos = new THREE.Vector3();

  mixer.setTime(0);
  for (let f = 0; f < frames; f++) {
    mixer.setTime(f * dt);
    mixerRoot.updateMatrixWorld(true);
    times[f] = f * dt;

    for (const name of order) {
      srcBones.get(rigSrcName(rig, name)).getWorldQuaternion(sw);
      // delta = how far the source bone has rotated away from its own bind pose
      tmp.copy(sw).multiply(srcRestQ.get(name).clone().invert());
      const targetWorld = tmp.multiply(tgtRestQ.get(name));
      worldQ.set(name, targetWorld.clone());

      const p = parentOf[name];
      const local = p
        ? worldQ.get(p).clone().invert().multiply(targetWorld)
        : targetWorld.clone();
      local.toArray(quatValues.get(name), f * 4);
    }

    for (const n of posBones) {
      srcBones.get(boneMap[n]).getWorldPosition(pos)
        .sub(srcRestPos.get(n)).multiplyScalar(unitScale).add(restPos.get(n));
      pos.toArray(posValues.get(n), f * 3);
    }
  }

  action.stop();
  mixer.uncacheRoot(mixerRoot);

  const tracks = order.map((n) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, quatValues.get(n)));
  for (const n of posBones) tracks.push(new THREE.VectorKeyframeTrack(`${n}.position`, times, posValues.get(n)));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function rigSrcName(rig, targetName) { return rig.boneMap[targetName]; }
