/**
 * Shared "is this cosmetic `event` still within its display window" hook,
 * used by both the 3D `scene/Fx.tsx` cues and the DOM HUD banners so both
 * layers agree on timing without duplicating the logic.
 */
import { useEffect, useState } from 'react';
import type { FxEvent } from './worldReducer.js';
import { useWorldStore } from './store.js';

/** Returns the most recent `kind` event while it is still within `durationMs` of arrival, else `null`. */
export function useRecentFx(kind: string, durationMs: number): FxEvent | null {
  const fx = useWorldStore((s) => s.fx);
  const [active, setActive] = useState<FxEvent | null>(null);

  useEffect(() => {
    const latest = fx.filter((e) => e.kind === kind).at(-1);
    if (latest === undefined) return;
    const elapsed = Date.now() - latest.receivedAt;
    if (elapsed >= durationMs) return;
    setActive(latest);
    const timer = setTimeout(() => setActive(null), durationMs - elapsed);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-evaluate whenever the fx array identity changes.
  }, [fx, kind, durationMs]);

  return active;
}
