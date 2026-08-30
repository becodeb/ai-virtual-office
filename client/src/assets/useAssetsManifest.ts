import { useEffect, useState } from 'react';
import { clipNameSet, loadAssetsManifest, type AssetsManifest } from './manifest.js';
import { assertClipsExist } from '../anim/clipMap.js';

export interface AssetsManifestState {
  manifest: AssetsManifest | null;
  error: Error | null;
}

/**
 * Loads `assets.json` once and runs the clip-map startup assertion (task
 * 4.8) against the real manifest before the scene ever tries to play a
 * clip name that does not exist.
 */
export function useAssetsManifest(): AssetsManifestState {
  const [state, setState] = useState<AssetsManifestState>({ manifest: null, error: null });

  useEffect(() => {
    let cancelled = false;
    loadAssetsManifest()
      .then((manifest) => {
        assertClipsExist(clipNameSet(manifest));
        if (!cancelled) setState({ manifest, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ manifest: null, error: error instanceof Error ? error : new Error(String(error)) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
