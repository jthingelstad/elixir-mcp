/**
 * Bounded backoff on a throttled Lambda invoke (#456).
 *
 * `elixir-mcp-migrate` and `elixir-mcp-jobs` run at reserved concurrency
 * 1. An invoke that meets another invocation already running is refused
 * with TooManyRequestsException (Reason
 * ReservedFunctionConcurrentInvocationLimitExceeded, HTTP 429) before the
 * function runs, so sending it again can never run the work twice. That
 * makes this the one retry these scripts allow: `npm run op` otherwise
 * sends exactly one call (a CLI retry once ran a jobs op twice,
 * 2026-09-19), and nothing else that fails is retried here.
 *
 * Why backoff and not a shared read lock: the invocation in the way is
 * not always ours to lock. A scheduled jobs run, a raw `aws lambda
 * invoke` read (the ops skill's reads take no lock) and a read that
 * started before the deploy took the lock all hold the one slot without
 * going through production-lock.mjs, and a shared lock would need reader
 * counts that survive a crashed reader. Waiting out the slot covers
 * every source, and the wait is bounded by the function's own timeout:
 * the invocation in the way cannot outlive it, so a slot still busy past
 * that is something else, and the caller hears it.
 */

/** Whether an SDK error is the refused-before-running throttle. */
export function isThrottle(error) {
  return (
    error?.name === "TooManyRequestsException" ||
    error?.$metadata?.httpStatusCode === 429
  );
}

/**
 * The waits between tries: doubling from `firstMs`, each at most
 * `capMs`, until they add up to `budgetMs`. Deterministic, so a test can
 * read the schedule.
 *
 * @returns {number[]} milliseconds
 */
export function backoffSchedule({ budgetMs, firstMs = 2_000, capMs = 30_000 }) {
  const waits = [];
  let total = 0;
  let next = firstMs;
  while (total < budgetMs) {
    const wait = Math.min(next, capMs, budgetMs - total);
    waits.push(wait);
    total += wait;
    next *= 2;
  }
  return waits;
}

/** The budget for a function: its timeout and half a minute. */
export const budgetFor = (timeoutS) => (timeoutS + 30) * 1000;

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send `command` on `client`, waiting and sending again only while the
 * answer is a throttle, along `schedule`. Any other error, and a
 * throttle once the schedule is spent, is thrown as it came.
 *
 * `beforeRetry(attempt, waitMs)` runs before each wait; returning a
 * string stops the retries and throws an error carrying it (`npm run op`
 * uses it to stop a read the moment a deploy holds the lock).
 *
 * @param {{ client: { send: (c: unknown) => Promise<any> }, command: unknown,
 *   schedule: number[], label: string, sleep?: (ms: number) => Promise<void>,
 *   log?: (line: string) => void,
 *   beforeRetry?: (attempt: number, waitMs: number) => string | null | undefined }} args
 */
export async function sendWithThrottleBackoff({
  client,
  command,
  schedule,
  label,
  sleep = realSleep,
  log = (line) => console.error(line),
  beforeRetry = () => null,
}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await client.send(command);
    } catch (error) {
      if (!isThrottle(error)) throw error;
      if (attempt >= schedule.length) {
        log(
          `${label}: still throttled after ${attempt} retr${attempt === 1 ? "y" : "ies"} over ${Math.round(schedule.reduce((a, b) => a + b, 0) / 1000)} s; another invocation holds the function's one slot.`,
        );
        throw error;
      }
      const wait = schedule[attempt];
      const stop = beforeRetry(attempt + 1, wait);
      if (stop) {
        const stopped = new Error(stop);
        stopped.name = "ThrottleRetryStopped";
        stopped.cause = error;
        throw stopped;
      }
      log(
        `${label}: throttled (${error.Reason ?? error.name ?? "429"}): another invocation is running; it was not run. Trying again in ${Math.round(wait / 1000)} s (retry ${attempt + 1} of ${schedule.length}).`,
      );
      await sleep(wait);
    }
  }
}
