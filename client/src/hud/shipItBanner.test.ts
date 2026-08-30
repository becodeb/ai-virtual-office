import { describe, expect, it } from 'vitest';
import { resolveShipItBanner } from './shipItBanner.js';

describe('resolveShipItBanner (office-renderer spec: Ship-It Event Labeled as Inferred)', () => {
  it('is hidden when there is no active celebration', () => {
    expect(resolveShipItBanner(false, true)).toEqual({ visible: false, text: '' });
  });

  it('always includes the word "inferred" when inferred=true, never claiming a verified pass', () => {
    const content = resolveShipItBanner(true, true);
    expect(content.visible).toBe(true);
    expect(content.text.toLowerCase()).toContain('inferred');
    expect(content.text.toLowerCase()).not.toContain('verified test pass without');
  });

  it('never says "verified" for an inferred celebration', () => {
    const content = resolveShipItBanner(true, true);
    expect(content.text.toLowerCase()).not.toMatch(/^ship it! \(verified/);
  });
});
