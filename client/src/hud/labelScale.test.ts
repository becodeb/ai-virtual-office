import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AGENT_LABEL_DISTANCE_FACTOR, labelScreenScale } from './labelScale.js';

describe('overlay label scale', () => {
  /**
   * Regression: `distanceFactor={8}` with an orthographic camera renders every
   * label at `zoom * 8`. At the zoom that frames a 16x12 floor on a phone that
   * is 296x — the label's dark background covers the viewport and the app looks
   * like it failed to render.
   */
  it('shows what distanceFactor actually costs on an orthographic camera', () => {
    expect(labelScreenScale(37, 8)).toBeCloseTo(296, 0);
    expect(labelScreenScale(60, 8)).toBeCloseTo(480, 0);
  });

  it('keeps labels at a constant on-screen size at every zoom', () => {
    for (const zoom of [12, 37, 60, 160]) {
      expect(labelScreenScale(zoom, AGENT_LABEL_DISTANCE_FACTOR)).toBe(1);
    }
  });

  it('the agent label never passes distanceFactor', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, 'Label.tsx'), 'utf8');
    expect(source).not.toMatch(/distanceFactor\s*=\s*\{/);
  });
});
