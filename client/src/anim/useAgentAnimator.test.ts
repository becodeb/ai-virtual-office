/**
 * Task 4.10's RED scenario: "transition from Walk_Loop to Sitting_Enter
 * crossfades over non-zero duration, no single unblended frame." Exercises
 * the real `THREE.AnimationMixer`/`AnimationAction` crossfade machinery
 * (no WebGL/render needed — mixers work on any `Object3D` + `AnimationClip`).
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { useAgentAnimator } from './useAgentAnimator.js';

function makeClip(name: string): THREE.AnimationClip {
  return new THREE.AnimationClip(name, 1, []);
}

describe('useAgentAnimator crossfade (office-renderer spec: Animation Crossfade on Clip Change)', () => {
  it('entering a seated clip from Walk_Loop bridges through Sitting_Enter, crossfading — never an instant cut', () => {
    const root = new THREE.Object3D();
    const clips = [makeClip('Walk_Loop'), makeClip('Sitting_Enter'), makeClip('Sitting_Idle_Loop')];

    const { result, rerender } = renderHook(({ target }: { target: string }) => useAgentAnimator(root, clips, target), {
      initialProps: { target: 'Walk_Loop' },
    });

    const mixer = result.current.current!;
    mixer.update(0); // settle the initial Walk_Loop action

    rerender({ target: 'Sitting_Idle_Loop' });

    const walkAction = mixer.existingAction(clips[0]!, root);
    const enterAction = mixer.existingAction(clips[1]!, root);
    expect(walkAction).not.toBeNull();
    expect(enterAction).not.toBeNull();

    // Mid-fade (well inside the 0.25s locomotion crossfade window): both
    // actions must be partially weighted — a real blend, not a 0/1 cut.
    mixer.update(0.05);
    const walkWeightMid = walkAction!.getEffectiveWeight();
    const enterWeightMid = enterAction!.getEffectiveWeight();
    expect(walkWeightMid).toBeGreaterThan(0);
    expect(walkWeightMid).toBeLessThan(1);
    expect(enterWeightMid).toBeGreaterThan(0);
    expect(enterWeightMid).toBeLessThan(1);

    // After the fade completes, the outgoing clip has faded fully out.
    mixer.update(1);
    expect(walkAction!.getEffectiveWeight()).toBeCloseTo(0, 5);
    expect(enterAction!.getEffectiveWeight()).toBeCloseTo(1, 5);
  });

  it('crossfades directly between two non-seated clips (e.g. Walk_Loop -> Idle_Loop) with a mid-fade blend too', () => {
    const root = new THREE.Object3D();
    const clips = [makeClip('Walk_Loop'), makeClip('Idle_Loop')];

    const { result, rerender } = renderHook(({ target }: { target: string }) => useAgentAnimator(root, clips, target), {
      initialProps: { target: 'Walk_Loop' },
    });
    const mixer = result.current.current!;
    mixer.update(0);

    rerender({ target: 'Idle_Loop' });
    mixer.update(0.05);

    const walkAction = mixer.existingAction(clips[0]!, root)!;
    const idleAction = mixer.existingAction(clips[1]!, root)!;
    expect(walkAction.getEffectiveWeight()).toBeGreaterThan(0);
    expect(idleAction.getEffectiveWeight()).toBeGreaterThan(0);
  });
});
