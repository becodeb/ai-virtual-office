/**
 * Pure trailing-window key-sequence matcher, used for both easter eggs
 * (Konami code, typing `moo`). Kept pure so the matching logic is directly
 * testable without simulating real `keydown` events.
 */
export function matchesTrailingSequence(buffer: readonly string[], sequence: readonly string[]): boolean {
  if (buffer.length < sequence.length) return false;
  const trailing = buffer.slice(buffer.length - sequence.length);
  return trailing.every((key, i) => key === sequence[i]);
}

export const KONAMI_SEQUENCE = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a',
] as const;

export const MOO_SEQUENCE = ['m', 'o', 'o'] as const;
