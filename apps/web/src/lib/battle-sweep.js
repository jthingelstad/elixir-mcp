/**
 * battles_query, every page of it through next_cursor, as Ladder's Days
 * page reads a season. A page is bounded by the 48,000-character result
 * cap as well as by its limit, and the cap depends on what the rows
 * hold: a compact page of 50 had grown past it by 9.18 (each row gained
 * its url, trophies and clans), and the live Days page showed the
 * refusal (2026-10-02). The hub's answer to an oversized page is a
 * priced result_too_large, "an answer, not a defect" (DECISIONS), whose
 * hint names a limit that fits; the sweep takes that limit, reads the
 * same page again, and keeps it for the pages after.
 */

/** A limit the refusal names ("a limit of 23 should fit"), or half the
 *  one that was refused when it names none. */
export function fittingLimit(error, limit) {
  const named = /a limit of (\d+) should fit/.exec(String(error?.hint ?? ""));
  const n = named ? Number(named[1]) : Math.floor(limit / 2);
  return Math.max(1, Math.min(n, limit - 1));
}

/**
 * Every page of `args` through next_cursor, at most `pages` reads (a
 * refused read counts: each is one call of the reader's quota). `read`
 * is battles_query through the explore bridge: the body, or a thrown
 * error carrying the tool's code and hint. Returns the battles newest
 * first, the first page's answer (its applied window, meta and
 * total_count) and whether the sweep stopped before the end.
 */
export async function sweepBattles(read, args, pages) {
  const battles = [];
  let first = null;
  let cursor = null;
  let limit = Number(args.limit ?? 25);
  let reads = 0;
  for (;;) {
    let body;
    try {
      reads++;
      body = await read("battles_query", {
        ...args,
        limit,
        ...(cursor ? { cursor } : { include_total: true }),
      });
    } catch (e) {
      if (e?.code !== "result_too_large" || limit <= 1 || reads >= pages)
        throw e;
      limit = fittingLimit(e, limit);
      continue;
    }
    first ??= body;
    battles.push(...(body?.battles ?? []));
    cursor = body?.next_cursor ?? null;
    if (!cursor || reads >= pages) break;
  }
  return {
    first,
    battles,
    total: first?.total_count ?? null,
    capped: Boolean(cursor),
  };
}
