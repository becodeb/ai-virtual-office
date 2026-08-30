import { describe, expect, it } from 'vitest';
import { distance, fitZoomForFloor, isoOffsetForFloor, stepTowardFocusTarget } from './cameraMath.js';

const isoOffset = { x: 8, y: 10, z: 8 };

describe('stepTowardFocusTarget (office-renderer spec: Focus-Agent camera follows the selected character)', () => {
  it('moves the camera closer to agentPos + isoOffset with each step', () => {
    let camera = { x: 0, y: 0, z: 0 };
    const agentPos = { x: 5, y: 0, z: 5 };
    const target = { x: agentPos.x + isoOffset.x, y: agentPos.y + isoOffset.y, z: agentPos.z + isoOffset.z };

    const startDistance = distance(camera, target);
    for (let i = 0; i < 30; i++) {
      camera = stepTowardFocusTarget(camera, agentPos, isoOffset, 4, 1 / 60);
    }
    const endDistance = distance(camera, target);

    expect(endDistance).toBeLessThan(startDistance);
  });

  it('converges to the target after enough frames', () => {
    let camera = { x: 0, y: 0, z: 0 };
    const agentPos = { x: 5, y: 0, z: 5 };
    const target = { x: 13, y: 10, z: 13 };

    for (let i = 0; i < 600; i++) {
      camera = stepTowardFocusTarget(camera, agentPos, isoOffset, 4, 1 / 60);
    }

    expect(distance(camera, target)).toBeLessThan(0.01);
  });

  it('tracks the character as it moves — the target shifts, and the camera follows toward the new position', () => {
    let camera = { x: 13, y: 10, z: 13 }; // already settled at agentPos=(5,0,5) + isoOffset
    const movedAgentPos = { x: 12, y: 0, z: 5 }; // the character walked further along +x
    const oldTarget = { x: 13, y: 10, z: 13 };
    const newTarget = { x: 20, y: 10, z: 13 };

    camera = stepTowardFocusTarget(camera, movedAgentPos, isoOffset, 4, 1 / 60);

    // The camera is no longer sitting exactly on the stale target and has moved toward the new one.
    expect(distance(camera, oldTarget)).toBeGreaterThan(0);
    expect(distance(camera, newTarget)).toBeLessThan(distance({ x: 13, y: 10, z: 13 }, newTarget));
  });

  it('is a no-op when the camera is already exactly at the target', () => {
    const agentPos = { x: 0, y: 0, z: 0 };
    const settled = { x: isoOffset.x, y: isoOffset.y, z: isoOffset.z };
    const next = stepTowardFocusTarget(settled, agentPos, isoOffset, 4, 1 / 60);
    expect(next).toEqual(settled);
  });
});

describe('fitZoomForFloor', () => {
  /**
   * Regression: the zoom was pinned to 60, which shows about 15 world units on
   * a phone in portrait. A 24-unit floor ran straight off the screen and the
   * office looked like it had been cut in half.
   */
  it('frames the whole floor on a portrait phone', () => {
    const zoom = fitZoomForFloor(16, 12, 923, 1600);
    const visibleUnits = Math.min(923, 1600) / zoom;
    expect(visibleUnits).toBeGreaterThanOrEqual(Math.hypot(16, 12));
  });

  it('frames the whole floor on a wide desktop', () => {
    const zoom = fitZoomForFloor(16, 12, 2560, 1440);
    const visibleUnits = Math.min(2560, 1440) / zoom;
    expect(visibleUnits).toBeGreaterThanOrEqual(Math.hypot(16, 12));
  });

  it('zooms out for a bigger floor rather than cropping it', () => {
    expect(fitZoomForFloor(40, 30, 1000, 1000)).toBeLessThan(fitZoomForFloor(16, 12, 1000, 1000));
  });

  it('never returns a non-positive zoom for a degenerate floor', () => {
    expect(fitZoomForFloor(0, 0, 1000, 1000)).toBeGreaterThan(0);
  });
});

describe('isoOffsetForFloor', () => {
  it('grows with the floor so the camera always clears it', () => {
    const small = isoOffsetForFloor(16, 12);
    const large = isoOffsetForFloor(40, 30);
    expect(large.y).toBeGreaterThan(small.y);
    expect(small.y).toBeGreaterThan(12 * 0.5);
  });
});
