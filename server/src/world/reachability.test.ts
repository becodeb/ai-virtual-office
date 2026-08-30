/**
 * Every place a character can be sent must be reachable — checked with the
 * office's own A*, not a re-implementation of it.
 *
 * An earlier version of this check was a separate script that did a 4-connected
 * flood fill and treated seats as walkable. The real `findPath` refuses to
 * route *through* a seat, so the script reported a clean layout while the
 * kitchen and the entire lounge were sealed behind a bookcase. A validator that
 * models the rules slightly differently from the thing it validates is worse
 * than no validator: it produces confidence instead of information.
 */
import { describe, expect, it } from 'vitest';
import { findPath } from './astar.js';
import { createWorld } from './machine.js';

const world = createWorld();
const { layout, grid } = world;

/** Everywhere the state machine can ever send a character. */
const destinations: Array<[string, readonly [number, number]]> = [
  ['the kitchen', layout.kitchenStandCell],
  ['the teddy bear', layout.bearStandCell],
  ['the fire exit', layout.fireExitCell],
  ...layout.desks.map((d): [string, readonly [number, number]] => [`${d.id}'s seat`, d.seat.standCell]),
  ...layout.loungeSeats.map((s, i): [string, readonly [number, number]] => [`lounge seat ${i}`, s.standCell]),
];

describe('every destination is reachable from the elevator', () => {
  it.each(destinations)('a character can walk to %s', (_name, cell) => {
    const path = findPath(grid, layout.elevatorCell, cell);
    expect(path, `no path from the elevator to ${JSON.stringify(cell)}`).not.toBeNull();
  });
});

describe('every destination is reachable from a desk', () => {
  const seat = layout.desks[0]?.seat.standCell;

  it.each(destinations)('a seated character can get to %s', (_name, cell) => {
    expect(seat).toBeDefined();
    const path = findPath(grid, seat!, cell);
    expect(path, `no path from a desk to ${JSON.stringify(cell)}`).not.toBeNull();
  });
});

describe('the floor stays dense', () => {
  it('does not sprawl: an office is not a warehouse with desks in it', () => {
    const cellsPerDesk = (layout.width * layout.height) / layout.desks.length;
    expect(cellsPerDesk, `${layout.width}x${layout.height} for ${layout.desks.length} desks`).toBeLessThan(12);
  });

  it('is furnished beyond the desks themselves', () => {
    expect(layout.decor.length).toBeGreaterThanOrEqual(10);
  });
});
