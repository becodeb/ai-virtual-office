/**
 * Agent state machine states, per design.md §2 and the world-state-hub spec's
 * "at least" list. The reducer (`server/src/world/machine.ts`, Phase 2) owns
 * transitions between these; this module only names them so client and
 * server never drift.
 */
export const AGENT_STATES = [
  'SPAWNING',
  'WALKING',
  'QUEUED',
  'SEATED_TYPING',
  'SEATED_IDLE',
  'LOUNGING',
  'DELEGATING',
  'REPORTING',
  'SLEEPING',
  'ZOMBIE',
  'DESPAWNING',
] as const;

export type AgentState = (typeof AGENT_STATES)[number];

export function isAgentState(value: unknown): value is AgentState {
  return typeof value === 'string' && (AGENT_STATES as readonly string[]).includes(value);
}

/** Roles the classifier and skin manifest agree on (see `skins.ts`). */
export const ROLES = [
  'Builder',
  'Cook',
  'Scribe',
  'Detective',
  'Medic',
  'Pirate',
  'Ninja',
  'Wizard',
  'Viking',
  'Witch',
  'Intern',
  'Revenant',
  'Promoted',
  'Temp',
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Classifier confidence — 'inferred' rules render literally as "inferred" in the HUD (decision 5). */
export type Confidence = 'exact' | 'inferred';
