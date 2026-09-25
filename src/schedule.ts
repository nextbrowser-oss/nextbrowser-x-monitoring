// When the next pass should run. The caller owns the timer — the app has its
// own scheduler, the CLI a loop — and this only says how long to wait.

/** The shortest interval between passes. Every pass is a page load of x.com
 *  on the account's own session; faster is not monitoring, it is load. */
export const MIN_INTERVAL_MS = 60_000;
export const DEFAULT_INTERVAL_MS = 5 * 60_000;
/** How far one wait may stray from the interval, either way. A session that
 *  loads the same page every 300.0 seconds is a clock, not a person. */
const JITTER = 0.2;

/** scheduleDelay is the interval with a random spread, never under the
 *  minimum. A pass that needs a sign-in waits longer: nothing can be read until
 *  someone signs the profile in, and reloading the sign-in wall helps nobody. */
export function scheduleDelay(
  intervalMs: number = DEFAULT_INTERVAL_MS,
  options: { random?: () => number; loginRequired?: boolean } = {},
): number {
  const random = options.random ?? Math.random;
  const base = Math.max(MIN_INTERVAL_MS, Number.isFinite(intervalMs) ? intervalMs : DEFAULT_INTERVAL_MS);
  const spread = 1 + JITTER * (2 * random() - 1);
  const delay = Math.round(base * spread * (options.loginRequired ? 3 : 1));
  return Math.max(MIN_INTERVAL_MS, delay);
}
