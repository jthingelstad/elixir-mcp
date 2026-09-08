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

  const feedEvents = [];
  const firstObservation = Number(changed[0]?.prior_count ?? 0) === 0;
  if (!firstObservation) {
    let legendary = 0;
    let routine = 0;
    for (const row of changed) {
      const level = row.new_level;
      if (row.is_new && level === null) legendary += 1;
      else if (row.is_new && level !== null) routine += 1;
      else if (row.prior_level !== null && level > row.prior_level)
        routine += 1;
      // Everything else is progress ticking inside a level. Real movement in
      // the table, but not a thing worth a nod.
    }
    if (legendary > 0)
      feedEvents.push({
        kind: "player",
        tag: playerTag,
        topic: "legendary_badge_earned",
        count: legendary,
      });
    if (routine > 0)
      feedEvents.push({
        kind: "player",
        tag: playerTag,
        topic: "badge_earned",
        count: routine,
      });
  }
  return { changed: changed.length, feedEvents };
}

export async function projectPlayerSnapshot(
  db,
  { playerTag, payload, fetchedAt, receiptId = null, kind = "daily" },
) {
  const day = fetchedAt.slice(0, 10);

  const { rows: prevRows } = await db.query(
    `select snapshot_date, donations, (lifetime->>'battleCount')::int as battle_count,
            arena_id, best_trophies,
            (lifetime->>'wins')::int as wins,
            (lifetime->>'collectionLevel')::int as collection_level,
            (pol->'current'->>'leagueNumber')::int as pol_league
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

  return {
    day,
    kind,
    hadPrevious: Boolean(prev),
    feedEvents: milestones(playerTag, prev, payload),
  };
}

/**
 * Snapshot-derived nods. Each one answers "something moved here, go look" and
 * carries no detail beyond that -- the reader has players_profile and
 * players_timeline, which are cheap and current, and a payload that tried to
 * summarise would just be a staler copy of them.
 *
 * `prev` absent means this is the player's first snapshot, and everything
 * would read as a milestone. Same flood guard as the badges.
 */
function milestones(playerTag, prev, payload) {
  if (!prev) return [];
  const out = [];
  const nod = (topic) => out.push({ kind: "player", tag: playerTag, topic });

  const arena = payload.arena?.id ?? null;
  if (arena !== null && prev.arena_id !== null && arena !== prev.arena_id)
    nod("arena_changed");

  // A peak, not a level: bestTrophies only ever moves up, so any increase is
  // a new personal best.
  if (
    typeof payload.bestTrophies === "number" &&
    typeof prev.best_trophies === "number" &&
    payload.bestTrophies > prev.best_trophies
  )
    nod("best_trophies_peak");

  // Career wins tick constantly; only a thousand-crossing is news.
  const WINS_STEP = 1000;
  if (typeof payload.wins === "number" && typeof prev.wins === "number") {
    if (
      Math.floor(payload.wins / WINS_STEP) > Math.floor(prev.wins / WINS_STEP)
    )
      nod("career_wins_milestone");
  }

  if (
    typeof payload.collectionLevel === "number" &&
    typeof prev.collection_level === "number" &&
    payload.collectionLevel > prev.collection_level
  )
    nod("collection_level_milestone");

  // Path of Legends: the league number rises with promotion. A season reset
  // drops it, which is not a demotion worth a nod -- only the climb is.
  const league = payload.currentPathOfLegendSeasonResult?.leagueNumber ?? null;
  if (
    typeof league === "number" &&
    typeof prev.pol_league === "number" &&
    league > prev.pol_league
  )
    nod("pol_promotion");

  return out;
}
