import { describe, expect, it } from 'vitest';
import { AGENT_STATES, isAgentState, ROLES, isRole } from './state.js';

describe('agent state machine states', () => {
  /**
   * Counting states protects nothing — it only breaks whenever one is added.
   * What matters is that the list has no duplicates and still names every
   * state the product actually depends on.
   */
  it('names every state the world depends on, with no duplicates', () => {
    expect(new Set(AGENT_STATES).size).toBe(AGENT_STATES.length);
    for (const required of [
      'SPAWNING',
      'WALKING',
      'QUEUED',
      'SEATED_TYPING',
      'SEATED_IDLE',
      'LOUNGING',
      'COOKING',
      'WATCHING_TV',
      'DELEGATING',
      'REPORTING',
      'SLEEPING',
      'ZOMBIE',
      'DESPAWNING',
    ]) {
      expect(AGENT_STATES, `${required} is missing`).toContain(required);
    }
  });

  it('recognises a valid state and rejects an invalid one', () => {
    expect(isAgentState('SEATED_TYPING')).toBe(true);
    expect(isAgentState('NOT_A_STATE')).toBe(false);
  });

  it('recognises a valid role and rejects an invalid one', () => {
    expect(isRole('Pirate')).toBe(true);
    expect(isRole('Astronaut')).toBe(false);
  });
});
