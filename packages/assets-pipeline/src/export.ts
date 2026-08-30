/**
 * Stage 6 — export.
 *
 * `GLTFExporter` needs a `FileReader` polyfill in Node — used internally to
 * drain a `Blob` into an `ArrayBuffer` for GLB binary export. `document`'s
 * `createElement('canvas')` is only reached for textures, which these
 * models do not have, so no canvas shim is required.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

let shimInstalled = false;

/** Installs a minimal `FileReader` over `Blob.arrayBuffer()`. Idempotent. */
export function installFileReaderShim(): void {
  if (shimInstalled) return;
  if (typeof (globalThis as { FileReader?: unknown }).FileReader !== 'undefined') {
    shimInstalled = true;
    return;
  }

  class NodeFileReader {
    result: ArrayBuffer | string | null = null;
    onload: ((ev: { target: NodeFileReader }) => void) | null = null;
    onloadend: ((ev: { target: NodeFileReader }) => void) | null = null;
    onerror: ((err: unknown) => void) | null = null;

    readAsArrayBuffer(blob: Blob): void {
      blob
        .arrayBuffer()
        .then((buf) => {
          this.result = buf;
          this.onload?.({ target: this });
          this.onloadend?.({ target: this });
        })
        .catch((err) => this.onerror?.(err));
    }
  }

  (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
  shimInstalled = true;
}

export interface ExportGlbOptions {
  binary: true;
  animations?: THREE.AnimationClip[];
  onlyVisible?: boolean;
}

/** Exports a scene graph (optionally with animation clips) to a GLB ArrayBuffer. */
export function exportGLB(scene: THREE.Object3D, animations: THREE.AnimationClip[] = []): Promise<ArrayBuffer> {
  installFileReaderShim();
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error('exportGLB: expected a binary ArrayBuffer result, got JSON — check the `binary` option'));
      },
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
      { binary: true, animations, onlyVisible: false }
    );
  });
}

/**
 * Clears the unit-conversion scale the FBX importer leaves on the armature and
 * the skinned mesh.
 *
 * `applyUniformScale` already rewrote the geometry AND the bone positions into
 * final world units, so by the time a scene is exported the node scale is pure
 * leftover — and it is 100. Left in place it silently multiplies a correctly
 * normalised 1.05-unit character back up to ~105 units, producing a character
 * taller than the building it works in. The geometry measures right, the export
 * measures right in isolation, and only the assembled scene is wrong, which is
 * why this survived a passing normalisation test.
 *
 * Bones are skipped: their local scale is part of the rig, not the import.
 */
function clearImporterScale(root: THREE.Object3D): number {
  let removed = 1;
  root.traverse((node) => {
    if ((node as THREE.Bone).isBone) return;
    // Every non-bone node carries the same uniform import scale; record it once.
    if (node.scale.x !== 1) removed = node.scale.x;
    node.scale.set(1, 1, 1);
  });
  root.updateMatrixWorld(true);
  return removed;
}

/** Builds a mesh-only scene (no clips) for one character skin's GLB. */
export function buildCharacterScene(mesh: THREE.SkinnedMesh, skeletonRoot: THREE.Object3D): THREE.Group {
  const group = new THREE.Group();
  group.add(skeletonRoot);
  group.add(mesh);
  clearImporterScale(group);
  return group;
}

/**
 * Builds a clips-only scene (a bare armature, no mesh) for the shared
 * animations GLB, and reports the import scale it removed.
 *
 * The caller MUST apply that factor to the clips' position tracks. Clearing the
 * node scale on the armature without rescaling the tracks leaves the hip and
 * IK-foot translations a hundred times too large: the meshes are the right
 * size, but every animation lifts the root bone tens of units into the air, so
 * characters render floating in the sky above the office with their legs
 * trailing below the camera.
 */
export function buildAnimationsScene(skeletonRoot: THREE.Object3D): {
  scene: THREE.Group;
  removedScale: number;
} {
  const group = new THREE.Group();
  group.add(skeletonRoot);
  return { scene: group, removedScale: clearImporterScale(group) };
}
