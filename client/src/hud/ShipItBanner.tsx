import { useRecentFx } from '../state/useRecentFx.js';
import { resolveShipItBanner } from './shipItBanner.js';

const SHIP_IT_BANNER_MS = 10_000; // creative brief: ten seconds.

export function ShipItBanner(): JSX.Element | null {
  const event = useRecentFx('dance_party', SHIP_IT_BANNER_MS);
  const content = resolveShipItBanner(event !== null, event?.inferred ?? true);
  if (!content.visible) return null;
  return (
    <div className="rounded bg-fuchsia-600/90 px-4 py-2 text-sm font-bold text-white shadow-lg">
      🎉 {content.text}
    </div>
  );
}
