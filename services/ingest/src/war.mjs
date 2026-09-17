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

import { emitEvent } from "./events.mjs";
import { normalizeTag } from "@elixir-mcp/contracts";
import { warClock } from "./war-clock.mjs";
import { crTimeToIso } from "./battle-time.mjs";
import { verifyWarSeason } from "./season.mjs";

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

/** `nowMs` is the recency guards' clock (bracket_observed, race_finished):
 *  injectable so a test can replay a dated fixture as news. */
export async function projectRiverRace(
  db,
  { payload, fetchedAt, nowMs = Date.now() },
) {
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

  // 1. Anchor: first observation of this period wins — WITHIN a season.
  // periodIndex is season-monotonic and RESETS each season (cr docs),
  // so the same (clan, index) key returns every ~5 weeks. An anchor
  // more than 7 days older than the new observation is last season's:
  // refresh it, and treat the period as newly opened. A replayed OLD
  // payload can never refresh (its fetchedAt is not newer). Found by
  // the sol-6 assessment, 2026-09-05.
  const { rows: anchorInsert } = await db.query(
    `insert into war_period_anchor (clan_tag, period_index, first_observed_at)
     values ($1, $2, $3)
     on conflict (clan_tag, period_index) do update
       set first_observed_at = excluded.first_observed_at
       where excluded.first_observed_at
             > war_period_anchor.first_observed_at + interval '7 days'
     returning period_index`,
    [tag, payload.periodIndex, fetchedAt],
  );

  const clock = await clanClock(db, tag, payload, observedMs);
  if (clock.seasonId === null) {
    return { projected: "anchor_only", needsBackfill: true };
  }

  // A war day opening is a clock fact (game_clock), never a ledger row.
  // The boat crossing the finish line IS an observation: one row, once.
  const { rows: priorFinish } = await db.query(
    `select finish_time from war_week_clan
      where clan_tag = $1 and participant_clan_tag = $1
        and season_id = $2 and section_index = $3`,
    [tag, clock.seasonId, clock.sectionIndex],
  );

  // 2. The week row. Its first appearance is the bracket being observed:
  // one ledger row naming the rivals, recency-guarded like race_finished
  // so an archive replay never writes old brackets as news.
  const { rows: priorWeek } = await db.query(
    `select 1 from war_week where clan_tag = $1 and season_id = $2 and section_index = $3`,
    [tag, clock.seasonId, clock.sectionIndex],
  );
  await db.query(
    `insert into war_week (clan_tag, season_id, section_index, is_colosseum, started_observed_at)
     values ($1, $2, $3, $4, $5)
     on conflict (clan_tag, season_id, section_index) do update set
       is_colosseum = war_week.is_colosseum or excluded.is_colosseum,
       started_observed_at = least(war_week.started_observed_at, excluded.started_observed_at)
     where (not war_week.is_colosseum and excluded.is_colosseum)
        or war_week.started_observed_at is null
        or war_week.started_observed_at > excluded.started_observed_at`,
    [
      tag,
      clock.seasonId,
      clock.sectionIndex,
      clock.kind === "colosseum",
      fetchedAt,
    ],
  );

  if (priorWeek.length === 0 && observedMs > nowMs - 24 * 3600_000) {
    const rivalTags = (payload.clans ?? [])
      .map((c) => (c?.tag ? normalizeTag(c.tag) : null))
      .filter((t) => t && t !== tag);
    const { rows: recorded } = rivalTags.length
      ? await db.query(
          `select distinct clan_tag from clan_membership where clan_tag = any($1::text[])`,
          [rivalTags],
        )
      : { rows: [] };
    const recordedSet = new Set(recorded.map((r) => r.clan_tag));
    await emitEvent(db, "bracket_observed", {
      tag,
      windowEnd: fetchedAt,
      payload: {
        season_id: clock.seasonId,
        section_index: clock.sectionIndex,
        is_colosseum: clock.kind === "colosseum",
        rivals: (payload.clans ?? [])
          .filter((c) => c?.tag && normalizeTag(c.tag) !== tag)
          .map((c) => ({
            tag: normalizeTag(c.tag),
            name: c.name ?? null,
            recorded: recordedSet.has(normalizeTag(c.tag)),
          })),
      },
    });
  }

  // 3. Standings across the race's clans (fame here is the boat's own).
  // The rivals' clanScore rides the same observation stamp as
  // period_points (latest wins), repairPoints MAX-merges like every war
  // counter, and badgeId lands on the rival's clan row (2026-09-17,
  // time-series review 2.3).
  let facts = anchorInsert.length;
  for (const c of payload.clans ?? []) {
    const { rowCount } = await db.query(
      `insert into war_week_clan
         (clan_tag, season_id, section_index, participant_clan_tag, participant_name,
          fame, period_points, period_points_observed_at, finish_time, clan_score, repair_points)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (clan_tag, season_id, section_index, participant_clan_tag) do update set
         fame = greatest(war_week_clan.fame, excluded.fame),
         period_points = case
           when excluded.period_points_observed_at >= coalesce(
             war_week_clan.period_points_observed_at, '-infinity'::timestamptz)
           then excluded.period_points else war_week_clan.period_points end,
         clan_score = case
           when excluded.period_points_observed_at >= coalesce(
             war_week_clan.period_points_observed_at, '-infinity'::timestamptz)
           then coalesce(excluded.clan_score, war_week_clan.clan_score) else war_week_clan.clan_score end,
         period_points_observed_at = greatest(
           war_week_clan.period_points_observed_at,
           excluded.period_points_observed_at),
         repair_points = greatest(war_week_clan.repair_points, excluded.repair_points),
         participant_name = coalesce(excluded.participant_name, war_week_clan.participant_name),
         finish_time = coalesce(war_week_clan.finish_time, excluded.finish_time)
       -- Touch the row only when a counter or a name actually moves: the
       -- same race is observed dozens of times a day, and an unchanged
       -- MAX-merge still writes a tuple version (2026-09-11: 5,190
       -- updates on 310 rows).
       where war_week_clan.fame < excluded.fame
          or (excluded.period_points_observed_at >= coalesce(
                war_week_clan.period_points_observed_at, '-infinity'::timestamptz)
              and (war_week_clan.period_points is distinct from excluded.period_points
                   or (excluded.clan_score is not null
                       and war_week_clan.clan_score is distinct from excluded.clan_score)))
          or war_week_clan.repair_points is distinct from
             greatest(war_week_clan.repair_points, excluded.repair_points)
          or (war_week_clan.participant_name is null and excluded.participant_name is not null)
          or (war_week_clan.finish_time is null and excluded.finish_time is not null)`,
      [
        tag,
        clock.seasonId,
        clock.sectionIndex,
        normalizeTag(c.tag),
        c.name ?? null,
        c.fame ?? 0,
        c.periodPoints ?? null,
        fetchedAt,
        c.finishTime ? crTimeToIso(c.finishTime) : null,
        Number.isInteger(c.clanScore) ? c.clanScore : null,
        Number.isInteger(c.repairPoints) ? c.repairPoints : null,
      ],
    );
    facts += rowCount;
  }
  facts += await projectRivalBadges(db, payload.clans ?? []);
  facts += await projectPeriodLogs(db, {
    tag,
    seasonId: clock.seasonId,
    sectionIndex: clock.sectionIndex,
    periodLogs: payload.periodLogs,
    fetchedAt,
  });
  const own = (payload.clans ?? []).find(
    (c) => c?.tag && normalizeTag(c.tag) === tag,
  );
  if (
    own?.finishTime &&
    !priorFinish[0]?.finish_time &&
    observedMs > nowMs - 24 * 3600_000
  ) {
    await emitEvent(db, "race_finished", {
      tag,
      windowEnd: fetchedAt,
      occurredAt: crTimeToIso(own.finishTime),
      payload: {
        season_id: clock.seasonId,
        section_index: clock.sectionIndex,
        fame: own.fame ?? null,
        finish_time: crTimeToIso(own.finishTime),
      },
    });
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
  // One statement per table for the whole roster, ordered by tag (the
  // lock order every bulk upsert in this repo takes), and guarded so a
  // poll that moved nothing writes nothing: war_participation had
  // 145,432 updates on 12,739 inserts and war_attendance_day 79,924 on
  // 2,700 before 2026-09-11, all of them no-op MAX-merges rewritten as
  // new tuple versions - about 150 round trips per poll besides.
  const participants = [];
  const seen = new Set();
  for (const p of payload.clan.participants ?? []) {
    const playerTag = normalizeTag(p.tag);
    if (seen.has(playerTag)) continue; // ON CONFLICT cannot touch a row twice
    seen.add(playerTag);
    participants.push({
      tag: playerTag,
      name: p.name ?? null,
      points: p.fame ?? 0,
      decksUsed: p.decksUsed ?? 0,
      boatAttacks: p.boatAttacks ?? 0,
      repairPoints: Number.isInteger(p.repairPoints) ? p.repairPoints : null,
      decksUsedToday: p.decksUsedToday ?? 0,
    });
    const delta = (p.decksUsed ?? 0) - (prevDecks.get(playerTag) ?? 0);
    if (delta > 0) deckDeltas.set(playerTag, delta);
  }
  participants.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const members = participants.length;
  if (members > 0) {
    const tags = participants.map((p) => p.tag);
    await db.query(
      `insert into player (player_tag, name)
       select t.tag, t.name from unnest($1::text[], $2::text[]) as t(tag, name)
       on conflict do nothing`,
      [tags, participants.map((p) => p.name)],
    );
    const { rowCount: partMoved } = await db.query(
      `insert into war_participation
         (clan_tag, season_id, section_index, player_tag, points, decks_used, boat_attacks, repair_points)
       select $1, $2, $3, t.tag, t.points, t.decks, t.boats, t.repairs
       from unnest($4::text[], $5::int[], $6::int[], $7::int[], $8::int[]) as t(tag, points, decks, boats, repairs)
       on conflict (clan_tag, season_id, section_index, player_tag) do update set
         points = greatest(war_participation.points, excluded.points),
         decks_used = greatest(war_participation.decks_used, excluded.decks_used),
         boat_attacks = greatest(war_participation.boat_attacks, excluded.boat_attacks),
         repair_points = greatest(war_participation.repair_points, excluded.repair_points)
       where war_participation.points < excluded.points
          or war_participation.decks_used < excluded.decks_used
          or war_participation.boat_attacks < excluded.boat_attacks
          or war_participation.repair_points is distinct from
             greatest(war_participation.repair_points, excluded.repair_points)`,
      [
        tag,
        clock.seasonId,
        clock.sectionIndex,
        tags,
        participants.map((p) => p.points),
        participants.map((p) => p.decksUsed),
        participants.map((p) => p.boatAttacks),
        participants.map((p) => p.repairPoints),
      ],
    );
    facts += partMoved;
    if (clock.warDay !== null) {
      const { rowCount: dayMoved } = await db.query(
        `insert into war_attendance_day
           (clan_tag, season_id, section_index, war_day, player_tag, decks_used_today)
         select $1, $2, $3, $4, t.tag, t.today
         from unnest($5::text[], $6::int[]) as t(tag, today)
         on conflict (clan_tag, season_id, section_index, war_day, player_tag) do update set
           decks_used_today = greatest(war_attendance_day.decks_used_today, excluded.decks_used_today)
         where war_attendance_day.decks_used_today < excluded.decks_used_today`,
        [
          tag,
          clock.seasonId,
          clock.sectionIndex,
          clock.warDay,
          tags,
          participants.map((p) => p.decksUsedToday),
        ],
      );
      facts += dayMoved;
    }
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
    facts,
  };
}

/** The rivals' badges onto their clan rows: the row exists for a
 *  recorded rival and is created for one the record has only met in a
 *  bracket (the roster projector does the same for an incidental clan).
 *  Change-only. */
async function projectRivalBadges(db, clans) {
  const rows = clans
    .filter((c) => c?.tag)
    .map((c) => ({
      tag: normalizeTag(c.tag),
      name: c.name ?? null,
      badge: Number.isInteger(c.badgeId) ? c.badgeId : null,
    }))
    .sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  if (rows.length === 0) return 0;
  const { rowCount } = await db.query(
    `insert into clan (clan_tag, name, badge_id)
     select t.tag, t.name, t.badge from unnest($1::text[], $2::text[], $3::int[]) as t(tag, name, badge)
     on conflict (clan_tag) do update set badge_id = excluded.badge_id
     where excluded.badge_id is not null and clan.badge_id is distinct from excluded.badge_id`,
    [rows.map((r) => r.tag), rows.map((r) => r.name), rows.map((r) => r.badge)],
  );
  return rowCount;
}

/**
 * periodLogs[]: the race's closed war days per clan, present on every
 * race poll (time-series review 2.3). The array spans the whole season
 * and every entry names the CURRENT bracket's clans
 * (cr-agent-api-docs/models/river-race.md), so only the entries of the
 * section this poll is in are this bracket's days: fill-once, scoped by
 * period_index / 7 = section_index. An older poll cannot rewrite a day.
 */
async function projectPeriodLogs(
  db,
  { tag, seasonId, sectionIndex, periodLogs, fetchedAt },
) {
  if (!Array.isArray(periodLogs) || periodLogs.length === 0) return 0;
  const rows = [];
  for (const log of periodLogs) {
    if (!Number.isInteger(log?.periodIndex)) continue;
    if (Math.floor(log.periodIndex / 7) !== sectionIndex) continue;
    for (const item of log.items ?? []) {
      if (!item?.clan?.tag) continue;
      rows.push({
        period: log.periodIndex,
        clan: normalizeTag(item.clan.tag),
        pointsEarned: item.pointsEarned ?? null,
        start: item.progressStartOfDay ?? null,
        end: item.progressEndOfDay ?? null,
        earned: item.progressEarned ?? null,
        rank: item.endOfDayRank ?? null,
        defenses: item.numOfDefensesRemaining ?? null,
        fromDefenses: item.progressEarnedFromDefenses ?? null,
      });
    }
  }
  if (rows.length === 0) return 0;
  rows.sort((a, b) =>
    a.period !== b.period
      ? a.period - b.period
      : a.clan < b.clan
        ? -1
        : a.clan > b.clan
          ? 1
          : 0,
  );
  const { rowCount } = await db.query(
    `insert into war_period_log
       (clan_tag, season_id, section_index, period_index, participant_clan_tag,
        points_earned, progress_start, progress_end, progress_earned,
        end_of_day_rank, defenses_remaining, progress_from_defenses, observed_at)
     select $1, $2, $3, t.period, t.clan, t.points, t.start, t.stop, t.earned,
            t.rank, t.defenses, t.from_defenses, $4::timestamptz
     from unnest($5::int[], $6::text[], $7::int[], $8::int[], $9::int[], $10::int[],
                 $11::int[], $12::int[], $13::int[])
       as t(period, clan, points, start, stop, earned, rank, defenses, from_defenses)
     on conflict do nothing`,
    [
      tag,
      seasonId,
      sectionIndex,
      fetchedAt,
      rows.map((r) => r.period),
      rows.map((r) => r.clan),
      rows.map((r) => r.pointsEarned),
      rows.map((r) => r.start),
      rows.map((r) => r.end),
      rows.map((r) => r.earned),
      rows.map((r) => r.rank),
      rows.map((r) => r.defenses),
      rows.map((r) => r.fromDefenses),
    ],
  );
  return rowCount;
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
  let facts = 0;
  const seasonMismatches = [];
  const seasonsVerified = new Set();
  for (const item of items) {
    const finished = crTimeToIso(item.createdDate);
    const isColosseum =
      item.seasonId !== newestSeason &&
      item.sectionIndex === maxSection.get(item.seasonId);
    // The season row's derived war number against the entry's own
    // (0104): the close instant sits inside the season that raced, so
    // the row it falls in must carry this seasonId. Once per season per
    // log; a mismatch is reported to the pipeline, never relabelled.
    if (
      Number.isInteger(item.seasonId) &&
      !seasonsVerified.has(item.seasonId)
    ) {
      seasonsVerified.add(item.seasonId);
      const check = await verifyWarSeason(db, {
        warSeasonId: item.seasonId,
        closedAt: finished,
      });
      if (check.status === "mismatch")
        seasonMismatches.push({ ...check, clan_tag: tag });
    }
    const { rows: prior } = await db.query(
      `select finished_observed_at from war_week
       where clan_tag = $1 and season_id = $2 and section_index = $3`,
      [tag, item.seasonId, item.sectionIndex],
    );
    const newlyFinished = !prior[0]?.finished_observed_at;
    // closed_at (0105) is the API's own stamp for the race close, exact;
    // finished_observed_at stays as the polling-latency bound it always
    // was. Fill-once, like the rest of the row.
    await db.query(
      `insert into war_week (clan_tag, season_id, section_index, is_colosseum, finished_observed_at, closed_at)
       values ($1, $2, $3, $4, $5, $5)
       on conflict (clan_tag, season_id, section_index) do update set
         is_colosseum = war_week.is_colosseum or excluded.is_colosseum,
         finished_observed_at = coalesce(war_week.finished_observed_at, excluded.finished_observed_at),
         closed_at = coalesce(war_week.closed_at, excluded.closed_at)
       where (not war_week.is_colosseum and excluded.is_colosseum)
          or (war_week.finished_observed_at is null and excluded.finished_observed_at is not null)
          or (war_week.closed_at is null and excluded.closed_at is not null)`,
      [tag, item.seasonId, item.sectionIndex, isColosseum, finished],
    );
    if (newlyFinished) facts += 1;
    // The week resolving is an observation: one ledger row on the
    // null->set transition, recency-guarded so a history backfill never
    // writes ancient weeks as news.
    if (newlyFinished && Date.parse(finished) > Date.now() - 7 * 86400_000) {
      const ours = (item.standings ?? []).find(
        (st) => st?.clan?.tag && normalizeTag(st.clan.tag) === tag,
      );
      await emitEvent(db, "week_resolved", {
        tag,
        windowEnd: finished,
        payload: {
          season_id: item.seasonId,
          section_index: item.sectionIndex,
          is_colosseum: isColosseum,
          fame: ours?.clan?.fame ?? null,
          rank: ours?.rank ?? null,
          trophy_change: ours?.trophyChange ?? null,
        },
      });
    }
    weeks += 1;

    for (const standing of item.standings ?? []) {
      const participantTag = normalizeTag(standing.clan.tag);
      // The log's clanScore and repairPoints are the week's closing
      // values: they fill a null and never overwrite the live poll's
      // (the log stamp is not an observation of the race).
      const { rowCount: standingMoved } = await db.query(
        `insert into war_week_clan
           (clan_tag, season_id, section_index, participant_clan_tag, participant_name,
            fame, finish_time, rank, trophy_change, clan_score, repair_points)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (clan_tag, season_id, section_index, participant_clan_tag) do update set
           fame = greatest(war_week_clan.fame, excluded.fame),
           participant_name = coalesce(excluded.participant_name, war_week_clan.participant_name),
           finish_time = coalesce(war_week_clan.finish_time, excluded.finish_time),
           rank = coalesce(excluded.rank, war_week_clan.rank),
           trophy_change = coalesce(excluded.trophy_change, war_week_clan.trophy_change),
           clan_score = coalesce(war_week_clan.clan_score, excluded.clan_score),
           repair_points = greatest(war_week_clan.repair_points, excluded.repair_points)
         where war_week_clan.fame < excluded.fame
            or (war_week_clan.participant_name is null and excluded.participant_name is not null)
            or (war_week_clan.finish_time is null and excluded.finish_time is not null)
            or (excluded.rank is not null and war_week_clan.rank is distinct from excluded.rank)
            or (excluded.trophy_change is not null
                and war_week_clan.trophy_change is distinct from excluded.trophy_change)
            or (war_week_clan.clan_score is null and excluded.clan_score is not null)
            or war_week_clan.repair_points is distinct from
               greatest(war_week_clan.repair_points, excluded.repair_points)`,
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
          Number.isInteger(standing.clan.clanScore)
            ? standing.clan.clanScore
            : null,
          Number.isInteger(standing.clan.repairPoints)
            ? standing.clan.repairPoints
            : null,
        ],
      );
      facts += standingMoved;

      // Participation: the enrolled clan's OWN members only (clan-scoped).
      if (participantTag === tag) {
        for (const p of standing.clan.participants ?? []) {
          const playerTag = normalizeTag(p.tag);
          await db.query(
            `insert into player (player_tag, name) values ($1, $2) on conflict do nothing`,
            [playerTag, p.name ?? null],
          );
          const { rowCount: memberMoved } = await db.query(
            `insert into war_participation
               (clan_tag, season_id, section_index, player_tag, points, decks_used, boat_attacks, repair_points)
             values ($1, $2, $3, $4, $5, $6, $7, $8)
             on conflict (clan_tag, season_id, section_index, player_tag) do update set
               points = greatest(war_participation.points, excluded.points),
               decks_used = greatest(war_participation.decks_used, excluded.decks_used),
               boat_attacks = greatest(war_participation.boat_attacks, excluded.boat_attacks),
               repair_points = greatest(war_participation.repair_points, excluded.repair_points)
             where war_participation.points < excluded.points
                or war_participation.decks_used < excluded.decks_used
                or war_participation.boat_attacks < excluded.boat_attacks
                or war_participation.repair_points is distinct from
                   greatest(war_participation.repair_points, excluded.repair_points)`,
            [
              tag,
              item.seasonId,
              item.sectionIndex,
              playerTag,
              p.fame ?? 0,
              p.decksUsed ?? 0,
              p.boatAttacks ?? 0,
              Number.isInteger(p.repairPoints) ? p.repairPoints : null,
            ],
          );
          facts += memberMoved;
          // decksUsedToday in a closed log is the LAST war day's count
          // (2.3): the attendance row for war day 4 the live poll missed
          // (a clan polled every two hours on a day it did not play,
          // or a week recorded from the log alone). MAX-merged like the
          // live path; a live row that already holds it moves nothing.
          if (Number.isInteger(p.decksUsedToday) && p.decksUsedToday > 0) {
            const { rowCount: dayMoved } = await db.query(
              `insert into war_attendance_day
                 (clan_tag, season_id, section_index, war_day, player_tag, decks_used_today)
               values ($1, $2, $3, 4, $4, $5)
               on conflict (clan_tag, season_id, section_index, war_day, player_tag) do update set
                 decks_used_today = greatest(war_attendance_day.decks_used_today, excluded.decks_used_today)
               where war_attendance_day.decks_used_today < excluded.decks_used_today`,
              [
                tag,
                item.seasonId,
                item.sectionIndex,
                playerTag,
                p.decksUsedToday,
              ],
            );
            facts += dayMoved;
          }
        }
      }
    }
    facts += await projectRivalBadges(
      db,
      (item.standings ?? []).map((st) => st?.clan).filter(Boolean),
    );
  }
  return {
    projected: "riverracelog",
    weeks,
    seasons: [...seasons].sort((a, b) => a - b),
    facts,
    ...(seasonMismatches.length ? { season_mismatches: seasonMismatches } : {}),
  };
}
