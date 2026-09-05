/**
 * War projector — DESIGN §4.5 V2 (elixir-bot emitters/war.py pattern).
 *
 * Every counter merges with MAX (monotonic-accumulator discipline): the
 * same week is observed dozens of times and a lagging payload must never
 * regress a number. The payload's per-member "fame" is stored as POINTS
 * (§13). seasonId is absent from live payloads — inferred from logged
 * history; at genesis (nothing logged yet) we record the period ANCHOR
 * and standings-independent state only, and report that backfill is
 * needed. riverracelog backfill supplies the first logged season.
 *
 * Known edge (accepted): a FIRST delivery of a stale pre-roll payload
 * arriving after the season rolled would attribute to the new season.
 * Redeliveries can't (receipt dedup), the window is the roll boundary
 * itself, and MAX-merge caps the damage to a phantom partial week.
 * Guard deliberately deferred until observed.
 */

import { normalizeTag } from "@elixir-mcp/contracts";
import { warClock, resolveWarKeys } from "./war-clock.mjs";
import { emitToClanWatchers } from "../../mcp/src/feed.mjs";

async function latestLoggedWeek(db, clanTag) {
  const { rows } = await db.query(
    `select season_id, section_index from war_week
     where clan_tag = $1 order by season_id desc, section_index desc limit 1`,
    [clanTag],
  );
  return rows[0]
    ? { seasonId: rows[0].season_id, sectionIndex: rows[0].section_index }
    : null;
}

/** Build the clan's current clock from recorded anchors + logged weeks. */
async function clanClock(db, clanTag, payload, nowMs) {
  const { rows: anchors } = await db.query(
    `select period_index, first_observed_at from war_period_anchor
     where clan_tag = $1 and period_index = $2`,
    [clanTag, payload.periodIndex],
  );
  const logged = await latestLoggedWeek(db, clanTag);
  return warClock(payload, {
    nowMs,
    anchorMs: anchors[0] ? anchors[0].first_observed_at.getTime() : null,
    logged,
  });
}

export async function projectRiverRace(db, { payload, fetchedAt }) {
  const tag = normalizeTag(payload.clan.tag);
  const observedMs = Date.parse(fetchedAt);
  // The observing clan must exist before any war row references it. The
  // roster poll usually seeds it, but nothing guarantees the ordering —
  // a fresh enrollment can race its first riverrace ahead of its first
  // roster, and the archive replay skips clan payloads entirely
  // (found live 2026-09-04: FK violation on an archive riverrace).
  await db.query(
    `insert into clan (clan_tag) values ($1) on conflict do nothing`,
    [tag],
  );

  // 1. Anchor: first observation of this period wins, forever.
  await db.query(
    `insert into war_period_anchor (clan_tag, period_index, first_observed_at)
     values ($1, $2, $3) on conflict do nothing`,
    [tag, payload.periodIndex, fetchedAt],
  );

  const clock = await clanClock(db, tag, payload, observedMs);
  if (clock.seasonId === null) {
    return { projected: "anchor_only", needsBackfill: true };
  }

  // 2. The week row.
  await db.query(
    `insert into war_week (clan_tag, season_id, section_index, is_colosseum, started_observed_at)
     values ($1, $2, $3, $4, $5)
     on conflict (clan_tag, season_id, section_index) do update set
       is_colosseum = war_week.is_colosseum or excluded.is_colosseum,
       started_observed_at = least(war_week.started_observed_at, excluded.started_observed_at)`,
    [
      tag,
      clock.seasonId,
      clock.sectionIndex,
      clock.kind === "colosseum",
      fetchedAt,
    ],
  );

  // 3. Standings across the race's clans (fame here is the boat's own).
  for (const c of payload.clans ?? []) {
    await db.query(
      `insert into war_week_clan
         (clan_tag, season_id, section_index, participant_clan_tag, participant_name, fame, finish_time)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (clan_tag, season_id, section_index, participant_clan_tag) do update set
         fame = greatest(war_week_clan.fame, excluded.fame),
         participant_name = coalesce(excluded.participant_name, war_week_clan.participant_name),
         finish_time = coalesce(war_week_clan.finish_time, excluded.finish_time)`,
      [
        tag,
        clock.seasonId,
        clock.sectionIndex,
        normalizeTag(c.tag),
        c.name ?? null,
        c.fame ?? 0,
        c.finishTime ? crTimeToIso(c.finishTime) : null,
      ],
    );
  }

  // 4. Participation: the payload's per-member "fame" is POINTS here.
  // Previous decks_used per member first: the DELTA is a free yield
  // observation — one riverrace poll tells us exactly who just battled,
  // covering the whole roster for the cost of a single fetch. Without
  // this edge, a member whose battlelog cadence stretched to daily
  // stays stale for hours DURING a war day (observed live 2026-09-04:
  // battlelog fetches collapsed to ~3/hr mid-colosseum).
  const { rows: prevPart } = await db.query(
    `select player_tag, decks_used from war_participation
     where clan_tag = $1 and season_id = $2 and section_index = $3`,
    [tag, clock.seasonId, clock.sectionIndex],
  );
  const prevDecks = new Map(prevPart.map((r) => [r.player_tag, r.decks_used]));
  const deckDeltas = new Map();
  let members = 0;
  for (const p of payload.clan.participants ?? []) {
    const playerTag = normalizeTag(p.tag);
    await db.query(
      `insert into player (player_tag, name) values ($1, $2) on conflict do nothing`,
      [playerTag, p.name ?? null],
    );
    await db.query(
      `insert into war_participation
         (clan_tag, season_id, section_index, player_tag, points, decks_used, boat_attacks)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (clan_tag, season_id, section_index, player_tag) do update set
         points = greatest(war_participation.points, excluded.points),
         decks_used = greatest(war_participation.decks_used, excluded.decks_used),
         boat_attacks = greatest(war_participation.boat_attacks, excluded.boat_attacks)`,
      [
        tag,
        clock.seasonId,
        clock.sectionIndex,
        playerTag,
        p.fame ?? 0,
        p.decksUsed ?? 0,
        p.boatAttacks ?? 0,
      ],
    );
    if (clock.warDay !== null) {
      await db.query(
        `insert into war_attendance_day
           (clan_tag, season_id, section_index, war_day, player_tag, decks_used_today)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (clan_tag, season_id, section_index, war_day, player_tag) do update set
           decks_used_today = greatest(war_attendance_day.decks_used_today, excluded.decks_used_today)`,
        [
          tag,
          clock.seasonId,
          clock.sectionIndex,
          clock.warDay,
          playerTag,
          p.decksUsedToday ?? 0,
        ],
      );
    }
    const delta = (p.decksUsed ?? 0) - (prevDecks.get(playerTag) ?? 0);
    if (delta > 0) deckDeltas.set(playerTag, delta);
    members += 1;
  }

  // 5. Yield feedback: members with NEW war decks just battled — raise
  // their battlelog yield signal so the scheduler tightens their cadence
  // now, not at their next (possibly daily) poll. Raise-only: absence of
  // war decks says nothing about ladder play. Replay guard mirrors the
  // re-heat rule: history is not activity.
  const fresh = Date.parse(fetchedAt) > Date.now() - 24 * 3600_000;
  if (fresh && deckDeltas.size > 0) {
    const { rows: prevPoll } = await db.query(
      `select last_admitted_at from poll_state
       where subject_tag = $1 and endpoint = 'currentriverrace'`,
      [tag],
    );
    const gapMs = prevPoll[0]?.last_admitted_at
      ? Date.parse(fetchedAt) - prevPoll[0].last_admitted_at.getTime()
      : 3600_000;
    const hours = Math.min(Math.max(gapMs / 3600_000, 0.25), 6);
    const tags2 = [...deckDeltas.keys()];
    const bphs = tags2.map((t) => deckDeltas.get(t) / hours);
    await db.query(
      `update poll_state ps
       set yield_bph = greatest(
             coalesce(ps.yield_bph, 0),
             0.7 * coalesce(ps.yield_bph, 0) + 0.3 * d.bph
           ),
           heat = 3, heat_updated_at = now()
       from unnest($1::text[], $2::numeric[]) as d(tag, bph)
       where ps.subject_tag = d.tag and ps.endpoint = 'player_battlelog'`,
      [tags2, bphs],
    );
  }

  return {
    projected: "war",
    seasonId: clock.seasonId,
    sectionIndex: clock.sectionIndex,
    warDay: clock.warDay,
    kind: clock.kind,
    members,
    battlers_signaled: deckDeltas.size,
  };
}

/**
 * riverracelog backfill/maintenance — the log is just another recorded
 * endpoint; its items carry seasonId, which is what unlocks live season
 * inference at genesis. Multi-tenant: everything keys on the ENROLLED
 * clan (the observer); participation is recorded for its members only.
 * Colosseum flagging: within the log, a season is complete when a later
 * season also appears; its highest section is the colosseum. The newest,
 * possibly-running season is left to the live projector's periodType.
 */
export async function projectRiverRaceLog(db, { clanTag, payload }) {
  const tag = normalizeTag(clanTag);
  // The observing clan must exist before any war row references it. The
  // roster poll usually seeds it, but nothing guarantees the ordering —
  // a fresh enrollment can race its first riverrace ahead of its first
  // roster, and the archive replay skips clan payloads entirely
  // (found live 2026-09-04: FK violation on an archive riverrace).
  await db.query(
    `insert into clan (clan_tag) values ($1) on conflict do nothing`,
    [tag],
  );
  const items = payload.items ?? [];
  const seasons = new Set(items.map((i) => i.seasonId));
  const maxSection = new Map();
  for (const i of items) {
    maxSection.set(
      i.seasonId,
      Math.max(maxSection.get(i.seasonId) ?? -1, i.sectionIndex),
    );
  }
  const newestSeason = Math.max(...seasons, -Infinity);

  let weeks = 0;
  for (const item of items) {
    const finished = crTimeToIso(item.createdDate);
    const isColosseum =
      item.seasonId !== newestSeason &&
      item.sectionIndex === maxSection.get(item.seasonId);
    const { rows: prior } = await db.query(
      `select finished_observed_at from war_week
       where clan_tag = $1 and season_id = $2 and section_index = $3`,
      [tag, item.seasonId, item.sectionIndex],
    );
    const newlyFinished = !prior[0]?.finished_observed_at;
    await db.query(
      `insert into war_week (clan_tag, season_id, section_index, is_colosseum, finished_observed_at)
       values ($1, $2, $3, $4, $5)
       on conflict (clan_tag, season_id, section_index) do update set
         is_colosseum = war_week.is_colosseum or excluded.is_colosseum,
         finished_observed_at = coalesce(war_week.finished_observed_at, excluded.finished_observed_at)`,
      [tag, item.seasonId, item.sectionIndex, isColosseum, finished],
    );
    // Push lane: fire on the null->set transition only, recency-guarded
    // so a history backfill never floods the feed with ancient weeks.
    if (newlyFinished && Date.parse(finished) > Date.now() - 7 * 86400_000) {
      await emitToClanWatchers(db, tag, "clan_war_week_finished", {
        season_id: item.seasonId,
        section_index: item.sectionIndex,
        is_colosseum: isColosseum,
      });
    }
    weeks += 1;

    for (const standing of item.standings ?? []) {
      const participantTag = normalizeTag(standing.clan.tag);
      await db.query(
        `insert into war_week_clan
           (clan_tag, season_id, section_index, participant_clan_tag, participant_name,
            fame, finish_time, rank, trophy_change)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (clan_tag, season_id, section_index, participant_clan_tag) do update set
           fame = greatest(war_week_clan.fame, excluded.fame),
           participant_name = coalesce(excluded.participant_name, war_week_clan.participant_name),
           finish_time = coalesce(war_week_clan.finish_time, excluded.finish_time),
           rank = coalesce(excluded.rank, war_week_clan.rank),
           trophy_change = coalesce(excluded.trophy_change, war_week_clan.trophy_change)`,
        [
          tag,
          item.seasonId,
          item.sectionIndex,
          participantTag,
          standing.clan.name ?? null,
          standing.clan.fame ?? 0,
          standing.clan.finishTime
            ? crTimeToIso(standing.clan.finishTime)
            : null,
          standing.rank ?? null,
          standing.trophyChange ?? null,
        ],
      );

      // Participation: the enrolled clan's OWN members only (clan-scoped).
      if (participantTag === tag) {
        for (const p of standing.clan.participants ?? []) {
          const playerTag = normalizeTag(p.tag);
          await db.query(
            `insert into player (player_tag, name) values ($1, $2) on conflict do nothing`,
            [playerTag, p.name ?? null],
          );
          await db.query(
            `insert into war_participation
               (clan_tag, season_id, section_index, player_tag, points, decks_used, boat_attacks)
             values ($1, $2, $3, $4, $5, $6, $7)
             on conflict (clan_tag, season_id, section_index, player_tag) do update set
               points = greatest(war_participation.points, excluded.points),
               decks_used = greatest(war_participation.decks_used, excluded.decks_used),
               boat_attacks = greatest(war_participation.boat_attacks, excluded.boat_attacks)`,
            [
              tag,
              item.seasonId,
              item.sectionIndex,
              playerTag,
              p.fame ?? 0,
              p.decksUsed ?? 0,
              p.boatAttacks ?? 0,
            ],
          );
        }
      }
    }
  }
  return {
    projected: "riverracelog",
    weeks,
    seasons: [...seasons].sort((a, b) => a - b),
  };
}

function crTimeToIso(crTime) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.(\d{3})Z$/.exec(
    crTime,
  );
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

/**
 * Stamp war keys onto freshly ingested war battles for an observer's clan,
 * from each battle's OWN time against the clan clock. COALESCE-fill only.
 */
export async function stampWarKeys(db, { clanTag, payload, nowMs }) {
  const tag = normalizeTag(clanTag);
  const clock = await clanClock(db, tag, payload, nowMs);
  if (clock.seasonId === null) return { stamped: 0 };
  const { rows } = await db.query(
    `select b.battle_id, b.battle_time from battle b
     join battle_participant bp on bp.battle_id = b.battle_id
     where (b.type like 'riverRace%' or b.type = 'boatBattle')
       and b.season_id is null
       and bp.clan_tag = $1
       and b.battle_time > now() - interval '14 days'`,
    [tag],
  );
  // The 14-day bound is semantic, not just fast: the live clock can only
  // resolve recent periods (cross-section = honest nulls, §4.4), so
  // older unstamped battles — e.g. archive imports beyond the log's
  // reach — can never stamp here and would be re-probed forever.
  let stamped = 0;
  for (const b of rows) {
    const keys = resolveWarKeys(b.battle_time.getTime(), clock);
    if (keys.sectionIndex === null) continue;
    await db.query(
      `update battle set
         season_id = coalesce(season_id, $2),
         section_index = coalesce(section_index, $3),
         war_day = coalesce(war_day, $4)
       where battle_id = $1`,
      [b.battle_id, keys.seasonId, keys.sectionIndex, keys.warDay],
    );
    stamped += 1;
  }
  return { stamped };
}
