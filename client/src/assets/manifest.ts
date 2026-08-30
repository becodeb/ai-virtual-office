/**
 * Typed access to the real, generated `client/public/assets/assets.json`
 * manifest (`packages/assets-pipeline`, Phase 1 — committed, not modified
 * here). The renderer never invents a clip, skin, or prop name; every one
 * of them is resolved from this manifest.
 */
export interface AssetClipEntry {
  name: string;
  duration: number;
}

export interface AssetSkinEntry {
  skin: string;
  file: string;
  sizeBytes: number;
  sourceHash: string;
  slotNames: string[];
}

export interface AssetsManifest {
  generatedAt: string;
  clips: AssetClipEntry[];
  skins: AssetSkinEntry[];
  animationsGlb: { file: string; sizeBytes: number; clipCount: number };
  /** Kenney prop base names (no extension) — the GLB lives at `props/<name>.glb`. */
  props: string[];
}

export const ASSETS_BASE_URL = '/assets/';

export function animationsGlbUrl(manifest: Pick<AssetsManifest, 'animationsGlb'>): string {
  return `${ASSETS_BASE_URL}${manifest.animationsGlb.file}`;
}

export function skinGlbUrl(skinFile: string): string {
  return `${ASSETS_BASE_URL}${skinFile}`;
}

export function propGlbUrl(propName: string): string {
  return `${ASSETS_BASE_URL}props/${propName}.glb`;
}

export function findSkin(manifest: AssetsManifest, skinName: string): AssetSkinEntry | undefined {
  return manifest.skins.find((s) => s.skin === skinName);
}

/** All clip names the manifest actually ships, as a `Set` for O(1) membership checks. */
export function clipNameSet(manifest: Pick<AssetsManifest, 'clips'>): Set<string> {
  return new Set(manifest.clips.map((c) => c.name));
}

let cachedManifest: Promise<AssetsManifest> | null = null;

/** Fetches and caches the manifest for the lifetime of the tab. */
export function loadAssetsManifest(): Promise<AssetsManifest> {
  cachedManifest ??= fetch(`${ASSETS_BASE_URL}assets.json`).then((res) => {
    if (!res.ok) throw new Error(`Failed to load assets manifest: HTTP ${res.status}`);
    return res.json() as Promise<AssetsManifest>;
  });
  return cachedManifest;
}
