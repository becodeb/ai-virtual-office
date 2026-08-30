import { describe, expect, it } from 'vitest';
import type { AgentSnapshot, ServerFrame, WorldSnapshot } from '@virtual-office/shared';
import { applyServerFrame, initialWorldReducerState, needsResync } from './worldReducer.js';

function agent(id: string, overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    agentId: id,
    sessionId: id,
    parentSessionId: null,
    role: 'Scribe',
    confidence: 'exact',
    skin: 'Casual_Male',
    badge: 'keyboard',
    state: 'SEATED_IDLE',
    position: { x: 3.5, y: 0.33, z: 4.5 },
    facingRad: 0,
    deskId: 'D1',
    label: { name: id, machineId: 'foo-laptop', taskText: 'writing tests' },
    ...overrides,
  };
}

function snapshotFrame(seq: number, agents: AgentSnapshot[]): ServerFrame {
  const world: WorldSnapshot = {
    layout: {},
    props: [],
    desks: [{ deskId: 'D1', occupiedBy: agents[0]?.agentId ?? null }],
    agents,
    npcs: [],
    hud: {},
  };
  return { t: 'snapshot', seq, world };
}

describe('worldReducer: snapshot then deltas then reconnect resync', () => {
  it('applies hello, then a snapshot, then sequential deltas', () => {
    let state = initialWorldReducerState();

    state = applyServerFrame(state, {
      t: 'hello',
      p: 'office.v1',
      serverTime: 1000,
      tickRate: 10,
      config: { redactPrompts: false, deskCount: 12 },
    });
    expect(state.helloReceived).toBe(true);
    expect(state.deskCount).toBe(12);

    state = applyServerFrame(state, snapshotFrame(5, [agent('a1')]));
    expect(state.seq).toBe(5);
    expect(state.agents.size).toBe(1);
    expect(state.agents.get('a1')?.state).toBe('SEATED_IDLE');

    state = applyServerFrame(state, { t: 'delta', seq: 6, ops: [{ op: 'agent_state', agentId: 'a1', state: 'SEATED_TYPING' }] });
    expect(state.seq).toBe(6);
    expect(state.agents.get('a1')?.state).toBe('SEATED_TYPING');

    state = applyServerFrame(state, { t: 'delta', seq: 7, ops: [{ op: 'agent_label', agentId: 'a1', taskText: 'new task' }] });
    expect(state.agents.get('a1')?.label.taskText).toBe('new task');

    state = applyServerFrame(state, { t: 'delta', seq: 8, ops: [{ op: 'agent_add', agent: agent('a2', { state: 'WALKING' }) }] });
    expect(state.agents.size).toBe(2);

    state = applyServerFrame(state, { t: 'delta', seq: 9, ops: [{ op: 'agent_remove', agentId: 'a2' }] });
    expect(state.agents.size).toBe(1);

    state = applyServerFrame(state, { t: 'delta', seq: 10, ops: [{ op: 'desk', deskId: 'D1', occupiedBy: null }] });
    expect(state.desks.get('D1')).toBeNull();
  });

  it('a fresh full snapshot after reconnect replaces the entire agent/desk set', () => {
    let state = initialWorldReducerState();
    state = applyServerFrame(state, snapshotFrame(1, [agent('a1'), agent('a2')]));
    expect(state.agents.size).toBe(2);

    // Reconnect (lastSeq fell outside the ring) -> hub sends a brand-new snapshot.
    state = applyServerFrame(state, snapshotFrame(42, [agent('a3')]));
    expect(state.seq).toBe(42);
    expect(state.agents.size).toBe(1);
    expect(state.agents.has('a1')).toBe(false);
    expect(state.agents.has('a3')).toBe(true);
  });

  it('agent_anim ops accumulate as targeted one-shot cues, not global fx', () => {
    let state = initialWorldReducerState();
    state = applyServerFrame(state, snapshotFrame(1, [agent('a1')]));
    state = applyServerFrame(state, { t: 'delta', seq: 2, ops: [{ op: 'agent_anim', agentId: 'a1', clip: 'Idle_Talking_Loop' }] });
    expect(state.animCues).toHaveLength(1);
    expect(state.animCues[0]).toMatchObject({ agentId: 'a1', clip: 'Idle_Talking_Loop' });
    expect(state.fx).toHaveLength(0);
  });

  it('event frames push into fx with the inferred flag preserved', () => {
    let state = initialWorldReducerState();
    state = applyServerFrame(state, { t: 'event', kind: 'confetti', inferred: true });
    expect(state.fx).toHaveLength(1);
    expect(state.fx[0]).toMatchObject({ kind: 'confetti', inferred: true });

    state = applyServerFrame(state, { t: 'event', kind: 'elevator_ding' });
    expect(state.fx).toHaveLength(2);
    expect(state.fx[1]).toMatchObject({ kind: 'elevator_ding', inferred: false });
  });

  it('a protocol_mismatch frame is recorded without crashing', () => {
    let state = initialWorldReducerState();
    state = applyServerFrame(state, { t: 'protocol_mismatch', expected: 'office.v1' });
    expect(state.protocolMismatch).toBe(true);
  });
});

describe('needsResync', () => {
  it('is true before any snapshot has been applied (lastSeq null)', () => {
    expect(needsResync(null, 1)).toBe(true);
  });

  it('is false for the next sequential seq', () => {
    expect(needsResync(5, 6)).toBe(false);
  });

  it('is true when a delta is skipped (a gap in the sequence)', () => {
    expect(needsResync(5, 8)).toBe(true);
  });

  it('is true for a seq that goes backwards (stale/duplicate delta)', () => {
    expect(needsResync(10, 6)).toBe(true);
  });
});
