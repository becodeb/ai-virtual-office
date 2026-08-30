/**
 * Desk allocation and hot-desking, per design.md §2 and the world-state-hub
 * spec's desk-allocation + lounge-overflow requirements (decision 4).
 *
 * Allocation picks the free desk with the lowest A* cost from the elevator,
 * ties broken by lowest `deskId` — computed once at construction so
 * allocation itself is O(desks) and deterministic. Release pushes the desk
 * back to the free pool; if agents are waiting, the longest-waiting one is
 * assigned immediately (FIFO hot-desk handoff).
 */
import type { DeskLayout, FloorLayout, Grid } from './grid.js';
import { findPath } from './astar.js';

interface QueuedEntry {
  agentId: string;
  queuedAt: number;
}

export interface DeskReleaseResult {
  /** The agent immediately reassigned to the freed desk, if any waiter existed. */
  reassignedTo: string | null;
}

/** Orders desks by (A* cost from the elevator, deskId) ascending — the fixed, deterministic allocation order. */
function computeAllocationOrder(layout: FloorLayout, grid: Grid): DeskLayout[] {
  const withCost = layout.desks.map((desk) => {
    const path = findPath(grid, layout.elevatorCell as [number, number], desk.seat.standCell as [number, number]);
    // A desk unreachable from the elevator is placed last; this should never
    // happen for a well-formed layout, but must not throw.
    const cost = path?.cost ?? Number.POSITIVE_INFINITY;
    return { desk, cost };
  });
  withCost.sort((a, b) => {
    if (a.cost !== b.cost) return a.cost - b.cost;
    return a.desk.id < b.desk.id ? -1 : a.desk.id > b.desk.id ? 1 : 0;
  });
  return withCost.map((entry) => entry.desk);
}

export class DeskRegistry {
  private readonly orderedDesks: DeskLayout[];
  private readonly deskById: Map<string, DeskLayout>;
  private readonly occupiedBy = new Map<string, string>(); // deskId -> agentId
  private readonly deskOfAgent = new Map<string, string>(); // agentId -> deskId
  private readonly waitQueue: QueuedEntry[] = [];

  constructor(
    private readonly layout: FloorLayout,
    grid: Grid
  ) {
    this.orderedDesks = computeAllocationOrder(layout, grid);
    this.deskById = new Map(layout.desks.map((d) => [d.id, d]));
  }

  get desks(): readonly DeskLayout[] {
    return this.layout.desks;
  }

  getDesk(deskId: string): DeskLayout | undefined {
    return this.deskById.get(deskId);
  }

  isOccupied(deskId: string): boolean {
    return this.occupiedBy.has(deskId);
  }

  occupantOf(deskId: string): string | null {
    return this.occupiedBy.get(deskId) ?? null;
  }

  deskOf(agentId: string): string | null {
    return this.deskOfAgent.get(agentId) ?? null;
  }

  get waitingCount(): number {
    return this.waitQueue.length;
  }

  /**
   * Attempts to assign the lowest-cost free desk to `agentId`, optionally
   * restricted to window desks (P1 promotion perk). Returns `null` when no
   * matching desk is free — callers should then {@link enqueue} the agent.
   */
  tryAllocate(agentId: string, opts: { windowOnly?: boolean } = {}): DeskLayout | null {
    for (const desk of this.orderedDesks) {
      if (opts.windowOnly && !desk.window) continue;
      if (!this.occupiedBy.has(desk.id)) {
        this.occupiedBy.set(desk.id, agentId);
        this.deskOfAgent.set(agentId, desk.id);
        return desk;
      }
    }
    return null;
  }

  /** Appends `agentId` to the FIFO lounge wait queue. */
  enqueue(agentId: string, now: number): void {
    this.waitQueue.push({ agentId, queuedAt: now });
  }

  /** Removes `agentId` from the wait queue without assigning it a desk (e.g. it despawned while queued). */
  removeFromQueue(agentId: string): void {
    const idx = this.waitQueue.findIndex((e) => e.agentId === agentId);
    if (idx !== -1) this.waitQueue.splice(idx, 1);
  }

  /**
   * Frees `deskId` and, if any agent is waiting, immediately hands it to the
   * longest-waiting one (FIFO). The caller is responsible for transitioning
   * that agent's state (`QUEUED|LOUNGING -> WALKING`).
   */
  release(deskId: string): DeskReleaseResult {
    const priorOccupant = this.occupiedBy.get(deskId);
    this.occupiedBy.delete(deskId);
    if (priorOccupant !== undefined) this.deskOfAgent.delete(priorOccupant);

    const next = this.waitQueue.shift();
    if (next === undefined) {
      return { reassignedTo: null };
    }
    this.occupiedBy.set(deskId, next.agentId);
    this.deskOfAgent.set(next.agentId, deskId);
    return { reassignedTo: next.agentId };
  }
}
