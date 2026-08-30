/**
 * Client-side mirror of `server/src/world/grid.ts`'s `FloorLayout` shape.
 *
 * `WorldSnapshot.layout` is typed `unknown` on the wire (`packages/shared/src/protocol.ts`)
 * because the renderer must not import server-only code. The hub serialises
 * `world.layout` — the parsed `FloorLayout` — verbatim as JSON, so this type
 * mirrors that shape structurally without importing `server/`. `parseFloorLayout`
 * validates the shape defensively before the scene trusts it.
 */
export interface Cell2 {
  readonly 0: number;
  readonly 1: number;
}

export type Cell = readonly [number, number];

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface SeatSocket {
  cell: Cell;
  standCell: Cell;
  position: Vec3Like;
  facingRad: number;
}

export interface DeskLayout {
  id: string;
  cell: Cell;
  seat: SeatSocket;
  window: boolean;
}

export interface FloorLayout {
  width: number;
  height: number;
  elevatorCell: Cell;
  fireExitCell: Cell;
  kitchenCoffeeMachineCell: Cell;
  kitchenStandCell: Cell;
  meetingRoomScreenCell: Cell;
  bearCell: Cell;
  bearStandCell: Cell;
  architectCell: Cell;
  desks: DeskLayout[];
  loungeSeats: SeatSocket[];
  /** Cosmetic furniture; blocks its cell server-side but is purely visual here. */
  decor: Array<{ cell: Cell; prop: string }>;
}

function isCell(value: unknown): value is Cell {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number';
}

function isVec3(value: unknown): value is Vec3Like {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number';
}

function isSeatSocket(value: unknown): value is SeatSocket {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isCell(v.cell) && isCell(v.standCell) && isVec3(v.position) && typeof v.facingRad === 'number';
}

function isDeskLayout(value: unknown): value is DeskLayout {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && isCell(v.cell) && isSeatSocket(v.seat) && typeof v.window === 'boolean';
}

/** Structural guard — the renderer must never trust `WorldSnapshot.layout: unknown` blindly. */
export function isFloorLayout(value: unknown): value is FloorLayout {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.width === 'number' &&
    typeof v.height === 'number' &&
    isCell(v.elevatorCell) &&
    isCell(v.fireExitCell) &&
    isCell(v.kitchenCoffeeMachineCell) &&
    isCell(v.kitchenStandCell) &&
    isCell(v.meetingRoomScreenCell) &&
    isCell(v.bearCell) &&
    isCell(v.bearStandCell) &&
    isCell(v.architectCell) &&
    Array.isArray(v.desks) &&
    v.desks.every(isDeskLayout) &&
    Array.isArray(v.loungeSeats) &&
    v.loungeSeats.every(isSeatSocket) &&
    (v.decor === undefined || Array.isArray(v.decor))
  );
}

/** Perimeter wall cells, excluding the elevator and fire-exit openings — mirrors `Grid.fromLayout`'s wall derivation for rendering only. */
export function perimeterWallCells(layout: FloorLayout): Cell[] {
  const isOpening = (x: number, y: number): boolean =>
    (x === layout.elevatorCell[0] && y === layout.elevatorCell[1]) ||
    (x === layout.fireExitCell[0] && y === layout.fireExitCell[1]);

  const cells: Cell[] = [];
  for (let x = 0; x < layout.width; x++) {
    if (!isOpening(x, 0)) cells.push([x, 0]);
    if (!isOpening(x, layout.height - 1)) cells.push([x, layout.height - 1]);
  }
  for (let y = 1; y < layout.height - 1; y++) {
    if (!isOpening(0, y)) cells.push([0, y]);
    if (!isOpening(layout.width - 1, y)) cells.push([layout.width - 1, y]);
  }
  return cells;
}
