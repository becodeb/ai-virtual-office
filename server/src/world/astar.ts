/**
 * Server-authoritative A* pathfinding over the static occupancy grid, per
 * design.md §4 and the office-simulation spec's pathfinding requirement.
 *
 * 8-connected, no corner-cutting, octile heuristic (the only admissible and
 * consistent heuristic for this move set — Manhattan over-estimates on
 * diagonals and returns non-optimal paths). Deterministic tie-break (lower
 * `f`, then lower `h`, then lower cell index) makes every path
 * byte-identical across repeated runs on the same input.
 */
import type { Cell, Grid } from './grid.js';

const SQRT2 = Math.sqrt(2);

/** Octile distance heuristic: exact cost of the cheapest unobstructed path for 8-connected movement. */
export function octile(dx: number, dy: number): number {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  return adx + ady + (SQRT2 - 2) * Math.min(adx, ady);
}

export interface PathResult {
  /** Smoothed path from start to goal, inclusive of both endpoints. */
  cells: Cell[];
  /** Raw (unsmoothed) path cost — the true shortest-path cost A* found. */
  cost: number;
}

interface OpenEntry {
  index: number;
  cell: Cell;
  f: number;
  h: number;
}

/** Binary min-heap over `f`, tie-broken by `h` then cell index (both ascending). */
class OpenSet {
  private heap: OpenEntry[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(entry: OpenEntry): void {
    this.heap.push(entry);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): OpenEntry | undefined {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last !== undefined) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private lessThan(a: OpenEntry, b: OpenEntry): boolean {
    if (a.f !== b.f) return a.f < b.f;
    if (a.h !== b.h) return a.h < b.h;
    return a.index < b.index;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const entry = this.heap[i];
      const parentEntry = this.heap[parent];
      if (entry === undefined || parentEntry === undefined || !this.lessThan(entry, parentEntry)) break;
      this.heap[i] = parentEntry;
      this.heap[parent] = entry;
      i = parent;
    }
  }

  private bubbleDown(i: number): void {
    const n = this.heap.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      const smallestEntry = this.heap[smallest];
      if (smallestEntry === undefined) break;
      if (left < n) {
        const leftEntry = this.heap[left];
        if (leftEntry !== undefined && this.lessThan(leftEntry, this.heap[smallest]!)) smallest = left;
      }
      if (right < n) {
        const rightEntry = this.heap[right];
        if (rightEntry !== undefined && this.lessThan(rightEntry, this.heap[smallest]!)) smallest = right;
      }
      if (smallest === i) break;
      const tmp = this.heap[i]!;
      this.heap[i] = this.heap[smallest]!;
      this.heap[smallest] = tmp;
      i = smallest;
    }
  }
}

const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function stepCost(dx: number, dy: number): number {
  return dx !== 0 && dy !== 0 ? SQRT2 : 1;
}

/**
 * Whether the diagonal step from `(x, y)` toward `(x + dx, y + dy)` is legal:
 * both orthogonal neighbours must be open (no cutting through a wall corner).
 */
function diagonalIsOpen(grid: Grid, x: number, y: number, dx: number, dy: number, goal: Cell): boolean {
  return grid.isWalkableToward(x + dx, y, goal) && grid.isWalkableToward(x, y + dy, goal);
}

function reconstructPath(cameFrom: Map<number, number>, grid: Grid, goalIndex: number, start: Cell): Cell[] {
  const path: Cell[] = [];
  let current: number | undefined = goalIndex;
  while (current !== undefined) {
    const x = current % grid.width;
    const y = Math.floor(current / grid.width);
    path.push([x, y]);
    if (x === start[0] && y === start[1]) break;
    current = cameFrom.get(current);
  }
  path.reverse();
  return path;
}

/**
 * Bresenham supercover line between two cells, inclusive of both endpoints.
 * Used by path smoothing to test line-of-sight.
 */
function bresenhamLine(a: Cell, b: Cell): Cell[] {
  let x0 = a[0];
  let y0 = a[1];
  const x1 = b[0];
  const y1 = b[1];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const points: Cell[] = [[x0, y0]];
  while (!(x0 === x1 && y0 === y1)) {
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
    points.push([x0, y0]);
  }
  return points;
}

/** Whether the straight segment `a -> b` crosses no blocked cell and cuts no corner. */
function hasLineOfSight(grid: Grid, a: Cell, b: Cell, goal: Cell): boolean {
  const points = bresenhamLine(a, b);
  for (const [x, y] of points) {
    if (!grid.isWalkableToward(x, y, goal)) return false;
  }
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dx !== 0 && dy !== 0 && !diagonalIsOpen(grid, x0, y0, dx, dy, goal)) return false;
  }
  return true;
}

/** Any-angle string-pulling: replaces the staircase raw path with the fewest straight, unobstructed segments. */
function smoothPath(grid: Grid, path: Cell[], goal: Cell): Cell[] {
  if (path.length <= 2) return path;
  const result: Cell[] = [path[0]!];
  let anchor = 0;
  while (anchor < path.length - 1) {
    let farthest = anchor + 1;
    for (let j = path.length - 1; j > anchor + 1; j--) {
      if (hasLineOfSight(grid, path[anchor]!, path[j]!, goal)) {
        farthest = j;
        break;
      }
    }
    result.push(path[farthest]!);
    anchor = farthest;
  }
  return result;
}

/**
 * Finds the optimal path from `start` to `goal` on `grid`. Returns `null` if
 * no path exists (goal is unreachable) rather than moving through blocked
 * cells.
 */
export function findPath(grid: Grid, start: Cell, goal: Cell): PathResult | null {
  if (!grid.inBounds(start[0], start[1]) || !grid.inBounds(goal[0], goal[1])) return null;
  if (!grid.isWalkableToward(goal[0], goal[1], goal)) return null;

  const startIndex = grid.index(start[0], start[1]);
  const goalIndex = grid.index(goal[0], goal[1]);

  if (startIndex === goalIndex) {
    return { cells: [start], cost: 0 };
  }

  const gScore = new Map<number, number>([[startIndex, 0]]);
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  const open = new OpenSet();
  open.push({ index: startIndex, cell: start, f: octile(goal[0] - start[0], goal[1] - start[1]), h: octile(goal[0] - start[0], goal[1] - start[1]) });

  while (open.size > 0) {
    const current = open.pop()!;
    if (current.index === goalIndex) {
      const rawPath = reconstructPath(cameFrom, grid, goalIndex, start);
      return { cells: smoothPath(grid, rawPath, goal), cost: gScore.get(goalIndex)! };
    }
    if (closed.has(current.index)) continue;
    closed.add(current.index);

    const [cx, cy] = current.cell;
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!grid.isWalkableToward(nx, ny, goal)) continue;
      if (dx !== 0 && dy !== 0 && !diagonalIsOpen(grid, cx, cy, dx, dy, goal)) continue;

      const neighborIndex = grid.index(nx, ny);
      if (closed.has(neighborIndex)) continue;

      const currentG = gScore.get(current.index)!;
      const candidateG = currentG + stepCost(dx, dy);
      const existingG = gScore.get(neighborIndex);
      if (existingG === undefined || candidateG < existingG) {
        gScore.set(neighborIndex, candidateG);
        cameFrom.set(neighborIndex, current.index);
        const h = octile(goal[0] - nx, goal[1] - ny);
        open.push({ index: neighborIndex, cell: [nx, ny], f: candidateG + h, h });
      }
    }
  }

  return null;
}
