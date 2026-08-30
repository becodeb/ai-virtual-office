# Animation Retargeting — Validated Research

Status: **validated by executable spike**. Every number below was measured, not assumed.
The working implementation is `retarget-validated.mjs` in this folder; it is the seed for
the real pipeline package.

## The problem

Character skins and animation clips ship on two different skeletons:

| | Characters (`assets/models/*.fbx`) | Animations (`assets/animations/**/UAL*.glb`) |
|---|---|---|
| Source | Quaternius, 52 files | Universal Animation Library 1 + 2, 86 clips |
| Rig | Custom 20-bone IK rig | Unreal Engine Mannequin |
| Units | centimetres | metres |
| Rest pose | arms ~74 deg below horizontal | true T-pose (arms at 0 deg) |
| Embedded clips | none | 43 per pack |

No clip can be played on a character without retargeting first.

## Findings that invalidate the obvious approach

1. **Three.js sanitises bone names.** `Fist.L` in the FBX is loaded as `FistL`. Dots are
   property separators in `AnimationClip` track names, so the loader strips them. A bone
   map written against the names Blender shows matches nothing — and fails *silently*,
   leaving the character frozen in its bind pose with no error.

2. **All 52 characters share one identical rig.** Verified by comparing sorted bone-name
   signatures across every file: exactly one distinct rig. Retargeting therefore runs
   **once**, and the resulting clips drive every skin. This is the single biggest cost
   saving in the pipeline.

3. **`Hips` is not the pelvis.** The real hierarchy is:

   ```
   Bone (root, 0 weight)
   |- Body            <- the actual pelvis
   |  |- UpperLegL -> LowerLegL      (chain ends here; no foot bone)
   |  |- UpperLegR -> LowerLegR
   |  `- Hips -> Abdomen -> Torso -> { ShoulderL/R -> UpperArm -> LowerArm -> Fist, Neck -> Head }
   |- FootL, FootR    <- IK targets, siblings of Body
   `- PoleTargetL/R   <- IK pole vectors, 0 weight
   ```

   `Hips`, `Abdomen` and `Torso` are spine bones. Mapping `Hips` to the Mannequin `pelvis`
   detaches the legs from the torso.

4. **Feet are IK targets that still deform the mesh.** `FootL`/`FootR` carry 66.8 weight
   over 156 vertices each, but they hang off the armature root, not off the leg chain. They
   must be driven by **position**, exactly as an IK handle is posed. `Bone`,
   `PoleTargetL` and `PoleTargetR` carry zero weight and are ignored.

5. **Skin indices are trustworthy.** Per-bone vertex bounds are anatomically ordered
   (`FootL` at Z 0, `LowerLegL` 0-1, `Torso` 2, `Head` 2-3, `FistL` out at X 1-2), and the
   weights sum to exactly the vertex count (19476). `Head` legitimately dominates 73% of
   the mesh because these characters have large, dense heads.

6. **`SkeletonUtils.retargetClip` is not usable here.** Its `options.hip` is compared
   against the *source* bone name after mapping, which is easy to get wrong, and its hip
   handling produced a position track that was constant across every frame of every clip.
   The world-delta implementation below is ~40 lines, deterministic, and verifiable.

## The approach

For every frame, take the rotation the source bone has travelled away from *its own* bind
pose, in world space, and replay that travel on top of the *target* bone's bind pose:

```
delta       = srcWorldQ * inverse(srcRestWorldQ)
targetWorld = delta * tgtRestWorldQ
targetLocal = inverse(parentTargetWorld) * targetWorld
```

Because each side is expressed relative to its own rest orientation, the two bind poses
never need to match — which is what makes the T-pose vs 74-degree-arms mismatch a non-issue.

Translation (pelvis and both IK feet) transfers as a bind-relative delta rescaled by the
ratio of hip heights between the rigs (**measured: 105.38**), so vertical travel survives
without either rig's units leaking through.

Bones must be processed **parent-first** so a bone's target world rotation is known before
its children consume it.

## Bone map

Target (Quaternius) <- Source (Mannequin):

```
Body <- pelvis        Hips <- spine_01      Abdomen <- spine_02    Torso <- spine_03
Neck <- neck_01       Head <- Head
ShoulderL <- clavicle_l   UpperArmL <- upperarm_l   LowerArmL <- lowerarm_l   FistL <- hand_l
ShoulderR <- clavicle_r   UpperArmR <- upperarm_r   LowerArmR <- lowerarm_r   FistR <- hand_r
UpperLegL <- thigh_l      LowerLegL <- calf_l
UpperLegR <- thigh_r      LowerLegR <- calf_r
FootL <- foot_l  (position + rotation)    FootR <- foot_r  (position + rotation)
```

## Verification baseline

Regression tests should assert these measured ranges (centimetres):

| Clip | Pelvis Y | Left foot Y | Meaning |
|---|---|---|---|
| `Idle_Loop` | 92..92 | 2..2 | still, feet planted |
| `Walk_Loop` | 91..97 | 2..27 | hip bob, foot lifts through the step |
| `Sitting_Idle_Loop` | 57..57 | 2..2 | seated, 35cm below standing |
| `Sitting_Enter` | 92..57 | 2..2 | the sit-down travel |
| `Dance_Loop` | 89..96 | 2..2 | bounce |

A retarget that leaves pelvis Y constant across all clips is the known failure mode.

## Other validated facts

- **Both loaders run headless in Node** via `loader.parse(arrayBuffer, '')`. No DOM needed.
- **`GLTFExporter` needs a `FileReader` polyfill** in Node (used to drain a `Blob` into an
  `ArrayBuffer`). ~20 lines over `Blob.arrayBuffer()`. `document.createElement('canvas')` is
  only reached for textures, which these models do not have.
- **Characters carry no textures.** Materials are flat colours on named slots: `Skin`,
  `Shirt`, `Pants`, `Belt`, `Face`, `Hair`. Recolouring per role is a hex swap, and the
  exported GLBs stay tiny. Materials load as `MeshPhongMaterial` and should be converted to
  `MeshStandardMaterial` (or a toon material) before export.
- **Kenney office props are already `.glb`** — 140 of them, zero conversion needed.
