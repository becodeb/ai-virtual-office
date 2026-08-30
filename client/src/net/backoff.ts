/**
 * Exponential reconnect backoff, per task 4.2: 500ms -> 8s, +/-20% jitter.
 * Pure function of attempt number so it is directly testable without timers.
 */
export const BACKOFF_MIN_MS = 500;
export const BACKOFF_MAX_MS = 8_000;
export const BACKOFF_JITTER = 0.2;

/** `attempt` is 0-based: the delay before the 1st reconnect try, the 2nd, etc. */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt);
  const jitterSpan = base * BACKOFF_JITTER;
  // Uniform in [base - jitterSpan, base + jitterSpan], clamped to the documented bounds.
  const jittered = base + (random() * 2 - 1) * jitterSpan;
  return Math.max(BACKOFF_MIN_MS * (1 - BACKOFF_JITTER), Math.min(BACKOFF_MAX_MS * (1 + BACKOFF_JITTER), jittered));
}
