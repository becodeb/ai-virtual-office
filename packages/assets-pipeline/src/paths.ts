/**
 * Filesystem layout for the pipeline. All raw-asset paths point at the
 * gitignored `assets/` directory (dev-only, present locally, 267 MB). All
 * output paths point at `client/public/assets/`, which IS committed.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** Repo root, resolved relative to this source file (packages/assets-pipeline/src/). */
export const REPO_ROOT = join(here, '..', '..', '..');

export const RAW_ASSETS_DIR = join(REPO_ROOT, 'assets');
export const RAW_MODELS_DIR = join(RAW_ASSETS_DIR, 'models');
export const RAW_ANIMATIONS_DIR = join(RAW_ASSETS_DIR, 'animations');
export const RAW_OFFICE_DIR = join(RAW_ASSETS_DIR, 'office', 'kenneykit', 'Models', 'GLTF format');

export const UAL1_GLB = join(
  RAW_ANIMATIONS_DIR,
  'Universal Animation Library[Standard]',
  'Unreal-Godot',
  'UAL1_Standard.glb'
);
export const UAL2_GLB = join(
  RAW_ANIMATIONS_DIR,
  'Universal Animation Library 2[Standard]',
  'Unreal-Godot',
  'UAL2_Standard.glb'
);

export const OUTPUT_ROOT = join(REPO_ROOT, 'client', 'public', 'assets');
export const OUTPUT_CHARACTERS_DIR = join(OUTPUT_ROOT, 'characters');
export const OUTPUT_PROPS_DIR = join(OUTPUT_ROOT, 'props');
export const OUTPUT_ANIMATIONS_GLB = join(OUTPUT_ROOT, 'animations.glb');
export const OUTPUT_MANIFEST_JSON = join(OUTPUT_ROOT, 'assets.json');
