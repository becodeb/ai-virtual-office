/**
 * Decision 3's "escape hatch ships in the same change" — a visible sign the
 * room is currently hiding task/prompt text, driven by the hub's own
 * `hello.config.redactPrompts` (the authoritative source, since the hub
 * already redacted text server-side before broadcasting it).
 */
import { useWorldStore } from '../state/store.js';

export function RedactionBadge(): JSX.Element | null {
  const redactPrompts = useWorldStore((s) => s.redactPrompts);
  if (!redactPrompts) return null;
  return (
    <div className="rounded bg-amber-500/90 px-3 py-1.5 text-xs font-semibold text-black">
      Prompt text redacted
    </div>
  );
}
