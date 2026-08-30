/**
 * P1 personality features (tasks 2.19-2.23): coffee runs, teddy-bear
 * debugging, the ship-it dance, zombie hour's Revenant swap (implemented
 * directly in `world/machine.ts`, see `ARCHITECT_REACTION_MS` and the
 * `ZOMBIE` transition), and The Architect NPC's reaction.
 *
 * This module is intentionally thin: `world/machine.ts` already owns the
 * state transitions (coffee run movement, the bear visit, ship-it
 * detection). This layer only reacts to the reducer's side effects to (a)
 * persist the coffee counter and (b) broadcast the cosmetic one-shot cues
 * (`event` frames, `agent_anim` ops) that the state machine itself has no
 * business knowing about a `hub`/`IdentityStore` to reach.
 */
import type { HookEventPayload } from '@virtual-office/shared';
import type { OfficeHub } from '../net/hub.js';
import type { IdentityStore } from '../world/identity.js';
import { triggerArchitectReaction, type MachineSideEffect, type WorldState } from '../world/machine.js';

/**
 * Best-effort detector for The Architect's reaction trigger (creative
 * brief: a diff introducing `any`, a `// TODO`, or a file over 500 lines).
 *
 * KNOWN LIMITATION: the frozen wire contract (`packages/shared/src/wire.ts`,
 * Phase 1) does not carry diff content — `PostToolUse.data.outputSummary`
 * is an opaque, hook-defined ≤80-char string, not the diff itself. This
 * check can only pattern-match whatever text the hook happens to put there
 * today; it cannot see file line counts at all. A real implementation needs
 * a new optional `data` field (e.g. `diffSignal: {hasAny, hasTodo,
 * fileLineCount}`) computed by the hook and added to `wire.ts` — deferred
 * rather than done here to avoid an unreviewed change to the wire contract
 * that Phase 3 (hooks) is concurrently building against.
 */
export function checkArchitectSignal(payload: HookEventPayload): boolean {
  if (payload.event !== 'PostToolUse') return false;
  if (!['Edit', 'Write', 'NotebookEdit'].includes(payload.data.tool)) return false;
  const text = payload.data.outputSummary;
  return /\bany\b/.test(text) || /\/\/\s*TODO\b/i.test(text) || /\bTODO\b/.test(text);
}

/** Call once per processed `/events` hook payload, after `reduce(world, {kind:'hook', ...})`. */
export function applyP1OnHookEvent(world: WorldState, payload: HookEventPayload, now: number): void {
  if (checkArchitectSignal(payload)) triggerArchitectReaction(world, now);
}

/** Call once per tick with the side effects `reduce(world, {kind:'tick'}, now)` returned. */
export function runP1Behaviors(
  world: WorldState,
  effects: MachineSideEffect[],
  identities: IdentityStore,
  hub: OfficeHub,
  _now: number
): void {
  for (const effect of effects) {
    switch (effect.kind) {
      case 'coffeeSipped': {
        const agent = world.agents.get(effect.agentId);
        if (agent !== undefined) identities.incrementCoffeeCount(agent.identityKey);
        break;
      }
      case 'shipIt': {
        // Ship-it is inferred from a command shape and an exit code, never
        // verified test semantics (decision 5) — the HUD must say so.
        hub.broadcastEvent('confetti', { inferred: true });
        hub.broadcastEvent('dance_party', { inferred: true });
        break;
      }
      case 'bashFailureStreak': {
        if (effect.streak === 3) {
          hub.publishAgentAnim(effect.agentId, 'Idle_Talking_Loop');
        }
        break;
      }
      case 'bashSuccessAfterStreak': {
        // No dedicated "bow" clip exists in the 84-clip library; `Yes` (an
        // affirmative nod) is the closest available acknowledgement gesture.
        hub.publishAgentAnim(effect.agentId, 'Yes');
        break;
      }
      case 'agentRemoved':
      case 'zombified':
        break;
    }
  }
}
