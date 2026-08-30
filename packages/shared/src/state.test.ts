import { describe, expect, it } from 'vitest';
import { AGENT_STATES, isAgentState, ROLES, isRole } from './state.js';

describe('agent state machine states', () => {
  it('defines exactly 11 states', () => {
    expect(AGENT_STATES).toHaveLength(11);
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
