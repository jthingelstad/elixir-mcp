import { buildTimeline, shownAt } from "@elixir-mcp/tools/activity/entries";

/**
 * Clan's Feed (slice 8, #766): the clan's timeline for one signed-in member,
 * newest first. The clan's own items and its members' moments come from the
 * clan subject read comprehensively, its current members' highlights ride
 * along, and nothing of the reader's own account (feedback answers, mail)
 * is in it.
 *
 * Who sees what is the timeline's own reader rule (`factItems`): a verified
 * member reads the clan's facts and a verified leader or co-leader also the
 * leaders-only ones, exactly as the same person reads this clan in Home's
 * Timeline or `elixir_timeline`. The Feed widens nothing. The Clan handler
 * proves the reader is in the clan before this runs.
 */
export const FEED_DAYS = 7;
const DAY_MS = 86_400_000;

/** One item, as the Feed draws it: its sentence and, for a highlight, its
 *  words and its battle. Never its facts whole. */
const feedItem = (it) => ({
  id: it.id ?? null,
  kind: it.kind,
  at: shownAt(it) || it.at || null,
  text: String(it.text ?? ""),
  ...(it.kind === "battle_highlight"
    ? {
        words: it.facts?.words ?? null,
        battle_url: it.facts?.battle?.url ?? null,
      }
    : {}),
});

/** The clan's current members, as the record holds them. */
async function currentMembers(db, clanTag) {
  const { rows } = await db.query(
    `select player_tag from clan_membership
      where clan_tag = $1 and left_observed_at is null`,
    [clanTag],
  );
  return rows.map((r) => r.player_tag);
}

export async function readClanFeed(db, account, clanTag, now = Date.now()) {
  const perf = {};
  const started = Date.now();
  const built = await buildTimeline(
    db,
    [{ kind: "clan", tag: clanTag, scope: "comprehensive" }],
    {
      fromMs: now - FEED_DAYS * DAY_MS,
      toMs: now,
      timezone: account.timezone ?? "UTC",
      accountId: account.accountId,
      interactive: true,
      highlightTags: await currentMembers(db, clanTag),
      filter: (it) => it.section !== "account",
      perf,
    },
  );
  // Where the Feed's time goes, each builder's name beside its ms, as Home's
  // timeline logs it (#649): the read is the timeline's own, shared.
  console.info(
    JSON.stringify({
      at: "clan_feed",
      ms: Date.now() - started,
      parts: perf,
    }),
  );
  return {
    clan_tag: clanTag,
    window_days: FEED_DAYS,
    items: (built.timeline ?? []).map(feedItem),
    more: built.timeline_more ?? 0,
  };
}
