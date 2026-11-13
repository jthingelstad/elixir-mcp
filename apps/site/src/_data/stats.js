/**
 * Live corpus totals, read at BUILD time from the public stats endpoint
 * and baked into the pages that quote them.
 *
 * Retry, then fail (2026-11-13, _lib/fetch-public.mjs says why): a build
 * that cannot read the totals stops, and the pages already published
 * stay up, rather than publishing a page without them. ELIXIR_STATS_URL
 * points the build at another origin; ELIXIR_SKIP_STATS=1 turns the
 * fetch off for offline builds and tests (the templates render "—").
 */
import { fetchPublicJson } from "../_lib/fetch-public.mjs";

const URL_ =
  process.env.ELIXIR_STATS_URL ??
  "https://elixir.poapkings.com/api/public/stats";

export default async function stats() {
  if (process.env.ELIXIR_SKIP_STATS === "1") return { ok: false, totals: null };
  const body = await fetchPublicJson(URL_, { label: "stats" });
  if (!body?.totals)
    throw new Error(
      `[site] stats from ${URL_} carried no totals; failing the build rather than publishing the site without them.`,
    );
  return {
    ok: true,
    totals: body.totals,
    fetched_at: new Date().toISOString(),
    // Current retained rows, grouped by played day and drawn at build time.
    // This is a published snapshot, not a lifetime ingestion counter.
    series: body.series ?? null,
    series_days: body.series?.battles_daily?.length,
  };
}
