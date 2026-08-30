/**
 * Stage 8 — manifest.
 *
 * Emits `assets.json`: the clip list and durations, the `_slot` index-to-name
 * map (decision 9 supersedes design.md's seam-priority `slotRanges` — after
 * `mergeVertices` a slot is no longer a contiguous vertex range, it is a
 * per-vertex attribute), output file sizes, and source file hashes for
 * provenance / skip-on-unchanged in a future incremental run.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';

export interface ClipManifestEntry {
  name: string;
  duration: number;
}

export interface SkinManifestEntry {
  skin: string;
  file: string;
  sizeBytes: number;
  sourceHash: string;
  /** `_slot` index -> material name, for THIS skin (slot palettes vary per skin — see optimize.ts). */
  slotNames: string[];
}

export interface AssetsManifest {
  generatedAt: string;
  clips: ClipManifestEntry[];
  skins: SkinManifestEntry[];
  animationsGlb: { file: string; sizeBytes: number; clipCount: number };
  props: string[];
}

export function sha256OfFile(path: string): string {
  const buf = readFileSync(path);
  return createHash('sha256').update(buf).digest('hex');
}

export function fileSizeBytes(path: string): number {
  return statSync(path).size;
}

export interface BuildManifestInput {
  clips: ClipManifestEntry[];
  skins: SkinManifestEntry[];
  animationsGlbFile: string;
  animationsGlbSizeBytes: number;
  props: string[];
  now?: () => Date;
}

export function buildManifest({
  clips,
  skins,
  animationsGlbFile,
  animationsGlbSizeBytes,
  props,
  now = () => new Date(),
}: BuildManifestInput): AssetsManifest {
  return {
    generatedAt: now().toISOString(),
    clips,
    skins,
    animationsGlb: { file: animationsGlbFile, sizeBytes: animationsGlbSizeBytes, clipCount: clips.length },
    props,
  };
}

export function writeManifest(path: string, manifest: AssetsManifest): void {
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}
