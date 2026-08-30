import { describe, expect, it } from 'vitest';
import { isFloorLayout, perimeterWallCells, type FloorLayout } from './floorLayout.js';

const validLayout: FloorLayout = {
  width: 4,
  height: 4,
  elevatorCell: [0, 2],
  fireExitCell: [3, 2],
  kitchenCoffeeMachineCell: [1, 1],
  kitchenStandCell: [1, 2],
  meetingRoomScreenCell: [2, 1],
  bearCell: [2, 2],
  bearStandCell: [2, 3],
  architectCell: [3, 3],
  desks: [{ id: 'D1', cell: [1, 1], window: false, seat: { cell: [1, 2], standCell: [1, 2], position: { x: 1.5, y: 0.33, z: 2.5 }, facingRad: 0 } }],
  loungeSeats: [],
  decor: [],
};

describe('isFloorLayout', () => {
  it('accepts a well-formed layout', () => {
    expect(isFloorLayout(validLayout)).toBe(true);
  });

  it('rejects garbage/unknown wire data rather than crashing the renderer', () => {
    expect(isFloorLayout(null)).toBe(false);
    expect(isFloorLayout({})).toBe(false);
    expect(isFloorLayout({ ...validLayout, desks: 'nope' })).toBe(false);
    expect(isFloorLayout({ ...validLayout, elevatorCell: [0] })).toBe(false);
  });
});

describe('perimeterWallCells', () => {
  it('excludes the elevator and fire-exit openings', () => {
    const cells = perimeterWallCells(validLayout);
    expect(cells).not.toContainEqual(validLayout.elevatorCell);
    expect(cells).not.toContainEqual(validLayout.fireExitCell);
  });

  it('covers every other perimeter cell exactly once', () => {
    const cells = perimeterWallCells(validLayout);
    // Perimeter of a 4x4 grid has 12 cells; minus the 2 openings = 10.
    expect(cells).toHaveLength(10);
    const unique = new Set(cells.map(([x, y]) => `${x},${y}`));
    expect(unique.size).toBe(10);
  });
});
