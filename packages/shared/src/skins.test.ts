import { describe, expect, it } from 'vitest';
import { CURATED_SKINS, ROLE_SKIN_TABLE, EASTER_EGG_SKINS, FALLBACK_SKIN, FALLBACK_ROLE } from './skins.js';

describe('skin manifest', () => {
  it('curates exactly 27 skins', () => {
    expect(CURATED_SKINS).toHaveLength(27);
  });

  it('includes the fallback skin and role', () => {
    expect(CURATED_SKINS).toContain(FALLBACK_SKIN);
    expect(ROLE_SKIN_TABLE.some((entry) => entry.role === FALLBACK_ROLE)).toBe(true);
  });

  it('lists exactly three easter-egg skins', () => {
    expect(EASTER_EGG_SKINS).toHaveLength(3);
  });

  it('has no duplicate skin names', () => {
    expect(new Set(CURATED_SKINS).size).toBe(CURATED_SKINS.length);
  });
});
