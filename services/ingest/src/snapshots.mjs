/**
 * Player snapshot projector — DESIGN §4.5.
 *
 * One row per recorded player per UTC day ('daily'); the season-roll
 * watcher forces a second row ('season_roll') in the hour before roll —
 * same function, different kind. Later polls in a day overwrite: a
 * snapshot is "state at capture", and the pre-reset peak lives in the
 * prior day's row plus the season_roll row.
 *
 * Diff events come from comparing against the PREVIOUS snapshot (the DB is
 * the baseline, same as roster tenure): v0 emits donation_reset only —
 * donations are monotonic within a week, so a decrease is the reset.
 * First sight emits nothing.
 */

import { inPreResetWindow } from "@elixir-mcp/contracts";
import { payloadHash } from "./hash.mjs";
import { emitEvent } from "./events.mjs";
import { refreshCompleteness } from "./rollups.mjs";

/**
 * Badges are CURRENT STATE, not a daily blob (§7.2). ~139 per player
 * per day would be the largest thing we write to say almost nothing;
 * this touches only the ones that actually moved.
 */
export async function projectPlayerBadges(
  db,
  { playerTag, payload, fetchedAt },
) {
  if (!Array.isArray(payload.badges) || payload.badges.length === 0) return 0;
  const rows = payload.badges.filter(
    (badge) => badge && typeof badge.name === "string" && badge.name,
  );
  if (rows.length === 0) return 0;
  const { rowCount } = await db.query(
    `insert into player_badge (player_tag, name, level, max_level, progress, target, observed_at)
     select $1, b.name, b.level, b.max_level, b.progress, b.target, $3::timestamptz
     from jsonb_to_recordset($2::jsonb)
       as b(name text, level int, max_level int, progress int, target int)
     on conflict (player_tag, name) do update set
       level = excluded.level, max_level = excluded.max_level,
       progress = excluded.progress, target = excluded.target,
       observed_at = excluded.observed_at
     where player_badge.observed_at < excluded.observed_at
       and (player_badge.level is distinct from excluded.level
         or player_badge.progress is distinct from excluded.progress
         or player_badge.target is distinct from excluded.target
         or player_badge.max_level is distinct from excluded.max_level)`,
    [
      playerTag,
      JSON.stringify(
        rows.map((badge) => ({
          name: badge.name,
          level: badge.level ?? null,
          max_level: badge.maxLevel ?? null,
          progress: badge.progress ?? null,
          target: badge.target ?? null,
        })),
      ),
      fetchedAt,
    ],
  );
  return rowCount;
}

export async function projectPlayerSnapshot(
  db,
  { playerTag, payload, fetchedAt, receiptId = null, kind = "daily" },
) {
  const day = fetchedAt.slice(0, 10);

  const { rows: prevRows } = await db.query(
    `select snapshot_date, donations, (lifetime->>'battleCount')::int as battle_count
     from player_snapshot_daily
     where player_tag = $1 and (snapshot_date, snapshot_kind) < ($2::date, $3)
     order by snapshot_date desc, snapshot_kind desc limit 1`,
    [playerTag, day, kind],
  );
  const prev = prevRows[0];

  const lifetime = {
    battleCount: payload.battleCount,
    wins: payload.wins,
    losses: payload.losses,
    threeCrownWins: payload.threeCrownWins,
    starPoints: payload.starPoints,
    expPoints: payload.expPoints,
    collectionLevel: payload.collectionLevel,
  };

  await db.query(
    `insert into player_snapshot_daily
       (player_tag, snapshot_date, snapshot_kind, trophies, pol, league_stats,
        donations, donations_received, lifetime, collection_hash, observed_at,
        arena_id, best_trophies, favorite_card_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict (player_tag, snapshot_date, snapshot_kind) do update set
       trophies = excluded.trophies, pol = excluded.pol,
       league_stats = excluded.league_stats, donations = excluded.donations,
       donations_received = excluded.donations_received,
       lifetime = excluded.lifetime, collection_hash = excluded.collection_hash,
       observed_at = excluded.observed_at,
       arena_id = excluded.arena_id,
       best_trophies = excluded.best_trophies,
       favorite_card_id = excluded.favorite_card_id,
       created_at = now()
     where player_snapshot_daily.observed_at is null
        or excluded.observed_at >= player_snapshot_daily.observed_at`,
    [
      playerTag,
      day,
      kind,
      payload.trophies ?? null,
      JSON.stringify({
        current: payload.currentPathOfLegendSeasonResult ?? null,
        best: payload.bestPathOfLegendSeasonResult ?? null,
      }),
      JSON.stringify(payload.leagueStatistics ?? null),
      payload.donations ?? null,
      payload.donationsReceived ?? null,
      JSON.stringify(lifetime),
      Array.isArray(payload.cards) ? payloadHash(payload.cards) : null,
      fetchedAt,
      // Ids only; names and icons resolve from the catalog at read time.
      payload.arena?.id ?? null,
      payload.bestTrophies ?? null,
      payload.currentFavouriteCard?.id ?? null,
    ],
  );

  // In the pre-reset hour, also pin a season_roll row: the daily row will
  // be overwritten by post-reset polls the same UTC day; this one won't.
  if (kind === "daily" && inPreResetWindow(new Date(fetchedAt))) {
    await projectPlayerSnapshot(db, {
      playerTag,
      payload,
      fetchedAt,
      receiptId,
      kind: "season_roll",
    });
  }

  if (
    prev &&
    typeof payload.donations === "number" &&
    typeof prev.donations === "number" &&
    payload.donations < prev.donations
  ) {
    await emitEvent(db, "donation_reset", {
      tag: playerTag,
      receiptId,
      windowStart: `${prev.snapshot_date.toISOString().slice(0, 10)}T00:00:00Z`,
      windowEnd: fetchedAt,
      payload: {
        donations_before: prev.donations,
        donations_after: payload.donations,
      },
    });
  }

  // Completeness estimate for the bracketed window (§5.4): battleCount
  // delta between consecutive snapshots vs battles we captured. Day-level
  // approximation, refined when live data shows real gaps.
  if (prev) {
    await refreshCompleteness(db, { playerTag, day });
  }

  return { day, kind, hadPrevious: Boolean(prev) };
}
