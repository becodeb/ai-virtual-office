/**
 * Stage 2 — load.
 *
 * Headless three.js parsing, no DOM: `loader.parse(arrayBuffer, '')` for
 * both FBX characters and the GLTF-packaged UAL1/UAL2 animation clips.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Reads a file into a fresh ArrayBuffer (never a view over a larger Node Buffer pool). */
export function readArrayBuffer(path: string): ArrayBuffer {
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Parses an FBX character file headlessly. Returns the loaded scene graph. */
export function loadFbx(path: string): THREE.Group {
  const loader = new FBXLoader();
  return loader.parse(readArrayBuffer(path), '');
}

/** Parses a GLTF/GLB animation pack headlessly. `GLTFLoader.parse` is callback-based. */
export function loadGltf(path: string): Promise<GLTF> {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.parse(readArrayBuffer(path), '', resolve, reject);
  });
}

/** Finds the first `THREE.SkinnedMesh` in a loaded scene graph, or throws. */
export function findSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((obj) => {
    if (!found && (obj as THREE.SkinnedMesh).isSkinnedMesh) {
      found = obj as THREE.SkinnedMesh;
    }
  });
  if (!found) throw new Error('load: no SkinnedMesh found in scene graph');
  return found;
}

/** Extracts every bone name from a loaded scene graph, in traversal order. */
export function extractBoneNames(root: THREE.Object3D): string[] {
  const names: string[] = [];
  root.traverse((obj) => {
    if ((obj as THREE.Bone).isBone) names.push(obj.name);
  });
  return names;
}

/**
 * Reloads a written character GLB and reports the world-space height it will
 * actually render at.
 *
 * Geometry-level measurements are not enough: the FBX importer's node scale and
 * the Z-up to Y-up rotation both sit between the vertex data and the file, so a
 * character can measure exactly 1.05 in every intermediate check and still ship
 * 250 times too large. Only the reloaded artifact settles it.
 */
export async function measureExportedStandingHeight(glbPath: string): Promise<number> {
  const buffer = readFileSync(glbPath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const gltf = await new Promise<GLTF>((resolve, reject) => {
    new GLTFLoader().parse(arrayBuffer, '', resolve, reject);
  });
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  return box.max.y - box.min.y;
}
