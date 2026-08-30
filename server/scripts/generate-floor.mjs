/**
 * Generates `src/world/floor.json`.
 *
 * The floor plan is not hand-written JSON. Hand-placing furniture sealed the
 * elevator into a pocket three times in a row, and each time it looked fine
 * until a character had nowhere to walk. Here every solid prop is accepted only
 * if the floor is still fully connected afterwards, and rejected items are
 * printed with the reason.
 *
 * The connectivity check is deliberately stricter than the game's own A*: it is
 * 4-connected and never routes through a seat, while `findPath` is 8-connected.
 * Anything that passes here passes there. `src/world/reachability.test.ts` then
 * re-checks the committed result with the real pathfinder, so this script can
 * never be the only opinion that matters.
 *
 *   node scripts/generate-floor.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/world/floor.json');

const W = 11;
const H = 8; // interior is 1..W-2 by 1..H-2

/** Two banks of three desks either side of a central aisle. */
const desks = [
  ...[2, 3, 4].map((y, i) => ({ id: `D${i + 1}`, cell: [2, y], seatCell: [3, y], facing: 'west', window: y === 2 })),
  ...[2, 3, 4].map((y, i) => ({ id: `D${i + 4}`, cell: [6, y], seatCell: [5, y], facing: 'east', window: y === 2 })),
];

/** Lounge seats face the television across a coffee table. */
const lounge = [
  { cell: [6, 6], facing: 'east' },
  { cell: [7, 6], facing: 'east' },
];

const fixed = {
  elevator: [1, 3],
  fireExit: [9, 3],
  coffee: [8, 1],
  coffeeStand: [8, 2],
  screen: [1, 6],
  bear: [1, 1],
  bearStand: [2, 1],
  architect: [9, 5],
};

/** Circulation furniture may never stand in. */
function isCorridor([x, y]) {
  if (x === 4 && y >= 2 && y <= 4) return 'the work aisle';
  if (y === 5) return 'the cross corridor';
  if (x === 8 && y >= 2 && y <= 4) return 'the kitchen approach';
  return null;
}

// Kitchen units are 0.43 wide, so two sit side by side inside one 1.0 cell and
// read as a continuous counter run.
const L = -0.25;
const R = 0.25;

/** [cell, prop, facing, offset, y?] */
const solidProps = [
  [[6, 1], 'kitchenCabinet', 'south', [L, 0]],
  [[6, 1], 'kitchenSink', 'south', [R, 0]],
  [[6, 1], 'kitchenCabinetUpper', 'south', [L, -0.02], 0.62],
  [[6, 1], 'toaster', 'south', [R, 0], 0.46],
  [[7, 1], 'kitchenCabinetDrawer', 'south', [L, 0]],
  [[7, 1], 'kitchenStove', 'south', [R, 0]],
  [[7, 1], 'hoodModern', 'south', [R, -0.02], 0.62],
  [[9, 1], 'kitchenFridge', 'south', [0, 0]],
  [[9, 2], 'kitchenBar', 'north', [0, 0]],
  [[9, 6], 'cabinetTelevision', 'west', [0, 0]],
  [[9, 6], 'televisionModern', 'west', [0, 0], 0.31],
  [[8, 6], 'tableCoffee', 'north', [0, 0]],
  [[5, 6], 'loungeSofaOttoman', 'east', [0, 0]],
  [[9, 4], 'lampRoundFloor', 'west', [0, 0]],
  [[2, 6], 'tableRound', 'north', [0, 0]],
  [[3, 6], 'chairRounded', 'west', [0, 0]],
  [[1, 2], 'bookcaseOpen', 'east', [0, 0]],
  [[1, 4], 'bookcaseClosed', 'east', [0, 0]],
  [[7, 2], 'trashcan', 'north', [0, 0]],
  [[4, 6], 'cardboardBoxOpen', 'north', [0, 0]],
  [[2, 2], 'radio', 'east', [0, 0], 0.39],
  [[7, 4], 'plantSmall1', 'north', [0, 0]],
];

/** Rugs are 0.01 tall: walked over, never around, so they may cover corridors. */
const rugs = [
  [[4, 2], 'rugRectangle'],
  [[4, 4], 'rugRectangle'],
  [[2, 6], 'rugSquare'],
  [[7, 6], 'rugRounded'],
  [[1, 3], 'rugDoormat'],
  [[8, 5], 'rugSquare'],
  [[5, 5], 'rugRectangle'],
  [[2, 5], 'rugSquare'],
];

const key = (c) => `${c[0]},${c[1]}`;
const seats = new Set([...desks.map((d) => key(d.seatCell)), ...lounge.map((s) => key(s.cell))]);
const base = new Set([
  ...desks.map((d) => key(d.cell)),
  ...['coffee', 'screen', 'bear', 'architect'].map((k) => key(fixed[k])),
]);
const destinations = [
  fixed.coffeeStand,
  fixed.bearStand,
  fixed.fireExit,
  ...desks.map((d) => d.seatCell),
  ...lounge.map((s) => s.cell),
];

function everythingReachable(solid) {
  const seen = new Set([key(fixed.elevator)]);
  const queue = [fixed.elevator];
  while (queue.length > 0) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = [x + dx, y + dy];
      if (n[0] < 1 || n[0] > W - 2 || n[1] < 1 || n[1] > H - 2) continue;
      const k = key(n);
      if (solid.has(k) || seen.has(k) || seats.has(k)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  // A destination counts as reachable if it is standable, or adjacent to somewhere standable.
  return destinations.every(
    (d) =>
      seen.has(key(d)) ||
      [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has(key([d[0] + dx, d[1] + dy])))
  );
}

const solid = new Set(base);
const reserved = new Set([...Object.values(fixed).map(key), ...seats]);
const decor = [];
const dropped = [];

for (const [cell, prop, facing, offset, y] of solidProps) {
  const k = key(cell);
  const corridor = isCorridor(cell);
  if (corridor !== null) {
    dropped.push(`${prop} at ${k}: stands in ${corridor}`);
    continue;
  }
  if (reserved.has(k)) {
    dropped.push(`${prop} at ${k}: cell is reserved for a fixture or a seat`);
    continue;
  }
  const entry = { cell, prop, facing, offset };
  if (y !== undefined) entry.y = y;
  // Stacking onto an already-solid cell is how a counter run is built.
  if (solid.has(k)) {
    decor.push(entry);
    continue;
  }
  if (!everythingReachable(new Set([...solid, k]))) {
    dropped.push(`${prop} at ${k}: would seal off part of the floor`);
    continue;
  }
  solid.add(k);
  decor.push(entry);
}

for (const [cell, prop] of rugs) {
  decor.push({ cell, prop, facing: 'north', offset: [0, 0], flat: true });
}

if (!everythingReachable(solid)) {
  console.error('generate-floor: the finished plan is not fully reachable — refusing to write it');
  process.exit(1);
}

const layout = {
  width: W,
  height: H,
  walls: false,
  elevatorCell: fixed.elevator,
  fireExitCell: fixed.fireExit,
  kitchen: { coffeeMachineCell: fixed.coffee, standCell: fixed.coffeeStand },
  meetingRoom: { screenCell: fixed.screen },
  bear: { cell: fixed.bear, standCell: fixed.bearStand },
  architect: { cell: fixed.architect },
  desks,
  lounge: { seats: lounge },
  decor,
};

writeFileSync(OUT, `${JSON.stringify(layout, null, 2)}\n`);

const covered = new Set([...solid, ...seats, ...decor.map((d) => key(d.cell))]).size;
console.log(
  `generate-floor: ${W}x${H} (${W * H} cells), ${desks.length} desks, ${decor.length} props, ` +
    `${Math.round((100 * covered) / (W * H))}% of the floor covered`
);
for (const line of dropped) console.log(`  dropped ${line}`);
