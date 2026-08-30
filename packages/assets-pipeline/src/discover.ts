/**
 * Stage 1 — discover.
 *
 * Enumerates every raw FBX character file and asserts the single-rig
 * invariant: all 52 characters must share one identical skeleton, verified
 * by comparing sorted bone-name signatures. That invariant is what lets
 * retargeting run once instead of once per skin, and per the asset-pipeline
 * spec it must fail loud, not silently, if it ever stops holding.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RAW_MODELS_DIR } from './paths.js';

/** Deterministic signature for a bone-name set: sorted, joined, order-independent. */
export function boneSignature(boneNames: readonly string[]): string {
  return [...boneNames].sort().join('|');
}

export interface RigSignature {
  file: string;
  signature: string;
}

/**
 * Throws if more than one distinct signature is present. Returns the single
 * shared signature on success. Pure — takes signatures directly so it is
 * testable without loading any FBX file.
 */
export function assertSingleRig(rigs: readonly RigSignature[]): string {
  if (rigs.length === 0) {
    throw new Error('assertSingleRig: no rigs given, cannot establish an invariant over zero files');
  }
  const distinct = new Map<string, string[]>();
  for (const rig of rigs) {
    const files = distinct.get(rig.signature) ?? [];
    files.push(rig.file);
    distinct.set(rig.signature, files);
  }
  if (distinct.size > 1) {
    const summary = [...distinct.entries()]
      .map(([sig, files]) => `  - signature ${sig.slice(0, 40)}… (${files.length} files): ${files.slice(0, 3).join(', ')}${files.length > 3 ? ', …' : ''}`)
      .join('\n');
    throw new Error(
      `Single-rig invariant violated: found ${distinct.size} distinct skeletons across ${rigs.length} character files.\n${summary}`
    );
  }
  return rigs[0]!.signature;
}

/** Lists every `.fbx` file directly under `assets/models/`, absolute paths, sorted. */
export function listFbxFiles(modelsDir: string = RAW_MODELS_DIR): string[] {
  return readdirSync(modelsDir)
    .filter((name) => name.toLowerCase().endsWith('.fbx'))
    .sort()
    .map((name) => join(modelsDir, name));
}

/**
 * Full discovery: loads bone names for every FBX file via the injected
 * loader (kept injectable so this stage is testable without a real three.js
 * FBX parse), computes signatures, and asserts the single-rig invariant.
 */
export async function discoverCharacters(
  files: readonly string[],
  loadBoneNames: (file: string) => Promise<string[]>
): Promise<{ files: readonly string[]; sharedSignature: string }> {
  const rigs: RigSignature[] = [];
  for (const file of files) {
    const bones = await loadBoneNames(file);
    rigs.push({ file, signature: boneSignature(bones) });
  }
  const sharedSignature = assertSingleRig(rigs);
  return { files, sharedSignature };
}
