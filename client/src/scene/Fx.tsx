/**
 * Cosmetic one-shot cues from `event` frames (task 4.19): confetti,
 * elevator-ding, alarm, and the `moo` easter egg's cow. Purely decorative —
 * this component invents no world state, it only reacts to `event` frames
 * already applied into `state.fx` by the reducer.
 */
import { useMemo } from 'react';
import { Sparkles, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { skinGlbUrl, type AssetsManifest } from '../assets/manifest.js';
import type { FloorLayout } from '../net/floorLayout.js';
import { useRecentFx } from '../state/useRecentFx.js';

const CONFETTI_MS = 10_000; // creative brief: ship-it celebration lasts ten seconds.
const ELEVATOR_DING_MS = 1_500;
const ALARM_MS = 6_000;
const COW_MS = 15_000;

function CowVisitor({ manifest, floorCenter }: { manifest: AssetsManifest; floorCenter: THREE.Vector3 }): JSX.Element | null {
  const active = useRecentFx('cow', COW_MS) !== null;
  const gltf = useGLTF(skinGlbUrl('characters/Cow.glb'));
  const cloned = useMemo(() => SkeletonUtils.clone(gltf.scene) as THREE.Object3D, [gltf.scene]);
  if (!active) return null;
  return <primitive object={cloned} position={[floorCenter.x, 0, floorCenter.z]} />;
}

export interface FxProps {
  layout: FloorLayout;
  manifest: AssetsManifest;
}

export function Fx({ layout, manifest }: FxProps): JSX.Element {
  const confettiActive = useRecentFx('confetti', CONFETTI_MS) !== null;
  const dingActive = useRecentFx('elevator_ding', ELEVATOR_DING_MS) !== null;
  const alarmActive = useRecentFx('alarm', ALARM_MS) !== null;
  const floorCenter = useMemo(() => new THREE.Vector3(layout.width / 2, 1.2, layout.height / 2), [layout.width, layout.height]);

  return (
    <group>
      {confettiActive && <Sparkles count={200} scale={[layout.width, 4, layout.height]} position={[layout.width / 2, 2, layout.height / 2]} size={4} speed={1} color="#ffd166" />}
      {dingActive && (
        <pointLight position={[layout.elevatorCell[0] + 0.5, 1.5, layout.elevatorCell[1] + 0.5]} color="#8ecae6" intensity={2} distance={3} />
      )}
      {alarmActive && <pointLight position={[layout.width / 2, 3, layout.height / 2]} color="#ef4444" intensity={3} distance={layout.width} />}
      <CowVisitor manifest={manifest} floorCenter={floorCenter} />
    </group>
  );
}
