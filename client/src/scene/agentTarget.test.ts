import { describe, expect, it } from 'vitest';
import type { AgentSnapshot } from '@virtual-office/shared';
import type { FloorLayout } from '../net/floorLayout.js';
import { resolveAgentTarget } from './agentTarget.js';

const layout: FloorLayout = {
  width: 10,
  height: 10,
  elevatorCell: [0, 5],
  fireExitCell: [9, 5],
  kitchenCoffeeMachineCell: [2, 8],
  kitchenStandCell: [3, 8],
  meetingRoomScreenCell: [2, 1],
  bearCell: [7, 2],
  bearStandCell: [7, 3],
  architectCell: [8, 8],
  desks: [
    { id: 'D1', cell: [3, 3], window: false, seat: { cell: [3, 4], standCell: [3, 4], position: { x: 3.5, y: 0.33, z: 4.5 }, facingRad: 0 } },
  ],
  loungeSeats: [
    { cell: [6, 2], standCell: [6, 2], position: { x: 6.5, y: 0.33, z: 2.5 }, facingRad: 0 },
  ],
  decor: [],
};

function agent(overrides: Partial<AgentSnapshot>): AgentSnapshot {
  return {
    agentId: 'a1',
    sessionId: 'a1',
    parentSessionId: null,
    role: 'Scribe',
    confidence: 'exact',
    skin: 'Casual_Male',
    badge: 'keyboard',
    state: 'SEATED_IDLE',
    position: { x: 0.5, y: 0, z: 5.5 },
    facingRad: 0,
    deskId: null,
    label: { name: 'a1', machineId: 'foo', taskText: '' },
    ...overrides,
  };
}

describe('resolveAgentTarget', () => {
  it('targets the exact desk seat when the desk map shows this agent occupying it', () => {
    const desks = new Map([['D1', 'a1']]);
    const target = resolveAgentTarget(agent({}), layout, desks);
    expect(target).toEqual({ position: { x: 3.5, y: 0.33, z: 4.5 }, facingRad: 0, isSocket: true });
  });

  it('falls back to deskId + state when desk occupancy has not arrived yet', () => {
    const target = resolveAgentTarget(agent({ state: 'SEATED_TYPING', deskId: 'D1' }), layout, new Map());
    expect(target?.isSocket).toBe(true);
    expect(target?.position).toEqual({ x: 3.5, y: 0.33, z: 4.5 });
  });

  it('targets loungeSeats[0] for LOUNGING (mirrors machine.ts always using loungeSeats[0])', () => {
    const target = resolveAgentTarget(agent({ state: 'LOUNGING' }), layout, new Map());
    expect(target).toEqual({ position: { x: 6.5, y: 0.33, z: 2.5 }, facingRad: 0, isSocket: true });
  });

  it('targets loungeSeats[0] for QUEUED too', () => {
    const target = resolveAgentTarget(agent({ state: 'QUEUED' }), layout, new Map());
    expect(target?.isSocket).toBe(true);
  });

  it('targets the elevator for SPAWNING, marked as a non-socket coarse target', () => {
    const target = resolveAgentTarget(agent({ state: 'SPAWNING' }), layout, new Map());
    expect(target).toEqual({ position: { x: 0.5, y: 0, z: 5.5 }, facingRad: 0, isSocket: false });
  });

  it('returns null for states with no known destination (e.g. mid-delegation, mid-report, zombie lap)', () => {
    expect(resolveAgentTarget(agent({ state: 'DELEGATING' }), layout, new Map())).toBeNull();
    expect(resolveAgentTarget(agent({ state: 'REPORTING' }), layout, new Map())).toBeNull();
    expect(resolveAgentTarget(agent({ state: 'ZOMBIE' }), layout, new Map())).toBeNull();
  });
});
