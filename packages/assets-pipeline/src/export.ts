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

/** Builds a mesh-only scene (no clips) for one character skin's GLB. */
export function buildCharacterScene(mesh: THREE.SkinnedMesh, skeletonRoot: THREE.Object3D): THREE.Group {
  const group = new THREE.Group();
  group.add(skeletonRoot);
  group.add(mesh);
  return group;
}

/** Builds a clips-only scene (a bare armature, no mesh) for the shared animations GLB. */
export function buildAnimationsScene(skeletonRoot: THREE.Object3D): THREE.Group {
  const group = new THREE.Group();
  group.add(skeletonRoot);
  return group;
}
