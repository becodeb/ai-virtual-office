import { useWorldStore } from '../state/store.js';
import { parseCoffeeLeaderboard } from './coffeeLeaderboard.js';

export function CoffeeLeaderboard(): JSX.Element {
  const hud = useWorldStore((s) => s.hud);
  const entries = parseCoffeeLeaderboard(hud);

  return (
    <div className="w-48 rounded bg-black/60 px-3 py-2 text-xs text-white">
      <div className="mb-1 font-semibold text-white/80">☕ Coffee runs</div>
      {entries === null ? (
        <div className="italic text-white/40">Not available yet</div>
      ) : entries.length === 0 ? (
        <div className="italic text-white/40">Nobody yet</div>
      ) : (
        <ol className="space-y-0.5">
          {entries.slice(0, 5).map((entry, i) => (
            <li key={entry.name} className="flex justify-between">
              <span>
                {i + 1}. {entry.name}
              </span>
              <span className="tabular-nums text-white/70">{entry.count}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
