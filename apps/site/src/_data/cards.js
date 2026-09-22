/**
 * The card catalog, read at BUILD time from the public endpoint and
 * baked into a page per card.
 *
 * Skip-not-fail, the same stance as stats.js: a first deploy has no
 * endpoint to call yet, and a build must never be held hostage to a
 * running service. No catalog means no card pages this build, and they
 * arrive on the next one.
 */
const URL_ =
  process.env.ELIXIR_CARDS_URL ??
  "https://elixir.poapkings.com/api/public/cards";

export default async function cards() {
  if (process.env.ELIXIR_SKIP_STATS === "1") return [];
  try {
    const res = await fetch(URL_, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      console.warn(`[site] cards skipped: endpoint ${res.status}`);
      return [];
    }
    const body = await res.json();
    return (body.cards ?? [])
      .filter((c) => c.elixirCost != null && c.iconUrls?.medium)
      .map((c) => ({
        id: c.id,
        name: c.name,
        rarity: c.rarity ?? null,
        type: c.type ?? null,
        elixir: c.elixirCost ?? null,
        forms: c.forms_available ?? [],
      }));
  } catch (err) {
    console.warn(`[site] cards skipped: ${err.message}`);
    return [];
  }
}
