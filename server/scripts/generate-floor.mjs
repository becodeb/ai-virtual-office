/**
 * Generates `src/world/floor.json`.
 *
 * The plan is four rooms around a cross of corridors, filling the grid edge to
 * edge. An earlier version reserved an unused ring around the outside, which is
 * what produced the wide band of bare floor with nothing on it: the rooms were
 * fine, the map was simply bigger than its own contents.
 *
 * Rooms are told apart by the colour of the floor underfoot, not by walls. From
 * a camera looking down at a diorama that is the strongest signal available,
 * and unlike full-height walls it hides nothing. `paneling` (0.59 tall against
 * 0.85 characters) lines the outer edges to give each room a lip you can see
 * over.
 *
 * Every solid prop is accepted only if the floor is still fully connected
 * afterwards; rejects are printed with a reason. The check is 4-connected and
 * never routes through a seat, which is stricter than the game's 8-connected
 * A*, so anything passing here passes there. `src/world/reachability.test.ts`
 * re-checks the committed result with the real pathfinder.
 *
 *   pnpm --filter server floor
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/world/floor.json');

const W = 11;
const H = 7; // the whole grid is used: cells 0..10 by 0..6

/** The cross of circulation that separates the four rooms. */
const AISLE_X = 5;
const AISLE_Y = 3;

const zones = [
  { id: 'work', rect: [0, 0, 4, 2], tint: '#a8825e' },
  { id: 'kitchen', rect: [6, 0, 10, 2], tint: '#bfb6a4' },
  { id: 'meeting', rect: [0, 4, 4, 6], tint: '#9a7a52' },
  { id: 'lounge', rect: [6, 4, 10, 6], tint: '#8f6a55' },
];

/** Work bay: two banks of three either side of their own short aisle. */
const desks = [
  ...[0, 1, 2].map((y, i) => ({ id: `D${i + 1}`, cell: [0, y], seatCell: [1, y], facing: 'west', window: y === 0 })),
  ...[0, 1, 2].map((y, i) => ({ id: `D${i + 4}`, cell: [4, y], seatCell: [3, y], facing: 'east', window: y === 0 })),
];

/** Lounge seats face the television across the coffee table. */
const lounge = [
  { cell: [8, 4], facing: 'east' },
  { cell: [8, 5], facing: 'east' },
  { cell: [8, 6], facing: 'east' },
];

const fixed = {
  elevator: [5, 6],
  fireExit: [5, 0],
  coffee: [6, 0],
  coffeeStand: [6, 1],
  screen: [0, 4],
  bear: [0, 6],
  bearStand: [1, 6],
  architect: [10, 6],
};

function isCorridor([x, y]) {
  if (x === AISLE_X) return 'the main aisle';
  if (y === AISLE_Y) return 'the cross corridor';
  if (x === 2 && y <= 2) return 'the work bay aisle';
  return null;
}

// Kitchen units are 0.43 wide, so two sit side by side inside one 1.0 cell and
// read as one continuous counter run rather than separate cabinets.
const L = -0.25;
const R = 0.25;

/** [cell, prop, facing, offset, y?] */
const solidProps = [
  // kitchen: a counter along the top edge, a breakfast bar facing into the room
  [[7, 0], 'kitchenCabinetDrawer', 'south', [L, 0]],
  [[7, 0], 'kitchenStove', 'south', [R, 0]],
  [[7, 0], 'hoodModern', 'south', [R, -0.02], 0.62],
  [[8, 0], 'kitchenSink', 'south', [L, 0]],
  [[8, 0], 'kitchenCabinet', 'south', [R, 0]],
  [[8, 0], 'kitchenCabinetUpper', 'south', [L, -0.02], 0.62],
  [[8, 0], 'toaster', 'south', [R, 0], 0.46],
  [[9, 0], 'kitchenCabinet', 'south', [L, 0]],
  [[9, 0], 'kitchenMicrowave', 'south', [L, 0], 0.46],
  [[10, 0], 'kitchenFridge', 'south', [0, 0]],
  [[8, 2], 'kitchenBar', 'north', [0, 0]],
  [[9, 2], 'kitchenBar', 'north', [0, 0]],
  [[10, 1], 'stoolBar', 'west', [0, 0]],
  [[10, 2], 'plantSmall1', 'north', [0, 0]],

  // lounge: television against the far edge, seating turned towards it
  [[10, 5], 'cabinetTelevision', 'west', [0, 0]],
  [[10, 5], 'televisionModern', 'west', [0, 0], 0.31],
  [[9, 5], 'tableCoffeeSquare', 'north', [0, 0]],
  [[10, 4], 'lampRoundFloor', 'west', [0, 0]],
  [[10, 6], 'speaker', 'west', [0, 0]],
  [[7, 4], 'loungeDesignChair', 'east', [0, 0]],
  [[7, 6], 'sideTableDrawers', 'east', [0, 0]],

  // meeting nook: a round table with seating on three sides
  [[2, 5], 'tableRound', 'north', [0, 0]],
  [[1, 5], 'chairModernCushion', 'east', [0, 0]],
  [[3, 5], 'chairModernCushion', 'west', [0, 0]],
  [[2, 6], 'chairModernCushion', 'north', [0, 0]],
  [[2, 4], 'benchCushion', 'south', [0, 0]],
  [[0, 5], 'coatRackStanding', 'east', [0, 0]],
  [[4, 4], 'bookcaseOpenLow', 'south', [0, 0]],
  [[4, 6], 'pottedPlant', 'north', [0, 0]],
  [[3, 6], 'plantSmall1', 'north', [0, 0]],

  // work bay dressing, kept against the edges so the middle stays walkable
  [[2, 0], 'bookcaseOpenLow', 'south', [0, 0]],
  [[2, 2], 'trashcan', 'north', [0, 0]],
];

/**
 * Low panels along the outer edge. They give each room a lip without hiding
 * anything: 0.59 tall against 0.85 characters. Two per cell, since one panel is
 * half a cell wide.
 */
const edgePanels = [];
for (let x = 0; x <= 10; x++) {
  if (x === AISLE_X) continue; // the aisle runs out to the edge at both ends
  for (const [y, facing] of [
    [0, 'north'],
    [6, 'south'],
  ]) {
    const push = y === 0 ? -0.47 : 0.47;
    edgePanels.push([[x, y], 'paneling', facing, [L, push]]);
    edgePanels.push([[x, y], 'paneling', facing, [R, push]]);
  }
}

/**
 * Rugs are 0.01 tall: walked over, never around.
 *
 * Runners down the full length of both corridors matter as much as the ones in
 * the rooms. A bare corridor reads as the gap between two places; a carpeted
 * one reads as the hallway that joins them, which is the difference between
 * four rooms in a building and four islands in a field.
 */
const rugs = [
  [[2, 1], 'rugRectangle'],
  [[2, 5], 'rugRounded'],
  [[8, 5], 'rugRounded'],
  [[9, 4], 'rugSquare'],
  [[7, 1], 'rugSquare'],
  [[1, 4], 'rugSquare'],
];
for (let y = 0; y < H; y++) rugs.push([[AISLE_X, y], 'rugSquare']);
for (let x = 0; x < W; x++) if (x !== AISLE_X) rugs.push([[x, AISLE_Y], 'rugSquare']);

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
const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function everythingReachable(solid) {
  const seen = new Set([key(fixed.elevator)]);
  const queue = [fixed.elevator];
  while (queue.length > 0) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of NEIGHBOURS) {
      const n = [x + dx, y + dy];
      if (n[0] < 0 || n[0] > W - 1 || n[1] < 0 || n[1] > H - 1) continue;
      const k = key(n);
      if (solid.has(k) || seen.has(k) || seats.has(k)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return destinations.every(
    (d) => seen.has(key(d)) || NEIGHBOURS.some(([dx, dy]) => seen.has(key([d[0] + dx, d[1] + dy])))
  );
}

const solid = new Set(base);
const reserved = new Set([...Object.values(fixed).map(key), ...seats]);
const decor = [];
const dropped = [];

/** Why `cell` cannot take a solid prop, or `null` if it can. */
function rejectReason(cell, allowCorridor) {
  const k = key(cell);
  if (cell[0] < 0 || cell[0] > W - 1 || cell[1] < 0 || cell[1] > H - 1) return 'is off the floor';
  const corridor = isCorridor(cell);
  if (!allowCorridor && corridor !== null) return `stands in ${corridor}`;
  if (reserved.has(k)) return 'cell is reserved for a fixture or a seat';
  if (solid.has(k)) return null; // stacking builds the counter run
  if (!everythingReachable(new Set([...solid, k]))) return 'would seal off part of the floor';
  return null;
}

/** Cells of the zone containing `cell`, nearest first — where to look for a second chance. */
function alternativesNear(cell) {
  const zone = zones.find(
    (z) => cell[0] >= z.rect[0] && cell[0] <= z.rect[2] && cell[1] >= z.rect[1] && cell[1] <= z.rect[3]
  );
  if (zone === undefined) return [];
  const out = [];
  for (let x = zone.rect[0]; x <= zone.rect[2]; x++) {
    for (let y = zone.rect[1]; y <= zone.rect[3]; y++) out.push([x, y]);
  }
  return out
    .filter((c) => key(c) !== key(cell))
    .sort((a, b) => Math.hypot(a[0] - cell[0], a[1] - cell[1]) - Math.hypot(b[0] - cell[0], b[1] - cell[1]));
}

function tryPlace([cell, prop, facing, offset, y], { allowCorridor = false, relocate = false } = {}) {
  const candidates = relocate ? [cell, ...alternativesNear(cell)] : [cell];
  for (const candidate of candidates) {
    const reason = rejectReason(candidate, allowCorridor);
    if (reason !== null) continue;
    const entry = { cell: candidate, prop, facing, offset };
    if (y !== undefined) entry.y = y;
    if (!solid.has(key(candidate))) solid.add(key(candidate));
    decor.push(entry);
    if (key(candidate) !== key(cell)) {
      dropped.push(`${prop}: moved from ${key(cell)} to ${key(candidate)} (${rejectReason(cell, allowCorridor)})`);
    }
    return;
  }
  dropped.push(`${prop} at ${key(cell)}: ${rejectReason(cell, allowCorridor) ?? 'no room anywhere in its zone'}`);
}

// Room furniture may shuffle within its own room rather than be dropped: a
// sparse room is what makes a floor look unfinished.
for (const item of solidProps) tryPlace(item, { relocate: true });
// Edge panels hug the outer boundary, so they never obstruct circulation.
for (const item of edgePanels) tryPlace(item, { allowCorridor: true });
for (const [cell, prop] of rugs) decor.push({ cell, prop, facing: 'north', offset: [0, 0], flat: true });

if (!everythingReachable(solid)) {
  console.error('generate-floor: the finished plan is not fully reachable — refusing to write it');
  process.exit(1);
}

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      width: W,
      height: H,
      walls: false,
      zones,
      elevatorCell: fixed.elevator,
      fireExitCell: fixed.fireExit,
      kitchen: { coffeeMachineCell: fixed.coffee, standCell: fixed.coffeeStand },
      meetingRoom: { screenCell: fixed.screen },
      bear: { cell: fixed.bear, standCell: fixed.bearStand },
      architect: { cell: fixed.architect },
      desks,
      lounge: { seats: lounge },
      decor,
    },
    null,
    2
  )}\n`
);

const covered = new Set([...solid, ...seats, ...decor.map((d) => key(d.cell))]).size;
console.log(
  `generate-floor: ${W}x${H} (${W * H} cells), ${zones.length} rooms, ${desks.length} desks, ` +
    `${decor.length} props, ${Math.round((100 * covered) / (W * H))}% of the floor covered`
);
for (const line of dropped) console.log(`  dropped ${line}`);
