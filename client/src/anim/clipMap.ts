/**
 * `AgentState` -> clip-name map (task 4.8). Every value here is a verbatim
 * clip name from `animations.glb`'s real 84-clip library — see
 * `openspec/research/animation-retargeting.md` and the committed
 * `client/public/assets/assets.json`. `assertClipsExist` is the "startup
 * assertion throws on first missing clip name" safety net: it is called once
 * at boot against the real manifest (see `App.tsx`) and again in
 * `clipMap.test.ts` against the actual file on disk, so a typo here fails
 * loudly instead of silently freezing a character in bind pose.
 *
 * Several states share a clip because the 84-clip library has no dedicated
 * animation for that exact activity — each substitution is noted below and
 * mirrors the precedent already set server-side (P1 bear-bow uses `Yes`;
 * see `server/src/p1/index.ts`).
 */
import type { AgentState } from '@virtual-office/shared';

export const AGENT_STATE_CLIP: Record<AgentState, string> = {
  // Standing at the elevator, about to be assigned a desk.
  SPAWNING: 'Idle_Loop',
  WALKING: 'Walk_Loop',
  // Decision 4 asks for overflow agents to "sit on the couches and play
  // Idle_TalkingPhone_Loop" — but that clip is a STANDING animation, and played
  // on a seat socket it puts the character upright on top of the sofa. Seated
  // clips are used instead; the intent (waiting around, visibly not working) is
  // preserved, the pose is not a contradiction.
  QUEUED: 'Sitting_Talking_Loop',
  // No dedicated "typing" clip exists; Sitting_Talking_Loop is the closest "busy at the desk" loop.
  SEATED_TYPING: 'Sitting_Talking_Loop',
  SEATED_IDLE: 'Sitting_Idle_Loop',
  // Same reason as QUEUED: resting on a couch is a seated pose.
  LOUNGING: 'Sitting_Idle_Loop',
  // Standing at the counter, hands busy. The pack has no "cooking" clip; the
  // watering loop is the closest thing to working over a surface.
  COOKING: 'Farm_Watering',
  // Sat on the couch in front of the television.
  WATCHING_TV: 'Sitting_Idle_Loop',
  // Handoff / speech-bubble gesture.
  DELEGATING: 'Idle_Talking_Loop',
  REPORTING: 'Idle_Talking_Loop',
  // Decision 7, verbatim: "slumps at the desk, Sitting_Idle_Loop, head down".
  SLEEPING: 'Sitting_Idle_Loop',
  // Decision 7 / creative brief, verbatim: "one slow Zombie_Walk_Fwd_Loop lap".
  ZOMBIE: 'Zombie_Walk_Fwd_Loop',
  // The 3s dissolve is a material fade (see scene/Agent.tsx), not a clip; hold the last seated pose.
  DESPAWNING: 'Sitting_Idle_Loop',
};

/** Extra clip names used outside the per-state map (NPCs, P1 one-shot cues). Kept together so one assertion covers everything. */
export const EXTRA_USED_CLIPS = [
  'Idle_FoldArms_Loop', // The Architect, default.
  'Idle_No_Loop', // The Architect, "no" head-shake reaction.
  'Yes', // P1 teddy-bear bow (server precedent: no dedicated bow clip exists).
  'Idle_Talking_Loop', // P1 teddy-bear "explaining the problem".
  'Dance_Loop', // Ship-it celebration.
] as const;

export function allUsedClipNames(): string[] {
  return Array.from(new Set([...Object.values(AGENT_STATE_CLIP), ...EXTRA_USED_CLIPS]));
}

/**
 * Throws with the first missing clip name if any clip this app references is
 * absent from `availableClips` (normally `clipNameSet(manifest)` from the
 * real `assets.json`). Never invents a fallback clip name — a missing clip
 * is a build-time/pipeline bug, not a renderer concern to paper over.
 */
export function assertClipsExist(availableClips: ReadonlySet<string>): void {
  for (const clip of allUsedClipNames()) {
    if (!availableClips.has(clip)) {
      throw new Error(`clipMap references clip "${clip}", which does not exist in animations.glb`);
    }
  }
}

export function clipForState(state: AgentState): string {
  return AGENT_STATE_CLIP[state];
}
