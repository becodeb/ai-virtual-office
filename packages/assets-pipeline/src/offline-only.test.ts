/**
 * Contract test for the asset-pipeline spec's "Offline-Only Execution"
 * requirement: retargeting and FBX->GLB conversion run only in this
 * offline build step, never in the browser runtime.
 *
 * `client/` (the R3F renderer) does not exist yet in this phase — it lands
 * in Phase 4. This test therefore guards what already exists: the
 * committed output under `client/public/assets/` contains no raw `.fbx`
 * file, and no file outside `packages/assets-pipeline` imports an FBX
 * loader or references a `.fbx` path. Once the client workspace is
 * scaffolded, this same test starts covering its bundle/source without
 * modification.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, OUTPUT_ROOT } from './paths.js';

/**
 * Directory names skipped wherever they appear in the tree. `node_modules` must
 * match at any depth: `three` legitimately ships an `FBXLoader`, and every
 * workspace gets its own nested copy, so a repo-root-only match lets
 * `client/node_modules` fail this test for something no one wrote.
 */
const IGNORED_SEGMENTS = new Set(['node_modules', '.git', 'dist', 'build', '.vite']);
/** Paths skipped only at this exact location, relative to the repo root. */
const IGNORED_PATHS = ['assets', 'packages/assets-pipeline'];

function walk(dir: string, baseForIgnoreCheck: string, files: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files; // directory does not exist yet (e.g. client/ before Phase 4) — nothing to scan
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const rel = full.slice(baseForIgnoreCheck.length + 1).replaceAll('\\', '/');
    if (IGNORED_SEGMENTS.has(entry)) continue;
    if (IGNORED_PATHS.some((ignored) => rel === ignored || rel.startsWith(`${ignored}/`))) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, baseForIgnoreCheck, files);
    else files.push(full);
  }
  return files;
}

describe('Offline-Only Execution (asset-pipeline spec)', () => {
  it('the committed output directory contains no raw .fbx file', () => {
    const files = walk(OUTPUT_ROOT, OUTPUT_ROOT);
    const fbxFiles = files.filter((f) => f.toLowerCase().endsWith('.fbx'));
    expect(fbxFiles).toEqual([]);
  });

  it('no source file outside packages/assets-pipeline imports an FBX loader or references .fbx', () => {
    const files = walk(REPO_ROOT, REPO_ROOT).filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f));
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      if (/FBXLoader/.test(content) || /\.fbx['")]/i.test(content)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
