/**
 * One rendered agent (task 4.7): loads its skin GLB once (cached by drei's
 * `useGLTF` per URL), clones it per-instance with `SkeletonUtils.clone` (an
 * independent skeleton, shared geometry/material by reference — the
 * instancing guarantee in `openspec/research/animation-retargeting.md`),
 * drives it with `useAgentAnimator`, applies decision 9's role/machine tint,
 * and lerps toward `resolveAgentTarget`'s best-known destination (task 4.11
 * seat-socket snapping; see `scene/agentTarget.ts` for the documented
 * movement-fidelity deviation).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import type { AgentSnapshot } from '@virtual-office/shared';
import { clipForState } from '../anim/clipMap.js';
import { useAgentAnimator } from '../anim/useAgentAnimator.js';
import type { AssetSkinEntry } from '../assets/manifest.js';
import { skinGlbUrl } from '../assets/manifest.js';
import type { FloorLayout } from '../net/floorLayout.js';
import { useWorldStore } from '../state/store.js';
import { useRecentFx } from '../state/useRecentFx.js';
import { AGENT_MOVE_CELLS_PER_SEC, resolveAgentTarget } from './agentTarget.js';
import { effectiveDisplayRole } from './effectiveDisplay.js';
import { applyPaletteTint, paletteColorForMachine, pickTintSlotName } from './rolePalette.js';
import { AgentLabel } from '../hud/Label.js';

/** How long a one-shot P1 clip cue (`agent_anim`, e.g. bear talk/bow) overrides the state-driven clip. */
const ANIM_CUE_OVERRIDE_MS = 2_500;
/** Creative brief: the office-wide ship-it dance lasts ten seconds. */
const DANCE_PARTY_MS = 10_000;

const DESPAWN_DISSOLVE_MS = 3_000; // decision 7.
const HEAD_HEIGHT = 1.05; // world-scale.md standing height; the label anchors at the top of the character.

/**
 * Vertical spread applied to label anchors so neighbours do not stack.
 *
 * Characters at adjacent desks project to nearly the same screen height, so
 * their label chips land on top of each other and the office reads as a pile of
 * overlapping black boxes. Staggering the anchor by desk index separates them
 * deterministically — the same character always sits on the same rung, so the
 * labels do not shuffle between frames.
 */
const LABEL_STAGGER_STEPS = 3;
const LABEL_STAGGER_HEIGHT = 0.22;

function labelStagger(agent: AgentSnapshot, layout: FloorLayout): number {
  const index =
    agent.deskId !== null ? layout.desks.findIndex((d) => d.id === agent.deskId) : -1;
  const rung = index >= 0 ? index % LABEL_STAGGER_STEPS : agent.agentId.length % LABEL_STAGGER_STEPS;
  return rung * LABEL_STAGGER_HEIGHT;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export interface AgentProps {
  agent: AgentSnapshot;
  layout: FloorLayout;
  desks: ReadonlyMap<string, string | null>;
  clips: THREE.AnimationClip[];
  manifestSkin: AssetSkinEntry | undefined;
  redactPrompts: boolean;
  focused: boolean;
  onSelect: (agentId: string) => void;
}

export function Agent({ agent, layout, desks, clips, manifestSkin, redactPrompts, focused, onSelect }: AgentProps): JSX.Element {
  const gltf = useGLTF(skinGlbUrl(manifestSkin?.file ?? 'characters/BaseCharacter.glb'));

  const tintSlot = useMemo(() => (manifestSkin ? pickTintSlotName(manifestSkin.slotNames) : null), [manifestSkin]);
  const paletteColor = useMemo(() => paletteColorForMachine(agent.label.machineId), [agent.label.machineId]);

  const cloned = useMemo(() => {
    const root = SkeletonUtils.clone(gltf.scene) as THREE.Object3D;
    if (tintSlot !== null && manifestSkin !== undefined) {
      root.traverse((obj) => {
        const mesh = obj as THREE.SkinnedMesh;
        if (mesh.isMesh === true && mesh.geometry !== undefined) {
          mesh.geometry = applyPaletteTint(mesh.geometry, manifestSkin.slotNames, tintSlot, paletteColor);
        }
      });
    }
    return root;
  }, [gltf.scene, tintSlot, manifestSkin, paletteColor]);

  // One-shot P1 clip cues (`agent_anim` deltas — bear talk/bow) briefly override the state-driven clip.
  const animCues = useWorldStore((s) => s.animCues);
  const [overrideClip, setOverrideClip] = useState<string | null>(null);
  const lastCueIdRef = useRef(0);

  useEffect(() => {
    const cuesForAgent = animCues.filter((c) => c.agentId === agent.agentId && c.id > lastCueIdRef.current);
    if (cuesForAgent.length === 0) return;
    const latest = cuesForAgent[cuesForAgent.length - 1]!;
    lastCueIdRef.current = latest.id;
    setOverrideClip(latest.clip);
    const timer = setTimeout(() => setOverrideClip(null), ANIM_CUE_OVERRIDE_MS);
    return () => clearTimeout(timer);
  }, [animCues, agent.agentId]);

  // Creative brief: "a green test suite ... triggers Dance_Loop across the whole office for ten seconds" — an office-wide, floor-level fx, not a per-agent cue.
  const danceParty = useRecentFx('dance_party', DANCE_PARTY_MS) !== null;

  const clipName = overrideClip ?? (danceParty ? 'Dance_Loop' : clipForState(agent.state));
  const mixerRef = useAgentAnimator(cloned, clips, clipName);
  const displayRole = effectiveDisplayRole(agent);

  const groupRef = useRef<THREE.Group>(null);
  const currentPos = useRef(new THREE.Vector3(agent.position.x, agent.position.y, agent.position.z));
  const currentFacing = useRef(agent.facingRad);
  const despawnStartedAt = useRef<number | null>(null);

  const target = useMemo(() => resolveAgentTarget(agent, layout, desks) ?? { position: agent.position, facingRad: agent.facingRad, isSocket: false }, [agent, layout, desks]);

  // Despawn dissolve: clone materials lazily (never mutate the shared per-skin material) so only this agent fades.
  useEffect(() => {
    if (agent.state !== 'DESPAWNING') {
      despawnStartedAt.current = null;
      return;
    }
    despawnStartedAt.current = performance.now();
    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh !== true) return;
      const material = mesh.material as THREE.Material | THREE.Material[];
      mesh.material = Array.isArray(material)
        ? material.map((m) => {
            const clone = m.clone();
            clone.transparent = true;
            return clone;
          })
        : (() => {
            const clone = material.clone();
            clone.transparent = true;
            return clone;
          })();
    });
  }, [agent.state, cloned]);

  useFrame((_, delta) => {
    mixerRef.current?.update(delta);

    const targetVec = new THREE.Vector3(target.position.x, target.position.y, target.position.z);
    const distance = currentPos.current.distanceTo(targetVec);
    if (distance > 0.0005) {
      const step = AGENT_MOVE_CELLS_PER_SEC * delta;
      const t = distance > 0 ? Math.min(1, step / distance) : 1;
      currentPos.current.lerp(targetVec, t);
      currentFacing.current = lerpAngle(currentFacing.current, target.facingRad, Math.min(1, delta * 4));
    } else if (target.isSocket) {
      // Seat-socket snapping (task 4.11): exact once close enough, no clipping.
      currentPos.current.copy(targetVec);
      currentFacing.current = target.facingRad;
    }

    const group = groupRef.current;
    if (group !== null) {
      group.position.copy(currentPos.current);
      group.rotation.y = currentFacing.current;
    }

    if (despawnStartedAt.current !== null) {
      const elapsed = performance.now() - despawnStartedAt.current;
      const opacity = Math.max(0, 1 - elapsed / DESPAWN_DISSOLVE_MS);
      cloned.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh !== true) return;
        const material = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(material)) material.forEach((m) => (m.opacity = opacity));
        else material.opacity = opacity;
      });
    }
  });

  return (
    <group ref={groupRef} onClick={(e) => { e.stopPropagation(); onSelect(agent.agentId); }}>
      <primitive object={cloned} />
      <AgentLabel
        agent={agent}
        displayRole={displayRole}
        redactPrompts={redactPrompts}
        focused={focused}
        yOffset={HEAD_HEIGHT + labelStagger(agent, layout)}
      />
    </group>
  );
}
