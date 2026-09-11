/**
 * A leaderboard becomes a record (0068).
 *
 * The rankings projector used to keep the players' NAMES from a board and
 * throw the board away — which is what the CR API does too, every minute.
 * This keeps the board: one snapshot per fetch that differs from the last,
 * a row per placed player, and a presence row for anyone in the recording
 * top-N so that the season's story of its eventual #1 has every battle.
 *
 * Three decisions worth stating.
 *
 * IDENTICAL FETCHES WRITE NOTHING. The global board is read hourly for a
 * movement video, and overnight it barely moves. A fetch whose content
 * matches the previous snapshot bumps that snapshot's last_confirmed_at
 * and stops; "the board was still this at 04:00" is kept without a
 * second copy of it.
 *
 * TRUNCATION IS RECORDED, NOT HIDDEN. The hub asks for 1000 places. If the
 * API offers a cursor past that, the snapshot says truncated and nothing
 * downstream mistakes it for the whole field.
 *
 * PRESENCE IS STICKY. A player in the recording top-N is recorded until the
 * next season roll plus a grace, however far they fall in between. The
 * alternative — a collection mirroring "the current top 100" — stops a
 * player's record the afternoon they dip to #101, and records nobody in
 * the empty hours after a roll. Expired presences are settled here as
 * well, on the board's own cadence, so no other job has to know.
 */
import { createHash } from "node:crypto";
import { normalizeTag } from "@elixir-mcp/contracts";
import { reconcileRecording } from "@elixir-mcp/claims";
import { seasonFromDate, nextSeasonStartMs } from "./war-clock.mjs";

/** How long after the roll a presence keeps recording. Long enough that
 *  the first day of the new season — when the board is empty and nobody
 *  is otherwise recorded — is captured for last season's field; short
 *  enough that a player who does not come back stops costing fetches. */
const STICKY_GRACE_MS = 3 * 24 * 3600_000;

function entriesOf(payload) {
  const out = [];
  for (const i of payload?.items ?? []) {
    let tag;
    try {
      tag = normalizeTag(String(i?.tag ?? ""));
    } catch {
      continue; // one malformed entry must not cost the board
    }
    let clanTag = null;
    if (i?.clan?.tag) {
      try {
        clanTag = normalizeTag(String(i.clan.tag));
      } catch {
        clanTag = null;
      }
    }
    out.push({
      rank: Number(i.rank),
      tag,
      name: i.name ?? null,
      // Path of Legends carries eloRating; the trophy boards trophies;
      // a game-mode board a mode-specific score. One column, because
      // the question is always "how far up".
      rating: i.eloRating ?? i.trophies ?? i.score ?? null,
      clanTag,
      clanName: i.clan?.name ?? null,
    });
  }
  return out.filter((e) => Number.isInteger(e.rank) && e.rank > 0);
}

/** Rows to upsert, in ONE order everywhere: by tag. Two boards landing
 *  at once each upsert thousands of player rows, and a battlelog admits
 *  a few; if each takes its locks in its own order they deadlock, the
 *  submit is a 500, the lease goes unsubmitted, and ten of those is a
 *  quarantine (nine deadlocks in seven minutes at 05:01Z on 2026-09-11,
 *  with Tesla at five). Sorted by the lock key they queue instead - the
 *  same rule collections have used since they were written. */
const byTag = (rows, key = "tag") =>
  [...rows].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));

/** What makes two boards the same board: places, tags, ratings, clans.
 *  Names are deliberately out — a rename is not a movement. */
function contentHash(entries) {
  const h = createHash("sha256");
  for (const e of entries) {
    h.update(`${e.rank}\t${e.tag}\t${e.rating ?? ""}\t${e.clanTag ?? ""}\n`);
  }
  return h.digest("hex");
}

/**
 * Project one ranking payload. `board` is 'pol' or 'trophy'; `entityKey`
 * is the location key the job carried ('global' or a numeric id).
 */
export async function projectRankingBoard(
  db,
  { board, entityKey, receiptId, payload, fetchedAt, seasonId = null },
) {
  const entries = entriesOf(payload);
  const observedAt = new Date(fetchedAt);
  // A final board is keyed by season, not place: it lives on the one
  // ('pol_final', 'global') board row and its season is the entity key.
  const locationKey =
    board === "pol_final" ? "global" : String(entityKey ?? "").toLowerCase();
  const season =
    seasonId ?? String(seasonFromDate(observedAt.getTime()).seasonId);

  // Identity accretion, as before: every ranked tag lands a player row
  // so the player tools can address it at once. Presence has a foreign
  // key to player, so this has to come first.
  if (entries.length > 0) {
    const ordered = byTag(entries);
    await db.query(
      `insert into player (player_tag, name)
       select t.tag, t.name from unnest($1::text[], $2::text[]) as t(tag, name)
       on conflict (player_tag) do update set
         last_seen_at = now(),
         name = coalesce(player.name, excluded.name)`,
      [ordered.map((e) => e.tag), ordered.map((e) => e.name)],
    );
  }

  // A board we did not know about (a location the API added, or a hand
  // live_fetch of one) is remembered but not scheduled.
  const { rows: boardRows } = await db.query(
    `insert into ranking_board (board, location_key, label, location_kind, every_minutes, record_top, enabled)
     values ($1, $2, $2,
             case when $1 = 'mode' then 'mode' when $2 = 'global' then 'global' else 'country' end,
             1440, 0, false)
     on conflict (board, location_key) do update set label = ranking_board.label
     returning record_top`,
    [board, locationKey],
  );
  const recordTop = boardRows[0]?.record_top ?? 0;

  const truncated = Boolean(payload?.paging?.cursors?.after);
  const hash = contentHash(entries);
  const { rows: last } = await db.query(
    board === "pol_final"
      ? `select snapshot_id, content_hash from ranking_snapshot
         where board = $1 and location_key = $2 and season_id = $3
         order by observed_at desc limit 1`
      : `select snapshot_id, content_hash from ranking_snapshot
         where board = $1 and location_key = $2
         order by observed_at desc limit 1`,
    board === "pol_final" ? [board, locationKey, season] : [board, locationKey],
  );

  let snapshotId = null;
  let wrote = false;
  if (last[0] && last[0].content_hash === hash) {
    await db.query(
      `update ranking_snapshot set last_confirmed_at = $2
       where snapshot_id = $1 and last_confirmed_at < $2`,
      [last[0].snapshot_id, observedAt],
    );
    snapshotId = last[0].snapshot_id;
  } else if (entries.length > 0) {
    const { rows } = await db.query(
      `insert into ranking_snapshot
         (board, location_key, season_id, observed_at, last_confirmed_at, content_hash, entries, truncated, receipt_id)
       values ($1, $2, $3, $4, $4, $5, $6, $7, $8)
       returning snapshot_id`,
      [
        board,
        locationKey,
        season,
        observedAt,
        hash,
        entries.length,
        truncated,
        receiptId ?? null,
      ],
    );
    snapshotId = rows[0].snapshot_id;
    await db.query(
      `insert into ranking_entry (snapshot_id, rank, player_tag, name, rating, clan_tag, clan_name)
       select $1, * from unnest($2::int[], $3::text[], $4::text[], $5::int[], $6::text[], $7::text[])`,
      [
        snapshotId,
        entries.map((e) => e.rank),
        entries.map((e) => e.tag),
        entries.map((e) => e.name),
        entries.map((e) => e.rating),
        entries.map((e) => e.clanTag),
        entries.map((e) => e.clanName),
      ],
    );
    wrote = true;
  }

  // Presence: the recording reason. Upserted for the top-N whether or not
  // the board changed — last_seen_at is a fact about this fetch.
  let recordingsStarted = 0;
  let newPresences = 0;
  if (recordTop > 0 && entries.length > 0) {
    const top = byTag(entries.filter((e) => e.rank <= recordTop));
    const stickyUntil = new Date(
      nextSeasonStartMs(observedAt.getTime()) + STICKY_GRACE_MS,
    );
    const { rows: fresh } = await db.query(
      `insert into ranking_presence
         (player_tag, board, location_key, season_id, first_seen_at, last_seen_at, first_rank, best_rank, sticky_until)
       select t.tag, $1, $2, $3, $4, $4, t.rank, t.rank, $5
       from unnest($6::text[], $7::int[]) as t(tag, rank)
       on conflict (player_tag, board, location_key, season_id) do update set
         last_seen_at = excluded.last_seen_at,
         best_rank = least(ranking_presence.best_rank, excluded.best_rank),
         sticky_until = greatest(ranking_presence.sticky_until, excluded.sticky_until)
       returning player_tag, (xmax = 0) as inserted`,
      [
        board,
        locationKey,
        season,
        observedAt,
        stickyUntil,
        top.map((e) => e.tag),
        top.map((e) => e.rank),
      ],
    );
    for (const r of fresh) {
      if (!r.inserted) continue;
      newPresences += 1;
      const rec = await reconcileRecording(db, "player", r.player_tag, null);
      if (rec.started) recordingsStarted += 1;
    }
  }

  // Settle presences that have expired since the last look at this board:
  // the recording stops if nothing else keeps it. Bounded to a day of
  // expiries so a board that was not fetched for a while does not settle
  // months of history in one transaction.
  let recordingsStopped = 0;
  const { rows: expired } = await db.query(
    `select distinct p.player_tag from ranking_presence p
     join recording r on r.subject_type = 'player' and r.subject_tag = p.player_tag
       and r.status = 'active' and r.origin = 'ranking'
     where p.board = $1 and p.location_key = $2
       and p.sticky_until <= now() and p.sticky_until > now() - interval '1 day'
       and not exists (select 1 from ranking_presence q
                       where q.player_tag = p.player_tag and q.sticky_until > now())
     limit 500`,
    [board, locationKey],
  );
  for (const r of expired) {
    const rec = await reconcileRecording(db, "player", r.player_tag, null);
    if (rec.stopped) recordingsStopped += 1;
  }

  return {
    projected: "rankings",
    board,
    location: locationKey,
    players: entries.length,
    snapshot_id: snapshotId,
    wrote,
    truncated,
    presences_new: newPresences,
    recordings_started: recordingsStarted,
    recordings_stopped: recordingsStopped,
  };
}

/**
 * A clan ladder (0069): /rankings/clans (clan score) or /rankings/clanwars
 * (clan war trophies), 1,000 places by location. Same snapshot header and
 * the same identical-fetch rule as a player board; its own entry table,
 * because a placed clan is not a placed player.
 */
export async function projectClanBoard(
  db,
  { board, entityKey, receiptId, payload, fetchedAt },
) {
  const observedAt = new Date(fetchedAt);
  const locationKey = String(entityKey ?? "").toLowerCase();
  const entries = [];
  for (const i of payload?.items ?? []) {
    let tag;
    try {
      tag = normalizeTag(String(i?.tag ?? ""));
    } catch {
      continue;
    }
    const rank = Number(i.rank);
    if (!Number.isInteger(rank) || rank <= 0) continue;
    entries.push({
      rank,
      previousRank: Number.isInteger(i.previousRank) ? i.previousRank : null,
      tag,
      name: i.name ?? null,
      score: i.clanScore ?? i.clanWarTrophies ?? null,
      members: Number.isInteger(i.members) ? i.members : null,
      badgeId: Number.isInteger(i.badgeId) ? i.badgeId : null,
      locationId: Number.isInteger(i.location?.id) ? i.location.id : null,
    });
  }
  // A clan we have never seen lands a clan row so the clan tools can name it.
  if (entries.length > 0) {
    const ordered = byTag(entries);
    await db.query(
      `insert into clan (clan_tag, name)
       select t.tag, t.name from unnest($1::text[], $2::text[]) as t(tag, name)
       on conflict (clan_tag) do update set name = coalesce(clan.name, excluded.name)`,
      [ordered.map((e) => e.tag), ordered.map((e) => e.name)],
    );
  }
  await db.query(
    `insert into ranking_board (board, location_key, label, location_kind, every_minutes, record_top, enabled)
     values ($1, $2, $2, case when $2 = 'global' then 'global' else 'country' end, 1440, 0, false)
     on conflict (board, location_key) do nothing`,
    [board, locationKey],
  );
  const h = createHash("sha256");
  for (const e of entries) h.update(`${e.rank}\t${e.tag}\t${e.score ?? ""}\n`);
  const hash = h.digest("hex");
  const truncated = Boolean(payload?.paging?.cursors?.after);
  const { rows: last } = await db.query(
    `select snapshot_id, content_hash from ranking_snapshot
     where board = $1 and location_key = $2 order by observed_at desc limit 1`,
    [board, locationKey],
  );
  if (last[0] && last[0].content_hash === hash) {
    await db.query(
      `update ranking_snapshot set last_confirmed_at = $2
       where snapshot_id = $1 and last_confirmed_at < $2`,
      [last[0].snapshot_id, observedAt],
    );
    return {
      projected: "clan_rankings",
      board,
      location: locationKey,
      clans: entries.length,
      wrote: false,
      truncated,
    };
  }
  if (entries.length === 0)
    return {
      projected: "clan_rankings",
      board,
      location: locationKey,
      clans: 0,
      wrote: false,
      truncated,
    };
  const { rows } = await db.query(
    `insert into ranking_snapshot
       (board, location_key, season_id, observed_at, last_confirmed_at, content_hash, entries, truncated, receipt_id)
     values ($1, $2, $3, $4, $4, $5, $6, $7, $8) returning snapshot_id`,
    [
      board,
      locationKey,
      String(seasonFromDate(observedAt.getTime()).seasonId),
      observedAt,
      hash,
      entries.length,
      truncated,
      receiptId ?? null,
    ],
  );
  await db.query(
    `insert into clan_ranking_entry
       (snapshot_id, rank, previous_rank, clan_tag, name, score, members, badge_id, location_id)
     select $1, * from unnest($2::int[], $3::int[], $4::text[], $5::text[], $6::int[], $7::int[], $8::int[], $9::int[])`,
    [
      rows[0].snapshot_id,
      entries.map((e) => e.rank),
      entries.map((e) => e.previousRank),
      entries.map((e) => e.tag),
      entries.map((e) => e.name),
      entries.map((e) => e.score),
      entries.map((e) => e.members),
      entries.map((e) => e.badgeId),
      entries.map((e) => e.locationId),
    ],
  );
  return {
    projected: "clan_rankings",
    board,
    location: locationKey,
    clans: entries.length,
    wrote: true,
    truncated,
  };
}

/**
 * The list of game-mode boards (0069). Nothing here names an id: the API
 * lists them (30 on 2026-09-11, 15 in March; they rotate with seasons) and
 * this enables a ('mode', <id>) board per entry and disables the ones that
 * have gone, so the scheduler follows the game rather than a table.
 */
export async function projectLeaderboardList(db, { payload }) {
  const items = (payload?.items ?? []).filter((i) => Number.isInteger(i?.id));
  const ids = items.map((i) => String(i.id));
  if (ids.length > 0) {
    await db.query(
      `insert into ranking_board (board, location_key, label, location_kind, every_minutes, record_top, enabled)
       select 'mode', t.id, t.name, 'mode', 1440, 0, true
       from unnest($1::text[], $2::text[]) as t(id, name)
       on conflict (board, location_key) do update set
         label = excluded.label, enabled = true`,
      [ids, items.map((i) => String(i.name ?? i.id))],
    );
  }
  const { rowCount: retired } = await db.query(
    `update ranking_board set enabled = false
     where board = 'mode' and enabled and not (location_key = any($1::text[]))`,
    [ids],
  );
  return { projected: "leaderboards", boards: ids.length, retired };
}

/**
 * What is on (0069). /events is the modes and challenges running now, with
 * no dates, so the calendar is built from sightings: the event row is the
 * thing, a day row is a day it was seen running.
 */
export async function projectEvents(db, { payload, fetchedAt }) {
  const observedAt = new Date(fetchedAt);
  const day = observedAt.toISOString().slice(0, 10);
  const events = byTag(
    (Array.isArray(payload) ? payload : []).filter(
      (e) => typeof e?.eventTag === "string",
    ),
    "eventTag",
  );
  if (events.length === 0) return { projected: "events", events: 0 };
  await db.query(
    `insert into game_event (event_tag, title, description, first_seen_at, last_seen_at)
     select t.tag, t.title, t.description, $4, $4
     from unnest($1::text[], $2::text[], $3::text[]) as t(tag, title, description)
     on conflict (event_tag) do update set
       title = coalesce(excluded.title, game_event.title),
       description = coalesce(excluded.description, game_event.description),
       last_seen_at = greatest(game_event.last_seen_at, excluded.last_seen_at),
       first_seen_at = least(game_event.first_seen_at, excluded.first_seen_at)`,
    [
      events.map((e) => e.eventTag),
      events.map((e) => e.title ?? null),
      events.map((e) => e.description ?? null),
      observedAt,
    ],
  );
  await db.query(
    `insert into game_event_day (event_tag, day)
     select unnest($1::text[]), $2::date on conflict do nothing`,
    [events.map((e) => e.eventTag), day],
  );
  return { projected: "events", events: events.length, day };
}

/** Global tournaments (0069): rare, small, kept whole. */
export async function projectTournaments(db, { payload, fetchedAt }) {
  const observedAt = new Date(fetchedAt);
  const items = (payload?.items ?? []).filter(
    (t) => typeof t?.tag === "string",
  );
  if (items.length === 0) return { projected: "tournaments", tournaments: 0 };
  await db.query(
    `insert into game_tournament (tournament_tag, payload, first_seen_at, last_seen_at)
     select t.tag, t.payload::jsonb, $3, $3
     from unnest($1::text[], $2::text[]) as t(tag, payload)
     on conflict (tournament_tag) do update set
       payload = excluded.payload, last_seen_at = greatest(game_tournament.last_seen_at, excluded.last_seen_at)`,
    [items.map((t) => t.tag), items.map((t) => JSON.stringify(t)), observedAt],
  );
  return { projected: "tournaments", tournaments: items.length };
}
