import type { AssetsManifest } from '../assets/manifest.js';
import type { FloorLayout } from '../net/floorLayout.js';
import { Agents } from './Agents.js';
import { CameraRig, type CameraMode } from './CameraRig.js';
import { Floor } from './Floor.js';
import { Fx } from './Fx.js';
import { Npcs } from './Npcs.js';
import { Props } from './Props.js';
import * as THREE from 'three';
import { useMemo } from 'react';

export interface SceneProps {
  layout: FloorLayout;
  manifest: AssetsManifest;
  cameraMode: CameraMode;
  onCameraModeChange: (mode: CameraMode) => void;
  focusAgentId: string | null;
  redactPrompts: boolean;
  onSelectAgent: (agentId: string) => void;
}

export function Scene({ layout, manifest, cameraMode, onCameraModeChange, focusAgentId, redactPrompts, onSelectAgent }: SceneProps): JSX.Element {
  const floorCenter = useMemo(() => new THREE.Vector3(layout.width / 2, 0, layout.height / 2), [layout.width, layout.height]);
  const reach = Math.max(layout.width, layout.height);
  const sunTarget = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(layout.width / 2, 0, layout.height / 2);
    return o;
  }, [layout.width, layout.height]);

  return (
    <>
      <CameraRig
        floorCenter={floorCenter}
        floorWidth={layout.width}
        floorHeight={layout.height}
        mode={cameraMode}
        onModeChange={onCameraModeChange}
      />
      {/* Soft fill so nothing goes pure black, plus one sun that actually casts. */}
      <ambientLight intensity={0.68} />
      <hemisphereLight args={['#e8eef7', '#9c8a6f', 0.5]} />
      {/*
        A directional light aims at its `target`, which defaults to the world
        origin — the CORNER of the floor, not its middle. Without an explicit
        target the sun rakes across the diorama from the wrong direction and the
        shadow frustum covers mostly empty space, so no shadow lands anywhere
        you can see it.
      */}
      <primitive object={sunTarget} />
      <directionalLight
        position={[
          floorCenter.x + reach * 0.55,
          reach * 1.15,
          floorCenter.z - reach * 0.35,
        ]}
        target={sunTarget}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0007}
        shadow-normalBias={0.02}
      >
        <orthographicCamera
          attach="shadow-camera"
          args={[-reach, reach, reach, -reach, 0.5, reach * 4]}
        />
      </directionalLight>
      <Floor layout={layout} />
      <Props layout={layout} />
      <Npcs layout={layout} manifest={manifest} />
      <Agents layout={layout} manifest={manifest} focusAgentId={focusAgentId} redactPrompts={redactPrompts} onSelect={onSelectAgent} />
      <Fx layout={layout} manifest={manifest} />
    </>
  );
}
