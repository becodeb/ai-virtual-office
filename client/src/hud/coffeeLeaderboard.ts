/**
 * Coffee-count leaderboard (HUD requirement, decision 1's persisted coffee
 * counter — "the most-watched number in the app").
 *
 * DEVIATION (documented): `server/src/net/hub.ts`'s `buildWorldSnapshot`
 * always sends `hud: {}` — coffee counts are persisted server-side
 * (`server/src/world/identity.ts`) but never broadcast over the frozen wire
 * protocol (`WorldSnapshot.hud` is typed `unknown` and nothing populates it
 * today). Rather than fabricate numbers, this module parses whatever shape
 * `hud` actually carries defensively and renders nothing invented — the
 * plumbing is fully wired so the board lights up the moment a future hub
 * populates `hud.coffeeLeaderboard`, without a client change.
 */
export interface CoffeeLeaderboardEntry {
  name: string;
  count: number;
}

function isEntry(value: unknown): value is CoffeeLeaderboardEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === 'string' && typeof v.count === 'number';
}

/** Parses `hud: unknown` defensively; returns `null` when no leaderboard data is present (not an empty array — a real empty board vs. "not available" are different states). */
export function parseCoffeeLeaderboard(hud: unknown): CoffeeLeaderboardEntry[] | null {
  if (typeof hud !== 'object' || hud === null) return null;
  const list = (hud as Record<string, unknown>).coffeeLeaderboard;
  if (!Array.isArray(list) || !list.every(isEntry)) return null;
  return [...list].sort((a, b) => b.count - a.count);
}
