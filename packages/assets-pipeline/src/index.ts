#!/usr/bin/env node
/**
 * `pnpm assets:build` — the assets-pipeline CLI entry point.
 *
 * Runs all eight stages end to end: discover -> load -> retarget -> verify
 * -> optimize-mesh -> export -> props -> manifest. Reads raw FBX/GLB from
 * the gitignored `assets/` directory (dev-only) and writes committed,
 * browser-ready GLBs to `client/public/assets/`.
 *
 * Usage:
 *   pnpm assets:build                       # convert every curated skin
 *   pnpm assets:build --skins Worker_Male,Wizard   # convert a subset (fast, for local iteration)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { CURATED_SKINS, type SkinName } from '@virtual-office/shared';
import {
  OUTPUT_ANIMATIONS_GLB,
  OUTPUT_CHARACTERS_DIR,
  OUTPUT_MANIFEST_JSON,
  OUTPUT_PROPS_DIR,
  OUTPUT_ROOT,
  RAW_MODELS_DIR,
  RAW_OFFICE_DIR,
  UAL1_GLB,
  UAL2_GLB,
} from './paths.js';
import { assertSingleRig, boneSignature, listFbxFiles } from './discover.js';
import { extractBoneNames, findSkinnedMesh, loadFbx, loadGltf, measureExportedStandingHeight } from './load.js';
import { buildRetargeter, type RetargetRig, retargetClipWorldDelta, HIP_BONE, IK_BONES } from './retarget.js';
import { assertNoFlatPelvisAcrossAllClips, verifyClips } from './verify.js';
import {
  applyUniformScale,
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
import { buildAnimationsScene, buildCharacterScene, exportGLB } from './export.js';
import { copyProps } from './props.js';
import { buildManifest, fileSizeBytes, sha256OfFile, writeManifest, type ClipManifestEntry, type SkinManifestEntry } from './manifest.js';

const REFERENCE_SKIN = 'Casual_Male';

function parseSkinsArg(argv: string[]): SkinName[] {
  const flagIndex = argv.indexOf('--skins');
  if (flagIndex === -1) return [...CURATED_SKINS];
  const value = argv[flagIndex + 1];
  if (!value) throw new Error('--skins requires a comma-separated list, e.g. --skins Worker_Male,Wizard');
  return value.split(',').map((s) => s.trim()) as SkinName[];
}

async function main() {
  const t0 = Date.now();
  const skins = parseSkinsArg(process.argv.slice(2));
  console.log(`[assets-pipeline] converting ${skins.length} skin(s): ${skins.join(', ')}`);

  mkdirSync(OUTPUT_CHARACTERS_DIR, { recursive: true });
  mkdirSync(OUTPUT_PROPS_DIR, { recursive: true });

  // Stage 1 — discover: single-rig invariant across every raw FBX file.
  const tDiscover = Date.now();
  const allFiles = listFbxFiles(RAW_MODELS_DIR);
  const rigs = allFiles.map((file) => ({ file, signature: boneSignature(extractBoneNames(loadFbx(file))) }));
  assertSingleRig(rigs);
  console.log(`[assets-pipeline] stage 1 discover: ${allFiles.length} files, single rig confirmed (${Date.now() - tDiscover}ms)`);

  // Stage 2/3 — load the reference skin + both UAL packs, build the retarget rig once.
  const tLoad = Date.now();
  const referenceGroup = loadFbx(`${RAW_MODELS_DIR}/${REFERENCE_SKIN}.fbx`);
  const referenceSkinned = findSkinnedMesh(referenceGroup);
  const ual1 = await loadGltf(UAL1_GLB);
  const ual2 = await loadGltf(UAL2_GLB);
  const ual1Skinned = findSkinnedMesh(ual1.scene);
  console.log(`[assets-pipeline] stage 2 load: reference skin + UAL1/UAL2 (${Date.now() - tLoad}ms)`);

  const rig: RetargetRig = buildRetargeter({
    sourceRoot: ual1.scene,
    sourceSkinned: ual1Skinned,
    targetRoot: referenceGroup,
    targetSkinned: referenceSkinned,
  });

  // Stage 3 — retarget all clips from both packs (skip each pack's A_TPose reference clip).
  const tRetarget = Date.now();
  const allClips: THREE.AnimationClip[] = [];
  for (const source of [
    { gltf: ual1, mixerRoot: ual1.scene },
    { gltf: ual2, mixerRoot: ual2.scene },
  ]) {
    for (const clip of source.gltf.animations) {
      if (clip.name === 'A_TPose') continue;
      allClips.push(retargetClipWorldDelta(rig, clip, { mixerRoot: source.mixerRoot }));
    }
  }
  console.log(`[assets-pipeline] stage 3 retarget: ${allClips.length} clips (${Date.now() - tRetarget}ms)`);

  // Stage 4 — verify against the measured baselines; fail loud on the known flat-pelvis regression.
  const clipsByName = new Map(allClips.map((c) => [c.name, c]));
  assertNoFlatPelvisAcrossAllClips(clipsByName);
  const verifyResults = verifyClips(clipsByName);
  const verifyFailures = verifyResults.filter((r) => !r.pass);
  if (verifyFailures.length > 0) {
    throw new Error(`Retarget verification failed:\n${JSON.stringify(verifyFailures, null, 2)}`);
  }
  console.log(`[assets-pipeline] stage 4 verify: ${verifyResults.length} baseline clips passed`);

  // Determine the normalization factor once, from the reference skin's own geometry,
  // then reuse it for every other skin and for the shared clips (single-rig invariant).
  const referenceMaterials = Array.isArray(referenceSkinned.material) ? referenceSkinned.material : [referenceSkinned.material];
  const referenceBake = bakeVertexColorsAndSlots(referenceSkinned.geometry, referenceMaterials);
  collapseGroups(referenceSkinned.geometry);
  const referenceIndexed = indexGeometry(referenceSkinned.geometry);
  console.log(
    `[assets-pipeline] reference skin vertex count: ${referenceIndexed.vertexCountBefore} -> ${referenceIndexed.vertexCountAfter}`
  );
  stripUVs(referenceIndexed.geometry);
  referenceSkinned.updateMatrixWorld(true);
  const scaleFactor = normalizeScale(
    referenceIndexed.geometry,
    referenceSkinned.skeleton,
    TARGET_STANDING_HEIGHT,
    referenceSkinned.matrixWorld
  );
  console.log(`[assets-pipeline] normalization factor: ${scaleFactor.toFixed(6)} (target height ${TARGET_STANDING_HEIGHT})`);

  // Apply the same factor to every retargeted clip's hip/IK-foot position tracks.
  for (const clip of allClips) scaleClipPositionTracks(clip, scaleFactor, [HIP_BONE, ...IK_BONES]);

  // Stage 6 — export the shared animations.glb (clips only, no mesh). The
  // reference skin's SkinnedMesh is a sibling of the skeleton inside the
  // same loaded FBX scene graph; detach it so the exported GLB carries only
  // the armature + clips, never mesh geometry.
  const tExportAnim = Date.now();
  referenceSkinned.parent?.remove(referenceSkinned);
  const animationsScene = buildAnimationsScene(referenceGroup);
  const animGlb = await exportGLB(animationsScene, allClips);
  mkdirSync(OUTPUT_ROOT, { recursive: true });
  writeFileSync(OUTPUT_ANIMATIONS_GLB, Buffer.from(animGlb));
  console.log(`[assets-pipeline] stage 6 export animations.glb: ${(animGlb.byteLength / 1024).toFixed(0)} KB (${Date.now() - tExportAnim}ms)`);

  // Stage 5/6 — optimize + export each requested character skin.
  const skinManifestEntries: SkinManifestEntry[] = [];
  for (const skin of skins) {
    const tSkin = Date.now();
    const sourceFbx = `${RAW_MODELS_DIR}/${skin}.fbx`;

    let mesh: THREE.SkinnedMesh;
    let group: THREE.Group;
    let slotNames: string[];
    if (skin === REFERENCE_SKIN) {
      // Reuse the already-optimized/normalized reference geometry — avoid reprocessing.
      mesh = referenceSkinned;
      mesh.geometry = referenceIndexed.geometry;
      mesh.material = buildMergedMaterial();
      group = referenceGroup; // re-adds the mesh via buildCharacterScene below
      slotNames = referenceBake.slotNames;
    } else {
      group = loadFbx(sourceFbx);
      mesh = findSkinnedMesh(group);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const bake = bakeVertexColorsAndSlots(mesh.geometry, materials);
      slotNames = bake.slotNames;
      collapseGroups(mesh.geometry);
      const indexed = indexGeometry(mesh.geometry);
      stripUVs(indexed.geometry);
      applyUniformScale(indexed.geometry, mesh.skeleton, scaleFactor);
      mesh.geometry = indexed.geometry;
      mesh.material = buildMergedMaterial();
    }

    assertSlotColorConsistency(mesh.geometry);
    if (!hasNoUVAttributes(mesh.geometry)) throw new Error(`${skin}: UV attribute survived optimization`);

    const scene = buildCharacterScene(mesh, group);
    const glb = await exportGLB(scene, []);
    const outFile = `${OUTPUT_CHARACTERS_DIR}/${skin}.glb`;
    writeFileSync(outFile, Buffer.from(glb));

    skinManifestEntries.push({
      skin,
      file: `characters/${skin}.glb`,
      sizeBytes: glb.byteLength,
      sourceHash: sha256OfFile(sourceFbx),
      slotNames,
    });
    console.log(`[assets-pipeline] skin ${skin}: ${(glb.byteLength / 1024).toFixed(0)} KB (${Date.now() - tSkin}ms)`);
  }

  // Stage 7 — props.
  const tProps = Date.now();
  const propsResult = copyProps(RAW_OFFICE_DIR, OUTPUT_PROPS_DIR);
  console.log(`[assets-pipeline] stage 7 props: ${propsResult.copied.length} copied (${Date.now() - tProps}ms)`);

  // Stage 8 — manifest.
  const clipEntries: ClipManifestEntry[] = allClips.map((c) => ({ name: c.name, duration: c.duration }));
  const manifest = buildManifest({
    clips: clipEntries,
    skins: skinManifestEntries,
    animationsGlbFile: 'animations.glb',
    animationsGlbSizeBytes: fileSizeBytes(OUTPUT_ANIMATIONS_GLB),
    props: propsResult.copied,
  });
  writeManifest(OUTPUT_MANIFEST_JSON, manifest);

  // Measure what actually shipped, not what we intended. Every geometry-level
  // check reported the target exactly while the exported characters were 250x
  // too tall, because the importer's node scale and the Z-up/Y-up rotation both
  // sit between the geometry and the file. Reload the written GLB and measure
  // its world-space height; that is the only number the renderer ever sees.
  const shipped = await measureExportedStandingHeight(join(OUTPUT_CHARACTERS_DIR, `${REFERENCE_SKIN}.glb`));
  console.log(`[assets-pipeline] shipped standing height (${REFERENCE_SKIN}.glb, world space): ${shipped.toFixed(3)}`);
  if (Math.abs(shipped - TARGET_STANDING_HEIGHT) > 0.15) {
    throw new Error(
      `Exported character stands ${shipped.toFixed(3)} world units tall, expected ~${TARGET_STANDING_HEIGHT}. ` +
        `A character this size renders as an unrecognisable mass next to 1.29-unit walls.`
    );
  }
  console.log(`[assets-pipeline] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error('[assets-pipeline] FAILED:', err);
  process.exitCode = 1;
});
