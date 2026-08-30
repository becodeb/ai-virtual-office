/**
 * One `AnimationMixer` per agent, crossfading between clips on state change
 * (task 4.9, office-renderer spec's animation-crossfade requirement).
 *
 * Locomotion<->idle crossfades over 0.25s; reaction clips (talking, the
 * bear-bow nod, the Architect's head-shake) crossfade faster, over 0.12s, so
 * they read as a quick beat rather than a slow blend. Entering a seated clip
 * from anything else first plays `Sitting_Enter` once (`LoopOnce` +
 * `clampWhenFinished`), then crossfades into the real target loop on the
 * mixer's `finished` event — matching task 4.9's explicit requirement and
 * decision 7's "the sit-down travel" (`Sitting_Enter`, pelvis 92->57).
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';

const LOCOMOTION_CROSSFADE_S = 0.25;
const REACTION_CROSSFADE_S = 0.12;

const SEATED_LOOP_CLIPS = new Set(['Sitting_Talking_Loop', 'Sitting_Idle_Loop']);
const REACTION_CLIPS = new Set(['Idle_Talking_Loop', 'Yes', 'Idle_No_Loop']);

export interface AgentAnimatorOptions {
  /** Scales `Walk_Loop`'s playback rate — 1.0 corresponds to `AGENT_MOVE_CELLS_PER_SEC`. */
  walkPlaybackRate?: number;
}

/**
 * `root` is the `SkeletonUtils.clone`d skinned root for one agent; `clips`
 * are the shared clips decoded once from `animations.glb`. `targetClip` is
 * the clip name this agent should currently be playing, per `clipMap.ts`
 * (or a one-shot P1 cue clip name).
 */
export function useAgentAnimator(
  root: THREE.Object3D | null,
  clips: THREE.AnimationClip[],
  targetClip: string,
  options: AgentAnimatorOptions = {}
): MutableRefObject<THREE.AnimationMixer | null> {
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);
  const currentClipNameRef = useRef<string | null>(null);

  useEffect(() => {
    if (root === null) return undefined;
    const mixer = new THREE.AnimationMixer(root);
    mixerRef.current = mixer;
    currentActionRef.current = null;
    currentClipNameRef.current = null;
    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
      currentActionRef.current = null;
      currentClipNameRef.current = null;
    };
  }, [root]);

  useEffect(() => {
    const mixer = mixerRef.current;
    if (mixer === null) return undefined;
    if (currentClipNameRef.current === targetClip) return undefined;

    const findClip = (name: string): THREE.AnimationClip | undefined => clips.find((c) => c.name === name);

    function play(clipName: string, loopOnce: boolean, fadeDuration: number): THREE.AnimationAction | null {
      const clip = findClip(clipName);
      if (clip === undefined) return null; // Missing clip is a boot-time assertion failure elsewhere, not a render crash here.
      const action = mixer!.clipAction(clip);
      action.reset();
      if (loopOnce) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
      }
      action.play();
      const previous = currentActionRef.current;
      if (previous !== null && previous !== action) {
        action.crossFadeFrom(previous, fadeDuration, false);
      } else {
        action.fadeIn(fadeDuration);
      }
      currentActionRef.current = action;
      return action;
    }

    const wasSeated = currentClipNameRef.current !== null && SEATED_LOOP_CLIPS.has(currentClipNameRef.current);
    const enteringSeated = SEATED_LOOP_CLIPS.has(targetClip) && !wasSeated && currentClipNameRef.current !== null;
    const fadeDuration = REACTION_CLIPS.has(targetClip) ? REACTION_CROSSFADE_S : LOCOMOTION_CROSSFADE_S;

    if (enteringSeated) {
      const bridge = play('Sitting_Enter', true, fadeDuration);
      currentClipNameRef.current = 'Sitting_Enter';
      if (bridge !== null) {
        const onFinished = (event: { action: THREE.AnimationAction }): void => {
          if (event.action !== bridge) return;
          mixer.removeEventListener('finished', onFinished);
          currentClipNameRef.current = null; // force the loop clip to actually start below
          play(targetClip, false, REACTION_CROSSFADE_S);
          currentClipNameRef.current = targetClip;
        };
        mixer.addEventListener('finished', onFinished);
        return undefined;
      }
    }

    play(targetClip, false, fadeDuration);
    currentClipNameRef.current = targetClip;
    return undefined;
  }, [clips, targetClip]);

  useEffect(() => {
    const action = currentActionRef.current;
    if (action === null || currentClipNameRef.current !== 'Walk_Loop') return;
    action.timeScale = options.walkPlaybackRate ?? 1;
  }, [options.walkPlaybackRate]);

  return mixerRef;
}
