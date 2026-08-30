/**
 * Stage 7 — props.
 *
 * Kenney office props already ship as `.glb` — zero conversion needed.
 * Copies a curated set from the raw Kenney kit into
 * `client/public/assets/props/`. The kit ships 140 props — a whole house, not
 * just an office — so the set below is chosen to furnish real rooms: a working
 * kitchen, a lounge with a television on a cabinet, a meeting nook, and low
 * partitions that give the place structure without hiding it from an isometric
 * camera the way full-height walls do.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Verified to exist in `assets/office/kenneykit/Models/GLTF format` (creative-brief.md "Props note"). */
export const PROP_NAMES = [
  // --- floor & zoning -------------------------------------------------
  'floorFull',
  'paneling', // 0.59 tall against 0.85 characters: divides rooms, never hides them
  'rugRectangle',
  'rugRounded',
  'rugSquare',
  'rugDoormat',
  // --- work bay -------------------------------------------------------
  'desk',
  'deskCorner',
  'chairDesk',
  'computerScreen',
  'computerKeyboard',
  'computerMouse',
  'laptop',
  'bookcaseOpen',
  'bookcaseClosed',
  'bookcaseOpenLow',
  'books',
  // --- kitchen --------------------------------------------------------
  'kitchenCabinet',
  'kitchenCabinetDrawer',
  'kitchenCabinetUpper',
  'kitchenSink',
  'kitchenStove',
  'kitchenFridge',
  'kitchenMicrowave',
  'kitchenCoffeeMachine',
  'kitchenBlender',
  'hoodModern',
  'toaster',
  'kitchenBar',
  'kitchenBarEnd',
  'stoolBar',
  // --- lounge & tv ----------------------------------------------------
  'loungeSofa',
  'loungeSofaCorner',
  'loungeDesignSofa',
  'loungeDesignSofaCorner',
  'loungeDesignChair',
  'tableCoffeeSquare',
  'pillowLong',
  'loungeSofaLong',
  'loungeSofaOttoman',
  'loungeChairRelax',
  'cabinetTelevision',
  'televisionModern',
  'tableCoffee',
  'lampRoundFloor',
  'speaker',
  'pillow',
  'pillowBlue',
  'radio',
  // --- meeting nook ---------------------------------------------------
  'tableRound',
  'chairRounded',
  'chairModernCushion',
  'benchCushion',
  'coatRackStanding',
  // --- greenery & odds ------------------------------------------------
  'pottedPlant',
  'plantSmall1',
  'plantSmall2',
  'plantSmall3',
  'trashcan',
  'lampSquareFloor',
  'sideTable',
  'sideTableDrawers',
  'cardboardBoxOpen',
  'bear',
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
