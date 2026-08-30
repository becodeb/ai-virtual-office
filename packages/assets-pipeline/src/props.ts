/**
 * Stage 7 — props.
 *
 * Kenney office props already ship as `.glb` — zero conversion needed.
 * Copies the exact set named in `openspec/research/creative-brief.md`
 * "Props note" from the raw Kenney kit into `client/public/assets/props/`.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Verified to exist in `assets/office/kenneykit/Models/GLTF format` (creative-brief.md "Props note"). */
export const PROP_NAMES = [
  'desk',
  'deskCorner',
  'chairDesk',
  'computerScreen',
  'computerKeyboard',
  'laptop',
  'kitchenCoffeeMachine',
  'loungeSofa',
  'loungeSofaCorner',
  'loungeChairRelax',
  'tableCoffee',
  'wall',
  'wallWindow',
  'wallDoorway',
  'doorwayOpen',
  'floorFull',
  'pottedPlant',
  'plantSmall1',
  'bookcaseOpen',
  'trashcan',
  'lampSquareFloor',
  'rugRectangle',
  'stoolBar',
  'kitchenBar',
  'televisionModern',
  'cardboardBoxOpen',
  'bear',
  'ceilingFan',
] as const;

export interface CopyPropsResult {
  copied: string[];
}

export function copyProps(sourceDir: string, outputDir: string, names: readonly string[] = PROP_NAMES): CopyPropsResult {
  mkdirSync(outputDir, { recursive: true });
  const copied: string[] = [];
  for (const name of names) {
    const src = join(sourceDir, `${name}.glb`);
    const dest = join(outputDir, `${name}.glb`);
    copyFileSync(src, dest);
    copied.push(name);
  }
  return { copied };
}
