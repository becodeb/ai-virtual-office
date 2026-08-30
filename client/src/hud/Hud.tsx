/**
 * DOM HUD overlay (task 4.16): connection state, redaction badge, the
 * ship-it celebration banner, and the coffee-count leaderboard. Lives
 * outside the R3F `<Canvas>` — plain Tailwind-styled DOM.
 */
import { ConnectionBadge } from './ConnectionBadge.js';
import { RedactionBadge } from './RedactionBadge.js';
import { ShipItBanner } from './ShipItBanner.js';
import { CoffeeLeaderboard } from './CoffeeLeaderboard.js';

export function Hud(): JSX.Element {
  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-4">
      <div className="flex items-start justify-between">
        <div className="flex gap-2">
          <ConnectionBadge />
          <RedactionBadge />
        </div>
        <div className="pointer-events-auto">
          <CoffeeLeaderboard />
        </div>
      </div>
      <div className="flex justify-center">
        <ShipItBanner />
      </div>
    </div>
  );
}
