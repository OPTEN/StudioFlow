/**
 * Retry delay shared by every reconnecting client (SignalR control connection and LiveKit rejoin):
 * immediately, then 300 ms, 600 ms, 1.2 s … capped at 5 s, plus up to 250 ms jitter so many devices do not reconnect in
 * lockstep after a server restart. There is no retry limit.
 *
 * @param retryCount 0 for the first retry.
 * @param random injectable random source for tests.
 */
export function backoffDelay(retryCount: number, random: () => number = Math.random): number {
  if (retryCount <= 0) {
    return 0;
  }
  const base = Math.min(5000, 300 * 2 ** (retryCount - 1));
  return Math.round(base + random() * 250);
}
