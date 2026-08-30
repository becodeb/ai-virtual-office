/**
 * The two camera modes (task 4.14, office-renderer spec's Camera Modes
 * requirement): Free-Orbital (an `OrthographicCamera` + drei `MapControls`,
 * clamped polar angle/zoom/pan, giving the classic diorama isometric look)
 * and Focus-Agent (lerps to `agentPos + fixedIsoOffset`, damped, and follows
 * the selected character until the viewer pans away or it despawns). `F`
 * toggles between modes; clicking a character (via `Agent`'s `onSelect`)
 * focuses it and emits a `focus` WS message.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MapControls, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import { useWorldStore } from '../state/store.js';
import { fitZoomForFloor, isoOffsetForFloor, stepTowardFocusTarget } from './cameraMath.js';

export type CameraMode = 'free' | 'focus';

const FOCUS_DAMPING = 4; // per-second lerp factor.

export interface CameraRigProps {
  floorCenter: THREE.Vector3;
  floorWidth: number;
  floorHeight: number;
  mode: CameraMode;
  onModeChange: (mode: CameraMode) => void;
}

export function CameraRig({ floorCenter, floorWidth, floorHeight, mode, onModeChange }: CameraRigProps): JSX.Element {
  const { camera, size } = useThree();
  const focusAgentId = useWorldStore((s) => s.focusAgentId);
  const agents = useWorldStore((s) => s.agents);
  const controlsRef = useRef<MapControlsImpl | null>(null);

  // Both derive from the floor and the viewport rather than being pinned to
  // constants that only suit one screen and one floor size.
  const isoOffset = useMemo(() => isoOffsetForFloor(floorWidth, floorHeight), [floorWidth, floorHeight]);
  const zoom = useMemo(
    () => fitZoomForFloor(floorWidth, floorHeight, size.width, size.height),
    [floorWidth, floorHeight, size.width, size.height]
  );

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
    const next = stepTowardFocusTarget(camera.position, agent.position, isoOffset, FOCUS_DAMPING, delta);
    camera.position.set(next.x, next.y, next.z);
    camera.lookAt(agent.position.x, agent.position.y, agent.position.z);
  });

  return (
    <>
      <OrthographicCamera
        makeDefault
        position={[floorCenter.x + isoOffset.x, isoOffset.y, floorCenter.z + isoOffset.z]}
        zoom={zoom}
        near={0.1}
        far={Math.max(200, Math.max(floorWidth, floorHeight) * 6)}
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
