/**
 * A public endpoint's JSON body, read at BUILD time, with retries.
 *
 * The site build reads the live service's public stats and card catalog
 * and bakes them into pages. On 2026-11-13 the stats read met a 503 in
 * the moments after a deploy's switch, the build published the corpus
 * page with no totals, and smoke failed. So a read is retried with
 * backoff, and if it still fails the BUILD fails: the deploy stops at
 * its site phase before anything is uploaded, the previously published
 * pages stay up, and the next deploy (site lane) publishes the site.
 * A page with its numbers missing, or a card page deleted because the
 * catalog read failed, is never published.
 *
 * Retried: a network error, a timeout, 429 and any 5xx. Anything else
 * (a 404, a body that is not JSON) fails at once: waiting will not
 * change it.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {string} url
 * @param {{ label: string, attempts?: number, baseDelayMs?: number,
 *   timeoutMs?: number, wait?: (ms: number) => Promise<void> }} options
 * @returns {Promise<any>} the parsed body
 */
export async function fetchPublicJson(
  url,
  { label, attempts = 5, baseDelayMs = 2000, timeoutMs = 15000, wait = sleep },
) {
  let last = "no attempt";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let retryable = true;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return await res.json();
      last = `endpoint ${res.status}`;
      retryable = res.status === 429 || res.status >= 500;
    } catch (err) {
      // A timeout or a refused connection is worth another try; a body
      // that will not parse is not.
      last = err.message;
      retryable = !(err instanceof SyntaxError);
    }
    if (!retryable || attempt === attempts) break;
    const delay = baseDelayMs * 2 ** (attempt - 1);
    console.warn(
      `[site] ${label}: ${last}; retrying in ${delay / 1000}s (attempt ${attempt + 1} of ${attempts})`,
    );
    await wait(delay);
  }
  throw new Error(
    `[site] ${label} could not be read from ${url} (${last}); failing the build rather than publishing the site without it. ELIXIR_SKIP_STATS=1 builds offline from fixtures.`,
  );
}
