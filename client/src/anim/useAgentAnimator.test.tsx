import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as THREE from 'three';
import { useAgentAnimator } from './useAgentAnimator.js';

/** A minimal rig whose bone names match the clip track names below. */
function makeRig(): THREE.Object3D {
  const root = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = 'Body';
  root.add(bone);
  return root;
}

const clips = [
  new THREE.AnimationClip('Walk_Loop', 1, [
    new THREE.QuaternionKeyframeTrack('Body.quaternion', [0, 1], [0, 0, 0, 1, 0, 0.3, 0, 0.95]),
  ]),
  new THREE.AnimationClip('Sitting_Idle_Loop', 1, [
    new THREE.QuaternionKeyframeTrack('Body.quaternion', [0, 1], [0, 0, 0, 1, 0, 0.1, 0, 0.99]),
  ]),
];

/** Is anything actually driving the skeleton right now? */
function isPlaying(mixer: THREE.AnimationMixer | null, clip: THREE.AnimationClip): boolean {
  if (mixer === null) return false;
  const action = mixer.existingAction(clip);
  return action !== null && action.isRunning();
}

describe('useAgentAnimator', () => {
  it('starts the target clip', () => {
    const { result } = renderHook(({ root, clip }) => useAgentAnimator(root, clips, clip), {
      initialProps: { root: makeRig(), clip: 'Walk_Loop' },
    });
    expect(isPlaying(result.current.current, clips[0]!)).toBe(true);
  });

  /**
   * Regression: the clip effect did not depend on `root`. Rebuilding the clone
   * — which happens live now, every time an agent is reclassified and changes
   * skin — created a fresh mixer and cleared the "currently playing" state,
   * but never restarted anything. The character froze in its bind pose: a
   * T-pose, mid-office.
   */
  it('keeps animating after the character clone is rebuilt', () => {
    const { result, rerender } = renderHook(({ root, clip }) => useAgentAnimator(root, clips, clip), {
      initialProps: { root: makeRig(), clip: 'Walk_Loop' },
    });
    expect(isPlaying(result.current.current, clips[0]!)).toBe(true);

    // Same clip, new clone — exactly what a skin change produces.
    rerender({ root: makeRig(), clip: 'Walk_Loop' });

    expect(
      isPlaying(result.current.current, clips[0]!),
      'the new mixer is idle: the character is standing in its bind pose'
    ).toBe(true);
  });

  it('switches clips when the state changes', () => {
    const { result, rerender } = renderHook(({ root, clip }) => useAgentAnimator(root, clips, clip), {
      initialProps: { root: makeRig(), clip: 'Walk_Loop' },
    });
    rerender({ root: result.current.current!.getRoot() as THREE.Object3D, clip: 'Sitting_Idle_Loop' });
    expect(isPlaying(result.current.current, clips[1]!)).toBe(true);
  });

  it('does not throw when the requested clip is missing', () => {
    expect(() =>
      renderHook(() => useAgentAnimator(makeRig(), clips, 'A_Clip_That_Does_Not_Exist'))
    ).not.toThrow();
  });
});
