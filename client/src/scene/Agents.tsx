/**
 * Renders every agent currently in the store (task 4.7). Loads the shared
 * `animations.glb` clips once here (not per agent) and looks up each
 * agent's skin entry from the real manifest — never a synthesized skin path.
 */
import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import type { AssetsManifest } from '../assets/manifest.js';
import { animationsGlbUrl, findSkin } from '../assets/manifest.js';
import type { FloorLayout } from '../net/floorLayout.js';
import { useWorldStore } from '../state/store.js';
import { Agent } from './Agent.js';
import { effectiveDisplaySkin } from './effectiveDisplay.js';

export interface AgentsProps {
  layout: FloorLayout;
  manifest: AssetsManifest;
  focusAgentId: string | null;
  redactPrompts: boolean;
  onSelect: (agentId: string) => void;
}

export function Agents({ layout, manifest, focusAgentId, redactPrompts, onSelect }: AgentsProps): JSX.Element {
  const agents = useWorldStore((s) => s.agents);
  const desks = useWorldStore((s) => s.desks);
  const animationsGltf = useGLTF(animationsGlbUrl(manifest));
  const clips = animationsGltf.animations;

  const agentList = useMemo(() => Array.from(agents.values()), [agents]);

  return (
    <group>
      {agentList.map((agent) => (
        <Agent
          key={agent.agentId}
          agent={agent}
          layout={layout}
          desks={desks}
          clips={clips}
          manifestSkin={findSkin(manifest, effectiveDisplaySkin(agent))}
          redactPrompts={redactPrompts}
          focused={focusAgentId === agent.agentId}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}
