import { describe, expect, it } from 'vitest';
import { KONAMI_SEQUENCE, MOO_SEQUENCE, matchesTrailingSequence } from './keySequence.js';

describe('matchesTrailingSequence (Konami code / moo easter eggs)', () => {
  it('matches when the trailing window equals the sequence exactly', () => {
    expect(matchesTrailingSequence(['m', 'o', 'o'], MOO_SEQUENCE)).toBe(true);
  });

  it('matches when extra keys precede the sequence', () => {
    expect(matchesTrailingSequence(['x', 'y', 'm', 'o', 'o'], MOO_SEQUENCE)).toBe(true);
  });

  it('does not match a shorter buffer than the sequence', () => {
    expect(matchesTrailingSequence(['o', 'o'], MOO_SEQUENCE)).toBe(false);
  });

  it('does not match out-of-order keys', () => {
    expect(matchesTrailingSequence(['o', 'o', 'm'], MOO_SEQUENCE)).toBe(false);
  });

  it('matches the full Konami sequence', () => {
    expect(matchesTrailingSequence([...KONAMI_SEQUENCE], KONAMI_SEQUENCE)).toBe(true);
  });

  it('does not match a single wrong key in the Konami sequence', () => {
    const almost: string[] = [...KONAMI_SEQUENCE];
    almost[almost.length - 1] = 'x';
    expect(matchesTrailingSequence(almost, KONAMI_SEQUENCE)).toBe(false);
  });
});
