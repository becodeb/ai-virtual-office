import { describe, expect, it } from 'vitest';
import rawFloor from './floor.json' with { type: 'json' };
import { parseFloorLayout } from './grid.js';

const layout = parseFloorLayout(rawFloor as never);

describe('seat sockets', () => {
  /**
   * Regression: `facingToRad` handled only 'south' and 'north', silently
   * returning north for everything else. The desk banks face east and west, so
   * every chair in the office pointed away from its own desk — and nothing in
   * any log said so.
   */
  it('points every desk chair at its own desk', () => {
    for (const desk of layout.desks) {
      const forward = { x: Math.sin(desk.seat.facingRad), z: Math.cos(desk.seat.facingRad) };
      const toDesk = {
        x: desk.cell[0] - desk.seat.cell[0],
        z: desk.cell[1] - desk.seat.cell[1],
      };
      expect(
        forward.x * toDesk.x + forward.z * toDesk.z,
        `${desk.id} faces away from its desk`
      ).toBeGreaterThan(0);
    }
  });

  it('seats the chair close enough to the desk to read as one workstation', () => {
    for (const desk of layout.desks) {
      const gap = Math.hypot(
        desk.seat.position.x - (desk.cell[0] + 0.5),
        desk.seat.position.z - (desk.cell[1] + 0.5)
      );
      // The desk is 0.39 deep and the chair 0.31, so a centre-to-centre gap
      // past ~0.7 reads as furniture pushed apart rather than a workstation.
      expect(gap, `${desk.id} chair sits ${gap.toFixed(2)} from its desk`).toBeLessThan(0.7);
      expect(gap, `${desk.id} chair is inside its desk`).toBeGreaterThan(0.3);
    }
  });

  it('leaves lounge sofas centred on their own cell', () => {
    for (const seat of layout.loungeSeats) {
      expect(seat.position.x).toBeCloseTo(seat.cell[0] + 0.5, 6);
      expect(seat.position.z).toBeCloseTo(seat.cell[1] + 0.5, 6);
    }
  });
});

describe('floor layout', () => {
  /**
   * Density is about purpose, not desk count. An earlier version measured
   * cells-per-desk, which rewards cramming in workstations and says nothing
   * about what actually looked wrong: wide stretches of bare floor with no
   * reason to exist. Measure how much of the room is furnished instead.
   */
  it('leaves no large stretch of purposeless floor', () => {
    const occupied = new Set<string>();
    const mark = (c: readonly [number, number]) => occupied.add(`${c[0]},${c[1]}`);
    for (const d of layout.desks) {
      mark(d.cell);
      mark(d.seat.cell);
    }
    for (const s of layout.loungeSeats) mark(s.cell);
    for (const d of layout.decor) mark(d.cell);
    for (const c of [
      layout.kitchenCoffeeMachineCell,
      layout.meetingRoomScreenCell,
      layout.bearCell,
      layout.architectCell,
    ]) {
      mark(c);
    }

    const furnished = occupied.size / (layout.width * layout.height);
    expect(furnished, `only ${(furnished * 100).toFixed(0)}% of the floor has anything on it`).toBeGreaterThan(0.3);
  });

  it('keeps every fixture on the floor', () => {
    // With `walls: false` the outer ring is ordinary floor, so a fixture is
    // allowed to sit on it — that ring is exactly where furniture belongs.
    const margin = layout.walls ? 1 : 0;
    const inside = (c: readonly [number, number]) =>
      c[0] >= margin &&
      c[0] <= layout.width - 1 - margin &&
      c[1] >= margin &&
      c[1] <= layout.height - 1 - margin;
    const fixtures: Array<[string, readonly [number, number]]> = [
      ['elevator', layout.elevatorCell],
      ['fire exit', layout.fireExitCell],
      ['coffee machine', layout.kitchenCoffeeMachineCell],
      ['coffee stand', layout.kitchenStandCell],
      ['meeting screen', layout.meetingRoomScreenCell],
      ['bear', layout.bearCell],
      ['bear stand', layout.bearStandCell],
      ['architect', layout.architectCell],
      ...layout.desks.flatMap(
        (d): Array<[string, readonly [number, number]]> => [
          [`${d.id} desk`, d.cell],
          [`${d.id} seat`, d.seat.cell],
        ]
      ),
      ...layout.loungeSeats.map((s, i): [string, readonly [number, number]] => [`lounge ${i}`, s.cell]),
    ];
    for (const [name, cell] of fixtures) {
      expect(inside(cell), `${name} at ${JSON.stringify(cell)} is off the floor`).toBe(true);
    }
  });

  it('gives every fixture its own cell', () => {
    const seen = new Map<string, string>();
    const claim = (name: string, cell: readonly [number, number]): void => {
      const key = `${cell[0]},${cell[1]}`;
      expect(seen.get(key), `${name} shares a cell with ${seen.get(key)}`).toBeUndefined();
      seen.set(key, name);
    };
    claim('coffee machine', layout.kitchenCoffeeMachineCell);
    claim('meeting screen', layout.meetingRoomScreenCell);
    claim('bear', layout.bearCell);
    claim('architect', layout.architectCell);
    for (const d of layout.desks) {
      claim(`${d.id} desk`, d.cell);
      claim(`${d.id} seat`, d.seat.cell);
    }
    for (const [i, s] of layout.loungeSeats.entries()) claim(`lounge ${i}`, s.cell);
  });
});
