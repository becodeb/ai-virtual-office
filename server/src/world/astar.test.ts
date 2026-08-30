import { describe, expect, it } from 'vitest';
import { CELL_BLOCKED, CELL_FREE, CELL_SEAT, Grid } from './grid.js';
import { findPath, octile } from './astar.js';

const F = CELL_FREE;
const B = CELL_BLOCKED;
const S = CELL_SEAT;

describe('octile heuristic', () => {
  it('equals the orthogonal distance when one axis is zero', () => {
    expect(octile(4, 0)).toBe(4);
    expect(octile(0, 3)).toBe(3);
  });

  it('equals sqrt(2) times the diagonal distance on a pure diagonal', () => {
    expect(octile(3, 3)).toBeCloseTo(3 * Math.SQRT2, 10);
  });

  it('matches the hand-computed mixed case: dx=5, dy=2', () => {
    // h = (dx + dy) + (sqrt2 - 2) * min(dx, dy) = 7 + (sqrt2 - 2) * 2
    const expected = 7 + (Math.SQRT2 - 2) * 2;
    expect(octile(5, 2)).toBeCloseTo(expected, 10);
  });
});

describe('findPath', () => {
  it('finds the optimal straight diagonal path across an open grid', () => {
    const grid = Grid.fromPattern([
      [F, F, F, F],
      [F, F, F, F],
      [F, F, F, F],
      [F, F, F, F],
    ]);
    const result = findPath(grid, [0, 0], [3, 3]);
    expect(result).not.toBeNull();
    expect(result!.cost).toBeCloseTo(3 * Math.SQRT2, 10);
    expect(result!.cells[0]).toEqual([0, 0]);
    expect(result!.cells[result!.cells.length - 1]).toEqual([3, 3]);
  });

  it('refuses to cut a diagonal corner through a wall gap', () => {
    // (2,1) and (1,2) are blocked, so the direct diagonal step from (1,1) to
    // the open cell (2,2) would cut between two blocked orthogonal
    // neighbours — illegal. Plenty of open space elsewhere gives a legal,
    // strictly longer route around.
    const grid = Grid.fromPattern([
      [F, F, F, F, F],
      [F, F, B, F, F],
      [F, B, F, F, F],
      [F, F, F, F, F],
      [F, F, F, F, F],
    ]);
    const result = findPath(grid, [1, 1], [2, 2]);
    expect(result).not.toBeNull();
    // The only legal route is the long way around, cost > the direct diagonal (sqrt2).
    expect(result!.cost).toBeGreaterThan(Math.SQRT2);
  });

  it('returns null when the destination is fully enclosed by furniture', () => {
    const grid = Grid.fromPattern([
      [F, F, F, F, F],
      [F, B, B, B, F],
      [F, B, F, B, F],
      [F, B, B, B, F],
      [F, F, F, F, F],
    ]);
    const result = findPath(grid, [0, 0], [2, 2]);
    expect(result).toBeNull();
  });

  it('reaches a seat cell as a destination even though seats block pass-through', () => {
    const grid = Grid.fromPattern([
      [F, F, F],
      [F, S, F],
      [F, F, F],
    ]);
    const result = findPath(grid, [0, 0], [1, 1]);
    expect(result).not.toBeNull();
    expect(result!.cells[result!.cells.length - 1]).toEqual([1, 1]);
  });

  it('never paths through a seat cell that is not the goal', () => {
    // The only route from (0,1) to (2,1) that avoids the blocked row above
    // and below must pass through the seat at (1,1) — which is legal only
    // as a terminus, so with a different goal, that route is unavailable.
    const grid = Grid.fromPattern([
      [B, B, B],
      [F, S, F],
      [B, B, B],
    ]);
    const result = findPath(grid, [0, 1], [2, 1]);
    expect(result).toBeNull();
  });

  it('produces a byte-identical (deep-equal) path across repeated runs', () => {
    const grid = Grid.fromPattern([
      [F, F, F, F, F, F],
      [F, B, B, F, B, F],
      [F, F, F, F, B, F],
      [F, B, F, B, B, F],
      [F, B, F, F, F, F],
      [F, F, F, B, B, F],
    ]);
    const first = findPath(grid, [0, 0], [5, 5]);
    const second = findPath(grid, [0, 0], [5, 5]);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
  });

  it('returns zero-cost single-cell path when start equals goal', () => {
    const grid = Grid.fromPattern([[F]]);
    const result = findPath(grid, [0, 0], [0, 0]);
    expect(result).toEqual({ cells: [[0, 0]], cost: 0 });
  });
});
