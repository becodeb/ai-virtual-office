/**
 * Grid occupancy and the declarative floor layout, per design.md §4 and the
 * office-simulation spec's grid-occupancy requirement.
 *
 * One grid cell = one world unit (`openspec/research/world-scale.md`). The
 * grid is built once at boot from `floor.json` and never mutated at runtime
 * — agent-vs-agent collision is intentionally ignored (design.md Architecture
 * Decisions), so only static furniture and seats occupy the grid.
 */
import rawFloor from './floor.json' with { type: 'json' };

/** Cell is free and walkable. */
export const CELL_FREE = 0;
/** Cell is permanently blocked by static furniture (desk body, walls, props). */
export const CELL_BLOCKED = 1;
/** Cell is a seat: walkable only as the exact destination of a path (its owner's terminus). */
export const CELL_SEAT = 2;

export type CellKind = typeof CELL_FREE | typeof CELL_BLOCKED | typeof CELL_SEAT;

export type Cell = readonly [number, number];

/** Seat height, per `world-scale.md` ("chair seat height: ~0.33"). */
export const CHAIR_SEAT_HEIGHT = 0.33;
/** Desk surface height, per `world-scale.md`. */
export const DESK_SURFACE_HEIGHT = 0.38;
/** Character standing height, per `world-scale.md`. */
export const STANDING_HEIGHT = 1.05;

/**
 * A seat's exact transform. `facingRad` is measured with 0 = facing +z
 * (south, increasing row index) and PI = facing -z (north, decreasing row
 * index), matching the grid's row-major (x, y) convention below.
 */
export interface SeatSocket {
  /** The seat's own grid cell (type `CELL_SEAT`). */
  cell: Cell;
  /** A* pathfinding target — identical to `cell` in this layout. */
  standCell: Cell;
  position: { x: number; y: number; z: number };
  facingRad: number;
}

export interface DeskLayout {
  id: string;
  /** The desk furniture's own cell (type `CELL_BLOCKED`). */
  cell: Cell;
  seat: SeatSocket;
  /** Desks flagged `window: true` are reserved for promoted identities (P1). */
  window: boolean;
}

export interface FloorLayout {
  width: number;
  height: number;
  elevatorCell: Cell;
  fireExitCell: Cell;
  kitchenCoffeeMachineCell: Cell;
  /** A free cell next to the coffee machine — the actual A* pathing target (the machine's own cell is blocked). */
  kitchenStandCell: Cell;
  meetingRoomScreenCell: Cell;
  /** The teddy bear's own cell (P1 teddy-bear debugging), blocked like any other prop. */
  bearCell: Cell;
  /** A free cell next to the bear — the actual A* pathing target. */
  bearStandCell: Cell;
  /** The Architect NPC's permanent corner-office cell (P1), blocked like any other static fixture. */
  architectCell: Cell;
  desks: DeskLayout[];
  loungeSeats: SeatSocket[];
}

type RawFacing = 'north' | 'south';

interface RawDesk {
  id: string;
  cell: [number, number];
  seatCell: [number, number];
  facing: RawFacing;
  window?: boolean;
}

interface RawSeat {
  cell: [number, number];
  facing: RawFacing;
}

interface RawFloor {
  width: number;
  height: number;
  elevatorCell: [number, number];
  fireExitCell: [number, number];
  kitchen: { coffeeMachineCell: [number, number]; standCell: [number, number] };
  meetingRoom: { screenCell: [number, number] };
  bear: { cell: [number, number]; standCell: [number, number] };
  architect: { cell: [number, number] };
  desks: RawDesk[];
  lounge: { seats: RawSeat[] };
}

function facingToRad(facing: RawFacing): number {
  return facing === 'south' ? 0 : Math.PI;
}

function seatSocketFromCell(cell: [number, number], facing: RawFacing): SeatSocket {
  return {
    cell,
    standCell: cell,
    position: { x: cell[0] + 0.5, y: CHAIR_SEAT_HEIGHT, z: cell[1] + 0.5 },
    facingRad: facingToRad(facing),
  };
}

/** Parses the raw `floor.json` into the typed {@link FloorLayout}. Pure — no I/O beyond the static import. */
export function parseFloorLayout(raw: RawFloor): FloorLayout {
  return {
    width: raw.width,
    height: raw.height,
    elevatorCell: raw.elevatorCell,
    fireExitCell: raw.fireExitCell,
    kitchenCoffeeMachineCell: raw.kitchen.coffeeMachineCell,
    kitchenStandCell: raw.kitchen.standCell,
    meetingRoomScreenCell: raw.meetingRoom.screenCell,
    bearCell: raw.bear.cell,
    bearStandCell: raw.bear.standCell,
    architectCell: raw.architect.cell,
    desks: raw.desks.map((d) => ({
      id: d.id,
      cell: d.cell,
      seat: seatSocketFromCell(d.seatCell, d.facing),
      window: d.window ?? false,
    })),
    loungeSeats: raw.lounge.seats.map((s) => seatSocketFromCell(s.cell, s.facing)),
  };
}

/** The default floor layout, loaded once from `floor.json`. */
export const DEFAULT_FLOOR_LAYOUT: FloorLayout = parseFloorLayout(rawFloor as RawFloor);

function cellsEqual(a: Cell, b: Cell): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Static occupancy grid built once from a {@link FloorLayout}. Perimeter
 * walls are derived (blocked border cells, with openings at the elevator and
 * fire exit), plus desk bodies, the coffee machine, and the meeting screen
 * are blocked; every seat cell (desk seats and lounge seats) is type
 * `CELL_SEAT`.
 */
export class Grid {
  readonly width: number;
  readonly height: number;
  private readonly cells: Uint8Array;

  private constructor(width: number, height: number, cells: Uint8Array, readonly layout: FloorLayout | null) {
    this.width = width;
    this.height = height;
    this.cells = cells;
  }

  /** Builds the occupancy grid from a declarative {@link FloorLayout} (the production path). */
  static fromLayout(layout: FloorLayout): Grid {
    const cells = new Uint8Array(layout.width * layout.height).fill(CELL_FREE);
    const grid = new Grid(layout.width, layout.height, cells, layout);

    // Perimeter walls, with openings at the elevator and fire exit.
    for (let x = 0; x < grid.width; x++) {
      grid.blockUnlessOpening(x, 0, layout);
      grid.blockUnlessOpening(x, grid.height - 1, layout);
    }
    for (let y = 0; y < grid.height; y++) {
      grid.blockUnlessOpening(0, y, layout);
      grid.blockUnlessOpening(grid.width - 1, y, layout);
    }

    for (const desk of layout.desks) {
      grid.set(desk.cell[0], desk.cell[1], CELL_BLOCKED);
      grid.set(desk.seat.cell[0], desk.seat.cell[1], CELL_SEAT);
    }
    for (const seat of layout.loungeSeats) {
      grid.set(seat.cell[0], seat.cell[1], CELL_SEAT);
    }
    grid.set(layout.kitchenCoffeeMachineCell[0], layout.kitchenCoffeeMachineCell[1], CELL_BLOCKED);
    grid.set(layout.meetingRoomScreenCell[0], layout.meetingRoomScreenCell[1], CELL_BLOCKED);
    grid.set(layout.bearCell[0], layout.bearCell[1], CELL_BLOCKED);
    grid.set(layout.architectCell[0], layout.architectCell[1], CELL_BLOCKED);
    return grid;
  }

  /**
   * Builds a bare grid directly from a row-major pattern of cell kinds — no
   * derived walls, desks, or seats. Used by unit tests that need hand-crafted
   * occupancy without floor-layout semantics.
   */
  static fromPattern(rows: readonly (readonly CellKind[])[]): Grid {
    const height = rows.length;
    const width = height > 0 ? rows[0]!.length : 0;
    const cells = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        cells[y * width + x] = rows[y]![x]!;
      }
    }
    return new Grid(width, height, cells, null);
  }

  private blockUnlessOpening(x: number, y: number, layout: FloorLayout): void {
    const cell: Cell = [x, y];
    if (cellsEqual(cell, layout.elevatorCell) || cellsEqual(cell, layout.fireExitCell)) {
      return;
    }
    this.set(x, y, CELL_BLOCKED);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Row-major cell index: `y * width + x`. Used for deterministic A* tie-breaks. */
  index(x: number, y: number): number {
    return y * this.width + x;
  }

  get(x: number, y: number): CellKind {
    return this.cells[this.index(x, y)] as CellKind;
  }

  private set(x: number, y: number, kind: CellKind): void {
    this.cells[this.index(x, y)] = kind;
  }

  /**
   * Whether `(x, y)` may be entered while pathing toward `goal`. Free cells
   * are always walkable; a seat cell is walkable only when it is the exact
   * goal (its owner's terminus); blocked cells are never walkable.
   */
  isWalkableToward(x: number, y: number, goal: Cell): boolean {
    if (!this.inBounds(x, y)) return false;
    const kind = this.get(x, y);
    if (kind === CELL_FREE) return true;
    if (kind === CELL_SEAT) return x === goal[0] && y === goal[1];
    return false;
  }
}

/** The office grid, built once at boot from {@link DEFAULT_FLOOR_LAYOUT}. */
export const DEFAULT_GRID: Grid = Grid.fromLayout(DEFAULT_FLOOR_LAYOUT);
