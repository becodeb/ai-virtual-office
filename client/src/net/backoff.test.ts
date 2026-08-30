import { describe, expect, it } from 'vitest';
import { BACKOFF_MAX_MS, BACKOFF_MIN_MS, backoffDelayMs } from './backoff.js';

describe('backoffDelayMs (task 4.2: 500ms -> 8s, +/-20% jitter)', () => {
  it('attempt 0 stays within the minimum bound +/-20%', () => {
    const delay = backoffDelayMs(0, () => 0.5); // no jitter offset
    expect(delay).toBe(BACKOFF_MIN_MS);
  });

  it('doubles per attempt up to the 8s ceiling', () => {
    expect(backoffDelayMs(1, () => 0.5)).toBe(1000);
    expect(backoffDelayMs(2, () => 0.5)).toBe(2000);
    expect(backoffDelayMs(3, () => 0.5)).toBe(4000);
    expect(backoffDelayMs(4, () => 0.5)).toBe(BACKOFF_MAX_MS);
    expect(backoffDelayMs(10, () => 0.5)).toBe(BACKOFF_MAX_MS); // never exceeds the ceiling
  });

  it('applies +/-20% jitter around the base delay', () => {
    const high = backoffDelayMs(0, () => 1); // random()=1 -> +20%
    const low = backoffDelayMs(0, () => 0); // random()=0 -> -20%
    expect(high).toBeCloseTo(BACKOFF_MIN_MS * 1.2, 5);
    expect(low).toBeCloseTo(BACKOFF_MIN_MS * 0.8, 5);
  });

  it('never returns a delay outside the documented [min*0.8, max*1.2] envelope', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 1]) {
      for (let attempt = 0; attempt <= 6; attempt++) {
        const delay = backoffDelayMs(attempt, () => r);
        expect(delay).toBeGreaterThanOrEqual(BACKOFF_MIN_MS * 0.8);
        expect(delay).toBeLessThanOrEqual(BACKOFF_MAX_MS * 1.2);
      }
    }
  });
});
