/**
 * Live corpus totals, read at BUILD time from the public stats endpoint
 * and baked into the pages that quote them.
 *
 * Skip-not-fail, carried over from the deploy-time bake it replaces: a
 * first deploy has no endpoint to call yet, and a build must never be
 * held hostage to a running service. Templates render "—" and the
 * numbers arrive on the next build. ELIXIR_STATS_URL points the build
 * at another origin; ELIXIR_SKIP_STATS=1 turns the fetch off for
 * offline builds and tests.
 */
const URL_ =
  process.env.ELIXIR_STATS_URL ??
  "https://elixir.poapkings.com/api/public/stats";

export default async function stats() {
  if (process.env.ELIXIR_SKIP_STATS === "1") return { ok: false, totals: null };
  try {
    const res = await fetch(URL_, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.warn(`[site] stats skipped: endpoint ${res.status}`);
      return { ok: false, totals: null };
    }
    const body = await res.json();
    if (!body?.totals) {
      console.warn("[site] stats skipped: no totals in response");
      return { ok: false, totals: null };
    }
    return {
      ok: true,
      totals: body.totals,
      // The Data page draws the cumulative curve from this at BUILD
      // time: a chart that is true at deploy and needs no JavaScript
      // beats one that arrives after a fetch, or not at all.
      series: body.series ?? null,
      series_days: body.series?.battles_daily?.length,
    };
  } catch (err) {
    console.warn(`[site] stats skipped: ${err.message}`);
    return { ok: false, totals: null };
  }
}
