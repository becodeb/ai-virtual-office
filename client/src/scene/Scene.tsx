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

  return (
    <>
      <CameraRig
        floorCenter={floorCenter}
        floorWidth={layout.width}
        floorHeight={layout.height}
        mode={cameraMode}
        onModeChange={onCameraModeChange}
      />
      <ambientLight intensity={0.7} />
      <directionalLight position={[10, 15, 5]} intensity={1.1} castShadow={false} />
      <Floor layout={layout} />
      <Props layout={layout} />
      <Npcs layout={layout} manifest={manifest} />
      <Agents layout={layout} manifest={manifest} focusAgentId={focusAgentId} redactPrompts={redactPrompts} onSelect={onSelectAgent} />
      <Fx layout={layout} manifest={manifest} />
    </>
  );
}
