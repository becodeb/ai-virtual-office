/**
 * The office renderer's root component: wires the WS client, the asset
 * manifest, the R3F canvas, easter eggs (Konami code, `moo`), and the DOM
 * HUD together.
 */
import { useCallback, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { useWorld } from './net/useWorld.js';
import { useAssetsManifest } from './assets/useAssetsManifest.js';
import { useWorldStore } from './state/store.js';
import { useKeySequence } from './lib/useKeySequence.js';
import { KONAMI_SEQUENCE, MOO_SEQUENCE } from './lib/keySequence.js';
import type { CameraMode } from './scene/CameraRig.js';
import { Scene } from './scene/Scene.js';
import { Hud } from './hud/Hud.js';

export default function App(): JSX.Element {
  const { sendFocus, sendEgg } = useWorld();
  const { manifest, error } = useAssetsManifest();
  const layout = useWorldStore((s) => s.layout);
  const redactPrompts = useWorldStore((s) => s.redactPrompts);
  const focusAgentId = useWorldStore((s) => s.focusAgentId);
  const setFocusAgentId = useWorldStore((s) => s.setFocusAgentId);
  const [cameraMode, setCameraMode] = useState<CameraMode>('free');

  const onSelectAgent = useCallback(
    (agentId: string) => {
      setFocusAgentId(agentId);
      sendFocus(agentId);
      setCameraMode('focus');
    },
    [setFocusAgentId, sendFocus]
  );

  useKeySequence(KONAMI_SEQUENCE, useCallback(() => sendEgg('konami'), [sendEgg]));
  useKeySequence(MOO_SEQUENCE, useCallback(() => sendEgg('moo'), [sendEgg]));

  if (error !== null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black text-red-400">
        Failed to load office assets: {error.message}
      </div>
    );
  }

  if (manifest === null || layout === null) {
    return <div className="flex h-full w-full items-center justify-center bg-black text-white/60">Loading the office…</div>;
  }

  return (
    <div className="relative h-full w-full">
      <Canvas shadows>
        <Scene
          layout={layout}
          manifest={manifest}
          cameraMode={cameraMode}
          onCameraModeChange={setCameraMode}
          focusAgentId={focusAgentId}
          redactPrompts={redactPrompts}
          onSelectAgent={onSelectAgent}
        />
      </Canvas>
      <Hud />
    </div>
  );
}
