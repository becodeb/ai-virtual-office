import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SLOT_ATTRIBUTE_NAME, applyPaletteTint, paletteColorForMachine, pickTintSlotName } from './rolePalette.js';

describe('pickTintSlotName', () => {
  it('prefers Shirt when present', () => {
    expect(pickTintSlotName(['Skin', 'Shirt', 'Pants', 'Face'])).toBe('Shirt');
  });

  it('falls back through the preferred list', () => {
    expect(pickTintSlotName(['Skin', 'Vest', 'Face'])).toBe('Vest');
  });

  it('never tints Skin, Face, or Hair', () => {
    const slot = pickTintSlotName(['Skin', 'Face', 'Hair']);
    expect(slot).toBeNull();
  });

  it('falls back to the first non-forbidden slot when nothing preferred is present', () => {
    expect(pickTintSlotName(['Skin', 'Guts', 'Bones', 'Cape'])).toBe('Cape');
  });
});

describe('paletteColorForMachine', () => {
  it('is deterministic for the same machineId', () => {
    const a = paletteColorForMachine('foo-laptop');
    const b = paletteColorForMachine('foo-laptop');
    expect(a.getHex()).toBe(b.getHex());
  });

  it('differs (with overwhelming likelihood) for different machine ids', () => {
    const a = paletteColorForMachine('foo-laptop');
    const b = paletteColorForMachine('bar-desktop');
    expect(a.getHex()).not.toBe(b.getHex());
  });
});

function buildTestGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  // 4 vertices: 2 in slot 0 ("Skin"), 2 in slot 1 ("Shirt").
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0], 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 3));
  geometry.setAttribute(SLOT_ATTRIBUTE_NAME, new THREE.Float32BufferAttribute([0, 0, 1, 1], 1));
  return geometry;
}

describe('applyPaletteTint (decision 9: exact per-vertex _slot join, measured attribute name __slot)', () => {
  it('overwrites only the target slot vertices, leaving others untouched', () => {
    const source = buildTestGeometry();
    const tint = new THREE.Color(0.1, 0.2, 0.3);
    const result = applyPaletteTint(source, ['Skin', 'Shirt'], 'Shirt', tint);

    const color = result.getAttribute('color') as THREE.BufferAttribute;
    // Vertices 0,1 are slot 0 ("Skin") — untouched.
    expect(color.getX(0)).toBeCloseTo(1, 5);
    expect(color.getX(1)).toBeCloseTo(1, 5);
    // Vertices 2,3 are slot 1 ("Shirt") — tinted.
    expect(color.getX(2)).toBeCloseTo(0.1, 5);
    expect(color.getY(2)).toBeCloseTo(0.2, 5);
    expect(color.getZ(2)).toBeCloseTo(0.3, 5);
    expect(color.getX(3)).toBeCloseTo(0.1, 5);
  });

  it('never mutates the source geometry (clones stay per-palette, shared geometry stays safe to reuse)', () => {
    const source = buildTestGeometry();
    const originalColor = (source.getAttribute('color') as THREE.BufferAttribute).array.slice();
    applyPaletteTint(source, ['Skin', 'Shirt'], 'Shirt', new THREE.Color(0, 0, 0));
    expect((source.getAttribute('color') as THREE.BufferAttribute).array).toEqual(originalColor);
  });

  it('returns the original geometry unchanged when the target slot name is not in slotNames', () => {
    const source = buildTestGeometry();
    const result = applyPaletteTint(source, ['Skin', 'Shirt'], 'NoSuchSlot', new THREE.Color(0, 0, 0));
    expect(result).toBe(source);
  });

  it('returns the original geometry unchanged when the __slot attribute is missing entirely', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1], 3));
    const result = applyPaletteTint(geometry, ['Skin', 'Shirt'], 'Shirt', new THREE.Color(0, 0, 0));
    expect(result).toBe(geometry);
  });
});
