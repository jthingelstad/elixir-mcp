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
      // Path of Legends carries eloRating; the trophy boards trophies.
      rating: i.eloRating ?? i.trophies ?? null,
      clanTag,
      clanName: i.clan?.name ?? null,
    });
  }
  return out.filter((e) => Number.isInteger(e.rank) && e.rank > 0);
}

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
  { board, entityKey, receiptId, payload, fetchedAt },
) {
  const entries = entriesOf(payload);
  const observedAt = new Date(fetchedAt);
  const locationKey = String(entityKey ?? "").toLowerCase();

  // Identity accretion, as before: every ranked tag lands a player row
  // so the player tools can address it at once. Presence has a foreign
  // key to player, so this has to come first.
  if (entries.length > 0) {
    await db.query(
      `insert into player (player_tag, name)
       select t.tag, t.name from unnest($1::text[], $2::text[]) as t(tag, name)
       on conflict (player_tag) do update set
         last_seen_at = now(),
         name = coalesce(player.name, excluded.name)`,
      [entries.map((e) => e.tag), entries.map((e) => e.name)],
    );
  }

  // A board we did not know about (a location the API added, or a hand
  // live_fetch of one) is remembered but not scheduled.
  const { rows: boardRows } = await db.query(
    `insert into ranking_board (board, location_key, label, location_kind, every_minutes, record_top, enabled)
     values ($1, $2, $2, case when $2 = 'global' then 'global' else 'country' end, 1440, 0, false)
     on conflict (board, location_key) do update set label = ranking_board.label
     returning record_top`,
    [board, locationKey],
  );
  const recordTop = boardRows[0]?.record_top ?? 0;

  const truncated = Boolean(payload?.paging?.cursors?.after);
  const hash = contentHash(entries);
  const { rows: last } = await db.query(
    `select snapshot_id, content_hash from ranking_snapshot
     where board = $1 and location_key = $2
     order by observed_at desc limit 1`,
    [board, locationKey],
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
    const { seasonId } = seasonFromDate(observedAt.getTime());
    const { rows } = await db.query(
      `insert into ranking_snapshot
         (board, location_key, season_id, observed_at, last_confirmed_at, content_hash, entries, truncated, receipt_id)
       values ($1, $2, $3, $4, $4, $5, $6, $7, $8)
       returning snapshot_id`,
      [
        board,
        locationKey,
        String(seasonId),
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
    const top = entries.filter((e) => e.rank <= recordTop);
    const { seasonId } = seasonFromDate(observedAt.getTime());
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
        String(seasonId),
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
