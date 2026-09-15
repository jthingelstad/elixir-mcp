/**
 * Player snapshot projector — DESIGN §4.5.
 *
 * One row per recorded player per UTC day ('daily'); the season-roll
 * watcher forces a second row ('season_roll') in the hour before roll —
 * same function, different kind. Later polls in a day overwrite: a
 * snapshot is "state at capture", and the pre-reset peak lives in the
 * prior day's row plus the season_roll row.
 *
 * Diff events come from comparing against the LATEST snapshot observation
 * (the DB is the baseline, same as roster tenure): donation_reset when
 * the weekly counter falls, and the ledger milestones below. First sight
 * emits nothing. The baseline is the newest row by observed_at, today's
 * included: until 2026-09-15 it was the newest PRIOR day's row, and since
 * today's row is rewritten on every poll, every later poll that day
 * re-diffed against yesterday and re-emitted the same moment (Aaqib Javed
 * "promoted to Master 2" at 07:22Z and again at 16:22Z on 2026-09-14).
 */

import { inPreResetWindow } from "@elixir-mcp/contracts";
import { payloadHash } from "./hash.mjs";
import { emitEvent } from "./events.mjs";

/**
 * Badges are CURRENT STATE, not a daily blob (§7.2). ~139 per player
 * per day would be the largest thing we write to say almost nothing;
 * this touches only the ones that actually moved.
 */
/**
 * Badges, and the two feed topics they produce.
 *
 * The upsert already fired only on a real change; what it threw away was WHICH
 * change, so nothing could ever be notified. It now reads the prior state in
 * the same statement (a data-modifying CTE sees the pre-modification snapshot)
 * and reports what moved.
 *
 * THE TIER SPLIT IS ELIXIR-BOT'S, and it is a naming rule, not a field: a
 * badge with NO level is awarded once and never again (the Legendary badges
 * and one-off event badges); a badge WITH a level is mastery grind, and it is
 * the bulk of the volume. Because the two are separate topics, a reader that
 * only wants the notable ones asks for the notable ones -- it cannot silently
 * drop a tier by hardcoding a name, which is exactly how elixir-bot lost its
 * entire Legendary back catalogue.
 *
 * FIRST OBSERVATION EMITS NOTHING. A newly added player arrives with a full
 * badge shelf, every row of it "new". elixir-bot documents this as its flood
 * class (engine/emitters/player.py); with 50 tracked players it is the
 * difference between a feed and an outage.
 */
export async function projectPlayerBadges(
  db,
  { playerTag, payload, fetchedAt },
) {
  if (!Array.isArray(payload.badges) || payload.badges.length === 0)
    return { changed: 0, feedEvents: [] };
  const rows = payload.badges.filter(
    (badge) => badge && typeof badge.name === "string" && badge.name,
  );
  if (rows.length === 0) return { changed: 0, feedEvents: [] };
  const { rows: changed } = await db.query(
    `with prior as (
       select name, level from player_badge where player_tag = $1
     ),
     upserted as (
       insert into player_badge (player_tag, name, level, max_level, progress, target, observed_at)
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
           or player_badge.max_level is distinct from excluded.max_level)
       returning name, level
     )
     select u.name, u.level as new_level, p.level as prior_level,
            (p.name is null) as is_new,
            (select count(*) from prior) as prior_count
       from upserted u left join prior p on p.name = u.name`,
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

  // The ledger gets one named row per badge moment; the first observation
  // writes nothing (a new tracking arrives with a whole shelf, and that is
  // history, not news). Progress inside a level is recorded, never a row.
  const firstObservation = Number(changed[0]?.prior_count ?? 0) === 0;
  if (!firstObservation) {
    for (const row of changed) {
      const level = row.new_level;
      let type = null;
      if (row.is_new && level === null) type = "legendary_badge_earned";
      else if (row.is_new && level !== null) type = "badge_earned";
      else if (row.prior_level !== null && level > row.prior_level)
        type = "badge_earned";
      if (!type) continue;
      await emitEvent(db, type, {
        tag: playerTag,
        windowEnd: fetchedAt,
        payload: {
          name: row.name,
          ...(level !== null ? { level } : {}),
          ...(row.prior_level !== null && row.prior_level !== undefined
            ? { prior_level: row.prior_level }
            : {}),
        },
      });
    }
  }
  return { changed: changed.length };
}

export async function projectPlayerSnapshot(
  db,
  { playerTag, payload, fetchedAt, receiptId = null, kind = "daily" },
) {
  const day = fetchedAt.slice(0, 10);

  // Two baselines. `prev` is the newest row from an EARLIER day: the
  // day-level questions (did a counter move since yesterday's snapshot,
  // 0077) are asked of it. `latest` is the newest observation of any day,
  // today's rewritten row included, and strictly before this poll: the
  // moments are diffed against it, so a moment is written once, by the
  // first poll that sees it, and never again by the polls that follow it
  // the same day.
  const SNAPSHOT_BASELINE = `select snapshot_date, observed_at, donations, (lifetime->>'battleCount')::int as battle_count,
            arena_id, best_trophies,
            (lifetime->>'wins')::int as wins,
            (lifetime->>'collectionLevel')::int as collection_level,
            (pol->'current'->>'leagueNumber')::int as pol_league
     from player_snapshot_daily`;
  const { rows: prevRows } = await db.query(
    `${SNAPSHOT_BASELINE}
     where player_tag = $1 and (snapshot_date, snapshot_kind) < ($2::date, $3)
     order by snapshot_date desc, snapshot_kind desc limit 1`,
    [playerTag, day, kind],
  );
  const prev = prevRows[0];
  const { rows: latestRows } = await db.query(
    `${SNAPSHOT_BASELINE}
     where player_tag = $1 and observed_at is not null and observed_at < $2::timestamptz
     order by observed_at desc limit 1`,
    [playerTag, fetchedAt],
  );
  const latest = latestRows[0];

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
    latest &&
    typeof payload.donations === "number" &&
    typeof latest.donations === "number" &&
    payload.donations < latest.donations
  ) {
    await emitEvent(db, "donation_reset", {
      tag: playerTag,
      receiptId,
      windowStart: latest.observed_at.toISOString(),
      windowEnd: fetchedAt,
      payload: {
        donations_before: latest.donations,
        donations_after: payload.donations,
      },
    });
  }

  // Did the snapshot say anything new (0077)? The day row is rewritten
  // on every poll so observed_at is honest; this is whether a counter a
  // reader looks at moved since the previous snapshot.
  const moved =
    !prev ||
    prev.battle_count !== (payload.battleCount ?? null) ||
    prev.donations !== (payload.donations ?? null) ||
    prev.wins !== (payload.wins ?? null) ||
    prev.best_trophies !== (payload.bestTrophies ?? null);
  // The arena catalog: ids are opaque (54000144 is Spirit Square), and the
  // profile payload is the only place the name travels.
  if (payload.arena?.id && typeof payload.arena.name === "string") {
    await db.query(
      `insert into arena (arena_id, name, observed_at) values ($1, $2, $3)
       on conflict (arena_id) do update
         set name = excluded.name, observed_at = excluded.observed_at
       where arena.name is distinct from excluded.name`,
      [payload.arena.id, payload.arena.name, fetchedAt],
    );
  }
  if (kind === "daily")
    await ledgerMilestones(db, {
      playerTag,
      prev: latest,
      payload,
      fetchedAt,
      receiptId,
    });

  return {
    day,
    kind,
    hadPrevious: Boolean(prev),
    moved,
  };
}

/**
 * Snapshot-derived moments, written to the ledger with their values so the
 * timeline can name them (review 2026-09-13 Part IV). Thresholds are the
 * disclosed rungs: a personal best counts at each 500 band, career wins at
 * each thousand, collection level at each fifth level; an arena change and a
 * ranked promotion count as themselves. A season reset dropping the league
 * is not a demotion worth a row.
 *
 * `prev` is the latest observation before this poll (any day); absent means
 * this is the player's first snapshot, and everything would read as a
 * milestone. Same flood guard as the badges.
 */
const BEST_TROPHIES_BAND = 500;
const CAREER_WINS_STEP = 1000;
const COLLECTION_LEVEL_STEP = 5;
const crossed = (before, after, step) =>
  typeof before === "number" &&
  typeof after === "number" &&
  Math.floor(after / step) > Math.floor(before / step);

async function ledgerMilestones(
  db,
  { playerTag, prev, payload, fetchedAt, receiptId },
) {
  if (!prev) return;
  const windowStart = prev.observed_at
    ? prev.observed_at.toISOString()
    : fetchedAt;
  const write = (type, extra) =>
    emitEvent(db, type, {
      tag: playerTag,
      windowStart,
      windowEnd: fetchedAt,
      receiptId,
      payload: extra,
    });

  const arena = payload.arena?.id ?? null;
  if (arena !== null && prev.arena_id !== null && arena !== prev.arena_id)
    await write("arena_changed", {
      from: prev.arena_id,
      to: arena,
      to_name: payload.arena?.name ?? null,
    });

  if (crossed(prev.best_trophies, payload.bestTrophies, BEST_TROPHIES_BAND))
    await write("best_trophies_band", { best: payload.bestTrophies });

  if (crossed(prev.wins, payload.wins, CAREER_WINS_STEP))
    await write("career_wins_step", { wins: payload.wins });

  if (
    crossed(
      prev.collection_level,
      payload.collectionLevel,
      COLLECTION_LEVEL_STEP,
    )
  )
    await write("collection_level_step", { level: payload.collectionLevel });

  const league = payload.currentPathOfLegendSeasonResult?.leagueNumber ?? null;
  if (
    typeof league === "number" &&
    typeof prev.pol_league === "number" &&
    league > prev.pol_league
  )
    await write("ranked_promotion", { from: prev.pol_league, to: league });
}
