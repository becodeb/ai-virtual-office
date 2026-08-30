import { describe, expect, it } from 'vitest';
import { AGENT_STATE_CLIP, allUsedClipNames, assertClipsExist, clipForState } from './clipMap.js';
import { AGENT_STATES } from '@virtual-office/shared';
// Real, committed manifest — task requirement: "clip-name resolution against the real assets.json".
import assetsManifest from '../../public/assets/assets.json' with { type: 'json' };

const realClipNames = new Set((assetsManifest.clips as Array<{ name: string }>).map((c) => c.name));

describe('clipMap (task 4.8: verbatim clip names, startup assertion)', () => {
  it('maps every AgentState to a clip name', () => {
    for (const state of AGENT_STATES) {
      expect(typeof AGENT_STATE_CLIP[state]).toBe('string');
      expect(AGENT_STATE_CLIP[state].length).toBeGreaterThan(0);
    }
  });

  it('clipForState resolves the same map', () => {
    expect(clipForState('WALKING')).toBe('Walk_Loop');
    expect(clipForState('ZOMBIE')).toBe('Zombie_Walk_Fwd_Loop');
  });

  it('every clip name this app references exists in the real, committed animations.glb manifest', () => {
    for (const clip of allUsedClipNames()) {
      expect(realClipNames.has(clip)).toBe(true);
    }
  });

  it('assertClipsExist passes against the real manifest', () => {
    expect(() => assertClipsExist(realClipNames)).not.toThrow();
  });

  it('assertClipsExist throws with the first missing clip name when a clip does not exist', () => {
    const incomplete = new Set(['Walk_Loop']); // missing everything else this app uses
    expect(() => assertClipsExist(incomplete)).toThrow(/does not exist in animations\.glb/);
  });

  it('assertClipsExist throws on a manifest with zero clips', () => {
    expect(() => assertClipsExist(new Set())).toThrow();
  });
});
