# Asset Pipeline Specification

## Purpose

The offline, build-time-only pipeline that converts raw FBX characters and animation packs
into browser-ready GLBs, retargeting UAL1/UAL2 clips (Unreal Mannequin skeleton) onto the
shared Quaternius 20-bone character skeleton. The measured baselines below are the regression
contract for correctness.

## Requirements

### Requirement: Pelvis Height Regression Baseline

For clips retargeted from the UAL1 pack (Unreal Mannequin source skeleton) onto the shared
Quaternius 20-bone target skeleton, the pelvis (`Body`) bone's world-space Y position across
each clip's full duration MUST fall within the following measured ranges, in centimetres:
`Idle_Loop` 92..92, `Walk_Loop` 91..97, `Sitting_Idle_Loop` 57..57, `Sitting_Enter` 92..57.

#### Scenario: Idle_Loop pelvis stays constant

- GIVEN `Idle_Loop` retargeted from UAL1 onto the Quaternius skeleton
- WHEN pelvis Y is sampled across every frame
- THEN every sample is 92cm

#### Scenario: Walk_Loop pelvis bobs within range

- GIVEN `Walk_Loop` retargeted from UAL1 onto the Quaternius skeleton
- WHEN pelvis Y is sampled across every frame
- THEN every sample falls within 91..97cm

#### Scenario: A flat pelvis track across all clips is a detected failure

- GIVEN any retargeted clip
- WHEN pelvis Y is identical across `Idle_Loop`, `Walk_Loop`, `Sitting_Idle_Loop`, and
  `Sitting_Enter`
- THEN the pipeline's regression check MUST fail, since a constant pelvis across all clips is
  the known retargeting failure mode

### Requirement: Left Foot Height Regression Baseline

For the same UAL1-sourced, Quaternius-targeted clips, the left foot (`FootL`) world-space Y
position MUST fall within: `Walk_Loop` 2..27cm (foot lifts through the step), and 2..2cm
(constant, planted) for `Idle_Loop`, `Sitting_Idle_Loop`, and `Sitting_Enter`.

#### Scenario: Walk_Loop left foot lifts

- GIVEN `Walk_Loop` retargeted onto the Quaternius skeleton
- WHEN left foot Y is sampled across every frame
- THEN every sample falls within 2..27cm and the range's maximum exceeds its minimum

#### Scenario: Idle_Loop left foot stays planted

- GIVEN `Idle_Loop` retargeted onto the Quaternius skeleton
- WHEN left foot Y is sampled across every frame
- THEN every sample is 2cm

### Requirement: Single SkinnedMesh Per Exported Character

Each exported character GLB (Quaternius skin) MUST contain exactly one SkinnedMesh, not one
primitive per material group.

#### Scenario: Multi-material character exports as one mesh

- GIVEN a source character with 6 materials spread across 96 geometry groups
- WHEN it is exported to GLB
- THEN the exported file contains exactly 1 SkinnedMesh, not 96

### Requirement: No UV Attributes on Character Geometry

Exported character GLBs MUST NOT contain a UV attribute, since these characters carry no
textures and use flat per-vertex colour instead.

#### Scenario: Exported geometry has no UV data

- GIVEN any exported character GLB
- WHEN its mesh attributes are inspected
- THEN no `uv` attribute is present

### Requirement: Indexed Character Geometry

Exported character geometry MUST be indexed (vertex-merged via a deduplication step), not
exported as a naive non-indexed mesh.

#### Scenario: Exported geometry uses an index buffer

- GIVEN any exported character GLB
- WHEN its geometry is inspected
- THEN it defines an index buffer and its vertex count is reduced from the raw, non-indexed
  source count (measured: 19476 to 8796 for the reference character)

### Requirement: Shared Animations GLB

The pipeline MUST produce exactly one shared `animations.glb` file containing every
retargeted clip from both the UAL1 and UAL2 packs (84 clips total, excluding each pack's
`A_TPose` reference clip), targeted onto the single shared Quaternius 20-bone skeleton. Every
character skin MUST reuse this one file rather than each shipping its own clip set.

#### Scenario: All 84 clips are present in one file

- GIVEN the pipeline has run to completion
- WHEN `animations.glb` is inspected
- THEN it contains 84 clips, sourced from both UAL1 and UAL2, and no `A_TPose` clip

### Requirement: Offline-Only Execution

Retargeting and FBX-to-GLB conversion MUST run only in an offline build step. The browser
runtime MUST NOT parse FBX files or perform retargeting at runtime.

#### Scenario: No FBX parsing ships to the browser

- GIVEN the built client bundle
- WHEN its dependencies and asset references are inspected
- THEN no FBX loader or raw `.fbx` file is present
