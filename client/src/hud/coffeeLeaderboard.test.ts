import { describe, expect, it } from 'vitest';
import { parseCoffeeLeaderboard } from './coffeeLeaderboard.js';

describe('parseCoffeeLeaderboard (defensive parsing — the frozen wire contract does not populate hud yet)', () => {
  it('returns null (not an empty array) for the current empty hud object', () => {
    expect(parseCoffeeLeaderboard({})).toBeNull();
  });

  it('returns null for non-object hud values', () => {
    expect(parseCoffeeLeaderboard(null)).toBeNull();
    expect(parseCoffeeLeaderboard(undefined)).toBeNull();
    expect(parseCoffeeLeaderboard('nonsense')).toBeNull();
  });

  it('parses and sorts a well-formed leaderboard, descending by count', () => {
    const result = parseCoffeeLeaderboard({
      coffeeLeaderboard: [
        { name: 'alice', count: 2 },
        { name: 'bob', count: 7 },
      ],
    });
    expect(result).toEqual([
      { name: 'bob', count: 7 },
      { name: 'alice', count: 2 },
    ]);
  });

  it('rejects a malformed entry rather than rendering partial/garbage data', () => {
    const result = parseCoffeeLeaderboard({ coffeeLeaderboard: [{ name: 'alice' }] });
    expect(result).toBeNull();
  });
});
