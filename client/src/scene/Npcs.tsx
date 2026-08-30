/**
 * P1 NPC visuals (task 4.18): The Architect (static corner-office NPC) and a
 * coffee-machine location marker for coffee-run rendering.
 *
 * DEVIATION (documented): the wire protocol has no delta op for NPC state at
 * all (`DeltaOp` has no `npc_*` variant), so `world.npcs` only ever refreshes
 * on a full snapshot — The Architect's `Idle_No_Loop` reaction (triggered
 * server-side by `triggerArchitectReaction`) will not animate live between
 * snapshots. This mirrors the same frozen-contract gap already documented in
 * `server/src/p1/index.ts`'s trigger detector and `scene/agentTarget.ts`'s
 * movement notes, not a new one introduced here.
 *
 * `NpcRecord` carries no skin (unlike `AgentSnapshot`) — `Suit_Male` is a
 * creative, undocumented-by-spec choice for "the corner office," consistent
 * with decision-driven promotion imagery (`Suit_Male`/`Suit_Female` are the
 * only skins reserved for seniority in `packages/shared/src/skins.ts`).
 */
import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { animationsGlbUrl, skinGlbUrl, type AssetsManifest } from '../assets/manifest.js';
import { useAgentAnimator } from '../anim/useAgentAnimator.js';
import type { FloorLayout } from '../net/floorLayout.js';
import { isArchitectNpc } from '../net/npc.js';
import { useWorldStore } from '../state/store.js';

const ARCHITECT_SKIN_FILE = 'characters/Suit_Male.glb';

function Architect({ manifest }: { manifest: AssetsManifest }): JSX.Element | null {
  const npcs = useWorldStore((s) => s.npcs);
  const architect = useMemo(() => npcs.find(isArchitectNpc), [npcs]);
  const gltf = useGLTF(skinGlbUrl(ARCHITECT_SKIN_FILE));
  const animationsGltf = useGLTF(animationsGlbUrl(manifest));
  const cloned = useMemo(() => {
    const root = SkeletonUtils.clone(gltf.scene) as THREE.Object3D;
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh === true) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return root;
  }, [gltf.scene]);
  useAgentAnimator(cloned, animationsGltf.animations, architect?.clip ?? 'Idle_FoldArms_Loop');

  if (architect === undefined) return null;
  return (
    <group position={[architect.position.x, architect.position.y, architect.position.z]} rotation={[0, architect.facingRad, 0]}>
      <primitive object={cloned} />
    </group>
  );
}

function CoffeeMachineMarker({ layout }: { layout: FloorLayout }): JSX.Element {
  return (
    <pointLight
      position={[layout.kitchenCoffeeMachineCell[0] + 0.5, 0.4, layout.kitchenCoffeeMachineCell[1] + 0.5]}
      color="#c68b59"
      intensity={0.6}
      distance={1.5}
    />
  );
}

export interface NpcsProps {
  layout: FloorLayout;
  manifest: AssetsManifest;
}

export function Npcs({ layout, manifest }: NpcsProps): JSX.Element {
  return (
    <group>
      <Architect manifest={manifest} />
      <CoffeeMachineMarker layout={layout} />
    </group>
  );
}
