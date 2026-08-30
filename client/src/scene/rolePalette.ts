/**
 * Role/machine tinting on top of the pipeline's baked vertex colours
 * (design.md "Role tinting on top of baked vertex colours", superseded by
 * decision 9's `_slot` attribute — this module implements decision 9's exact
 * per-vertex join, not the design doc's seam-priority range heuristic).
 *
 * Design.md's palette strategy still applies: the client clones the skin's
 * geometry once **per palette** (here: per machine family), never per agent,
 * and overwrites one named slot's baked colour with the palette colour — so
 * N agents sharing a skin+palette still share one geometry and one draw call
 * (`openspec/research/animation-retargeting.md`'s instancing guarantee).
 * Role already determines which skin file loads at all (`packages/shared/src/skins.ts`'s
 * `ROLE_SKIN_TABLE` — no skin file is shared by two roles), so "role tinting"
 * plus decision 2's "sessions on the same machine read as coworkers" reduces
 * to: tint one clothing-ish slot by a colour derived from `machineId`.
 *
 * MEASURED, not assumed: the pipeline writes a three.js geometry attribute
 * named `_slot` (`packages/assets-pipeline/src/optimize.ts`), but
 * `GLTFExporter` serialises it as the glTF attribute `__SLOT`, and
 * `GLTFLoader` lowercases unknown attributes verbatim — so the attribute
 * name on a *loaded* character mesh is `__slot` (double underscore), not
 * `_slot`. Confirmed by actually loading `Worker_Male.glb` through
 * `GLTFLoader` and inspecting `geometry.attributes` — the exact same
 * "three.js sanitises names" trap the retargeting research doc already hit
 * once with bone names.
 */
import * as THREE from 'three';

/** The loaded geometry attribute name for the pipeline's `_slot` data (see module doc — measured, not `_slot`). */
export const SLOT_ATTRIBUTE_NAME = '__slot';

/** Slots that read as skin/face/hair and must never be recoloured by a role/machine palette. */
const NEVER_TINT_SLOTS = new Set(['Skin', 'Face', 'Hair', 'Bones', 'Guts']);

/** Preferred slot names to tint, in priority order, when present on a given skin's `slotNames`. */
const PREFERRED_TINT_SLOTS = ['Shirt', 'Vest', 'DarkClothes', 'Details', 'Belt', 'Hat'];

/** Picks the best available slot to tint for this skin's palette, or `null` if every slot is off-limits. */
export function pickTintSlotName(slotNames: readonly string[]): string | null {
  for (const preferred of PREFERRED_TINT_SLOTS) {
    if (slotNames.includes(preferred)) return preferred;
  }
  const fallback = slotNames.find((name) => !NEVER_TINT_SLOTS.has(name));
  return fallback ?? null;
}

/** A small, deterministic hash — no crypto needed, just a stable machineId -> hue mapping. */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic, saturated palette colour for a machine family (decision 2: "sessions on the same machine share a skin family so they read as coworkers"). */
export function paletteColorForMachine(machineId: string): THREE.Color {
  const hue = (hashString(machineId) % 360) / 360;
  return new THREE.Color().setHSL(hue, 0.55, 0.5);
}

/**
 * Clones `sourceGeometry` and overwrites the target slot's baked `color`
 * (COLOR_0) with `tint`, using the exact per-vertex `_slot` join from
 * decision 9. Pure with respect to `sourceGeometry` — never mutates it.
 * Returns the original geometry unchanged (not cloned) if no slot attribute,
 * color attribute, or matching slot index exists, so a geometry that predates
 * this feature still renders with its baked default colours.
 */
export function applyPaletteTint(
  sourceGeometry: THREE.BufferGeometry,
  slotNames: readonly string[],
  targetSlotName: string,
  tint: THREE.Color
): THREE.BufferGeometry {
  const slotIndex = slotNames.indexOf(targetSlotName);
  const slotAttr = sourceGeometry.getAttribute(SLOT_ATTRIBUTE_NAME);
  const colorAttr = sourceGeometry.getAttribute('color');
  if (slotIndex < 0 || slotAttr === undefined || colorAttr === undefined) return sourceGeometry;

  const geometry = sourceGeometry.clone();
  const clonedColor = geometry.getAttribute('color') as THREE.BufferAttribute;
  const clonedSlot = geometry.getAttribute(SLOT_ATTRIBUTE_NAME) as THREE.BufferAttribute;
  const itemSize = clonedColor.itemSize;

  for (let i = 0; i < clonedSlot.count; i++) {
    if (Math.round(clonedSlot.getX(i)) !== slotIndex) continue;
    clonedColor.setX(i, tint.r);
    clonedColor.setY(i, tint.g);
    clonedColor.setZ(i, tint.b);
    if (itemSize > 3) clonedColor.setW(i, 1);
  }
  clonedColor.needsUpdate = true;
  return geometry;
}

/** Cache key for the shared-per-palette geometry clone (design.md: "N palettes produce N geometries shared by every agent using them"). */
export function paletteCacheKey(skinName: string, machineId: string): string {
  return `${skinName}::${machineId}`;
}
