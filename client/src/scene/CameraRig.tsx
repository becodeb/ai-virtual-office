/**
 * The two camera modes (task 4.14, office-renderer spec's Camera Modes
 * requirement): Free-Orbital (an `OrthographicCamera` + drei `MapControls`,
 * clamped polar angle/zoom/pan, giving the classic diorama isometric look)
 * and Focus-Agent (lerps to `agentPos + fixedIsoOffset`, damped, and follows
 * the selected character until the viewer pans away or it despawns). `F`
 * toggles between modes; clicking a character (via `Agent`'s `onSelect`)
 * focuses it and emits a `focus` WS message.
 */
import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MapControls, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import { useWorldStore } from '../state/store.js';
import { stepTowardFocusTarget } from './cameraMath.js';

export type CameraMode = 'free' | 'focus';

/** A fixed isometric offset from the focused agent — classic 45°-ish diorama angle. */
const ISO_OFFSET = new THREE.Vector3(8, 10, 8);
const FOCUS_DAMPING = 4; // per-second lerp factor.

export interface CameraRigProps {
  floorCenter: THREE.Vector3;
  mode: CameraMode;
  onModeChange: (mode: CameraMode) => void;
}

export function CameraRig({ floorCenter, mode, onModeChange }: CameraRigProps): JSX.Element {
  const { camera } = useThree();
  const focusAgentId = useWorldStore((s) => s.focusAgentId);
  const agents = useWorldStore((s) => s.agents);
  const controlsRef = useRef<MapControlsImpl | null>(null);
  const [zoom] = useState(60);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key.toLowerCase() === 'f') onModeChange(mode === 'free' ? 'focus' : 'free');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, onModeChange]);

  // Focus mode ends automatically if the focused agent despawns (removed from the world).
  useEffect(() => {
    if (mode === 'focus' && focusAgentId !== null && !agents.has(focusAgentId)) {
      onModeChange('free');
    }
  }, [mode, focusAgentId, agents, onModeChange]);

  useFrame((_, delta) => {
    if (mode !== 'focus' || focusAgentId === null) return;
    const agent = agents.get(focusAgentId);
    if (agent === undefined) return;
    const next = stepTowardFocusTarget(camera.position, agent.position, ISO_OFFSET, FOCUS_DAMPING, delta);
    camera.position.set(next.x, next.y, next.z);
    camera.lookAt(agent.position.x, agent.position.y, agent.position.z);
  });

  return (
    <>
      <OrthographicCamera
        makeDefault
        position={[floorCenter.x + ISO_OFFSET.x, ISO_OFFSET.y, floorCenter.z + ISO_OFFSET.z]}
        zoom={zoom}
        near={0.1}
        far={200}
      />
      <MapControls
        ref={controlsRef}
        enabled={mode === 'free'}
        target={floorCenter}
        minZoom={20}
        maxZoom={160}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.5}
        enableDamping
        // Panning while free-orbiting is exactly the "not locked to any character" scenario the spec asserts.
      />
    </>
  );
}
