import { describe, expect, it } from 'vitest';
import { headingFor, sampleWalk } from './walkPath.js';

/** An L-shaped route: three cells east, then three cells south. */
const L_ROUTE: Array<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [2, 0],
  [2, 1],
  [2, 2],
];

describe('sampleWalk', () => {
  /**
   * Regression: the client used to lerp straight from where a character was to
   * where it would sit. It cut through furniture, and because the only heading
   * available was the destination chair's, characters crossed the office
   * facing backwards.
   */
  it('follows the route rather than the straight line to its end', () => {
    const halfway = sampleWalk(L_ROUTE, 1, 2, 0)!;
    // Two cells along an L that turns after three: still on the first leg.
    expect(halfway.position.z).toBeCloseTo(0.5, 5);
    expect(halfway.position.x).toBeGreaterThan(1);

    const straightLine = { x: (0.5 + 2.5) / 2, z: (0.5 + 2.5) / 2 };
    expect(Math.abs(halfway.position.z - straightLine.z)).toBeGreaterThan(0.5);
  });

  it('faces the direction of travel, and turns at the corner', () => {
    const onFirstLeg = sampleWalk(L_ROUTE, 1, 1, 0)!;
    expect(onFirstLeg.facingRad).toBeCloseTo(headingFor(1, 0), 5); // heading east

    const afterCorner = sampleWalk(L_ROUTE, 1, 3, 0)!;
    expect(afterCorner.facingRad).toBeCloseTo(headingFor(0, 1), 5); // now heading south
  });

  it('reports arrival once the whole route is walked, and stops at the last cell', () => {
    const done = sampleWalk(L_ROUTE, 1, 999, 0)!;
    expect(done.arrived).toBe(true);
    expect(done.position).toEqual({ x: 2.5, z: 2.5 });
  });

  it('is not yet arrived while there is route left', () => {
    expect(sampleWalk(L_ROUTE, 1, 0.1, 0)!.arrived).toBe(false);
  });

  it('starts at the first cell centre', () => {
    const start = sampleWalk(L_ROUTE, 1, 0, 0)!;
    expect(start.position).toEqual({ x: 0.5, z: 0.5 });
  });

  it('respects the speed the hub planned with', () => {
    const slow = sampleWalk(L_ROUTE, 1, 1, 0)!;
    const fast = sampleWalk(L_ROUTE, 2, 1, 0)!;
    expect(fast.position.x).toBeGreaterThan(slow.position.x);
  });

  it('handles a one-cell route without inventing a heading', () => {
    const single = sampleWalk([[4, 4]], 1, 5, 1.23)!;
    expect(single.arrived).toBe(true);
    expect(single.facingRad).toBe(1.23);
    expect(single.position).toEqual({ x: 4.5, z: 4.5 });
  });

  it('returns nothing for an empty route', () => {
    expect(sampleWalk([], 1, 1, 0)).toBeNull();
  });
});

describe('headingFor', () => {
  it('uses the world convention: 0 faces +z', () => {
    expect(headingFor(0, 1)).toBeCloseTo(0, 5);
    expect(headingFor(1, 0)).toBeCloseTo(Math.PI / 2, 5);
    expect(headingFor(0, -1)).toBeCloseTo(Math.PI, 5);
    expect(headingFor(-1, 0)).toBeCloseTo(-Math.PI / 2, 5);
  });
});
