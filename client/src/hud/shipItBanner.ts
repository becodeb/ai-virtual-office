/**
 * Pure content resolution for the ship-it celebration banner (office-renderer
 * spec's "Ship-It Event Labeled as Inferred" requirement). Kept pure and
 * separate from the React component so the "inferred" wording is directly
 * unit-testable.
 */
export interface ShipItBannerContent {
  visible: boolean;
  text: string;
}

/** `inferred` mirrors decision 5: the hook only observes command shape and exit code, never real test semantics. */
export function resolveShipItBanner(active: boolean, inferred: boolean): ShipItBannerContent {
  if (!active) return { visible: false, text: '' };
  return {
    visible: true,
    // Must say "inferred", never "verified" — the UI must not claim more certainty than it has (decision 5).
    text: inferred ? 'Ship it! (inferred — not a verified test pass)' : 'Ship it!',
  };
}
