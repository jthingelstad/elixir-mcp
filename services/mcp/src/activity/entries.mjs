/**
 * Activity entries — the notification feed's row, synthesized at read time.
 *
 * One entry is a SUBJECT's activity since the reader's cursor (review
 * 2026-09-13, Parts II and III, ratified by Jamie): a summary sentence a
 * person can read, always-present sections of facts, and the named
 * happenings inside the window. Built from the record and the subject
 * ledger when asked, per reader, so nothing is fanned out, folded or pruned.
 *
 * The four tests every field passes: not computable by the reader; assumes
 * nothing about the reader's purpose; synthesis over ticks; named. No field
 * here is an instruction, and none says what time it is.
 *
 * Window semantics (§13.2): the window is what the record LEARNED between
 * `from` and `to`, keyed on commit time (`battle.created_at`, the ledger's
 * `window_end`, snapshot `observed_at`). Battles admitted in the window but
 * played more than a day before `from` are counted once as late captures
 * and never narrated. State facts (trophies, arena, league, collection
 * level) are a diff of the latest snapshot at each end of the window,
 * which is synthesis by construction.
 *
 * PROTOTYPE STATUS (2026-09-13): the badge and card-level counts still come
 * from the old per-account feed rows, because the ledger does not yet carry
 * those happenings (§13.10 is the ledger write). Every such field says so
 * in its `basis`.
 */

import { MODE_GROUP_BY_TYPE } from "@elixir-mcp/contracts";
import { anchoredPeriod } from "../../../ingest/src/war-clock.mjs";
import { summarizePlayer, summarizeClan } from "./summary.mjs";

const DAY_MS = 86_400_000;
/** Disclosed rungs (§13.8): data, not code. */
const QUIET_RUNGS_DAYS = [5, 10, 20];
const BEST_TROPHIES_BAND = 500;
const COLLECTION_LEVEL_STEP = 5;
const CAREER_WINS_STEP = 1000;
const RETURN_AFTER_DAYS = 7;
const LIST_CAP = 20;
const STANDOUT_CAP = 5;

/** The current-scale ranked league names (elixir-bot normalize.py). */
const RANKED_LEAGUES = {
  1: "Master 1",
  2: "Master 2",
  3: "Master 3",
  4: "Champion",
  5: "Grand Champion",
  6: "Royal Champion",
  7: "Ultimate Champion",
};
const leagueName = (n) =>
  n === null || n === undefined ? null : (RANKED_LEAGUES[n] ?? `League ${n}`);
/** Arena ids are opaque (54000144 is "Spirit Square", rawName Arena_L18):
 *  the record keeps the id and no arena catalog exists yet, so an entry
 *  names the id and says a promotion happened. Names arrive with an arena
 *  catalog fed from profile payloads. */
const arenaNumber = (id) =>
  id === null || id === undefined ? null : Number(id);

const iso = (v) => (v ? new Date(v).toISOString() : null);
const crossed = (before, after, step) =>
  typeof before === "number" &&
  typeof after === "number" &&
  Math.floor(after / step) > Math.floor(before / step);
const capList = (rows, cap = LIST_CAP) =>
  rows.length > cap
    ? { items: rows.slice(0, cap), more: rows.length - cap }
    : { items: rows, more: 0 };

/* ------------------------------------------------------------------ */
/* Subjects                                                            */
/* ------------------------------------------------------------------ */

/**
 * The subjects an account hears about (§13.5): every claim with notify on
 * as a player entry, every added clan with notify on as a clan entry.
 * Members of an agent's clan are NOT subjects; they live inside the clan
 * entry.
 */
export async function subjectsFor(db, accountId) {
  const { rows: players } = await db.query(
    `select c.player_tag, c.relationship, nn.nickname
       from claim c
       left join player_nickname nn
         on nn.account_id = c.account_id and nn.player_tag = c.player_tag
      where c.account_id = $1 and c.notify
      order by c.is_primary desc, c.relationship, c.player_tag`,
    [accountId],
  );
  const { rows: clans } = await db.query(
    `select clan_tag, scope from account_clan
      where account_id = $1 and notify order by clan_tag`,
    [accountId],
  );
  return [
    ...players.map((r) => ({
      kind: "player",
      tag: r.player_tag,
      relationship: r.relationship,
      nickname: r.nickname ?? null,
    })),
    ...clans.map((r) => ({ kind: "clan", tag: r.clan_tag, scope: r.scope })),
  ];
}

/* ------------------------------------------------------------------ */
/* Player entry                                                        */
/* ------------------------------------------------------------------ */

async function snapshotAt(db, tag, atMs) {
  const { rows } = await db.query(
    `select observed_at, trophies, best_trophies, arena_id,
            (lifetime->>'collectionLevel')::int as collection_level,
            (lifetime->>'wins')::int as wins,
            (lifetime->>'battleCount')::int as battle_count,
            donations,
            (pol->'current'->>'leagueNumber')::int as league
       from player_snapshot_daily
      where player_tag = $1 and observed_at is not null
        and observed_at <= to_timestamp($2 / 1000.0)
      order by observed_at desc limit 1`,
    [tag, atMs],
  );
  return rows[0] ?? null;
}

export async function buildPlayerEntry(
  db,
  { tag, relationship = null, nickname = null, fromMs, toMs, timezone = "UTC" },
) {
  const { rows: who } = await db.query(
    `select p.name, cm.clan_tag, c.name as clan_name, cm.role
       from player p
       left join clan_membership cm
         on cm.player_tag = p.player_tag and cm.left_observed_at is null
       left join clan c on c.clan_tag = cm.clan_tag
      where p.player_tag = $1`,
    [tag],
  );
  const name = who[0]?.name ?? null;

  // Battles the record learned in the window (commit time), with when they
  // were played beside it so late captures can be set aside.
  const { rows: battles } = await db.query(
    `select b.battle_id, b.type, b.battle_time, bp.outcome, bp.crowns,
            bp.trophy_change, bp.clan_tag
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id
      where bp.player_tag = $1
        and b.created_at > to_timestamp($2 / 1000.0)
        and b.created_at <= to_timestamp($3 / 1000.0)
      order by b.battle_time`,
    [tag, fromMs, toMs],
  );
  const lateCut = fromMs - DAY_MS;
  const played = battles.filter((b) => b.battle_time.getTime() >= lateCut);
  const late = battles.length - played.length;
  const byMode = {};
  let won = 0;
  let lost = 0;
  let drawn = 0;
  let threeCrowns = 0;
  for (const b of played) {
    const group = MODE_GROUP_BY_TYPE[b.type] ?? "other";
    byMode[group] = (byMode[group] ?? 0) + 1;
    if (b.outcome === "win") won += 1;
    else if (b.outcome === "loss") lost += 1;
    else drawn += 1;
    if (b.outcome === "win" && b.crowns === 3) threeCrowns += 1;
  }
  const trophyNet = played
    .filter((b) => MODE_GROUP_BY_TYPE[b.type] === "ladder")
    .reduce((s, b) => s + (b.trophy_change ?? 0), 0);

  // State at each end of the window: the diff IS the story.
  const before = await snapshotAt(db, tag, fromMs);
  const after = await snapshotAt(db, tag, toMs);
  const diff = (key) =>
    before && after && after[key] !== null && before[key] !== null
      ? {
          from: before[key],
          to: after[key],
          changed: after[key] !== before[key],
        }
      : null;
  const trophies = diff("trophies");
  const best = diff("best_trophies");
  const arena = diff("arena_id");
  const league = diff("league");
  const collectionLevel = diff("collection_level");
  const wins = diff("wins");

  // Prototype basis for badges and card levels: the old feed's rows.
  const { rows: feedCounts } = await db.query(
    `select topic, sum((payload->>'count')::int)::int as n
       from event_feed
      where subject_tag = $1
        and topic in ('badge_earned','legendary_badge_earned','card_leveled')
        and created_at > to_timestamp($2 / 1000.0)
        and created_at <= to_timestamp($3 / 1000.0)
      group by topic`,
    [tag, fromMs, toMs],
  );
  const feedCount = (t) => feedCounts.find((r) => r.topic === t)?.n ?? 0;

  // Cards first seen in the window, excluding the first-observation flood
  // (a new tracking arrives with a whole collection at once).
  const { rows: unlocked } = await db.query(
    `with first as (
       select min(first_seen_at) as t0 from player_card where player_tag = $1)
     select c.name, c.rarity
       from player_card pc
       join card c on c.card_id = pc.card_id, first
      where pc.player_tag = $1
        and pc.first_seen_at > to_timestamp($2 / 1000.0)
        and pc.first_seen_at <= to_timestamp($3 / 1000.0)
        and pc.first_seen_at > first.t0 + interval '1 hour'
      order by pc.first_seen_at`,
    [tag, fromMs, toMs],
  );

  // Clan moves in the window, from the membership record.
  const { rows: moves } = await db.query(
    `select cm.clan_tag, c.name as clan_name, cm.role,
            cm.joined_observed_at, cm.left_observed_at
       from clan_membership cm
       left join clan c on c.clan_tag = cm.clan_tag
      where cm.player_tag = $1
        and ((cm.joined_observed_at > to_timestamp($2 / 1000.0)
              and cm.joined_observed_at <= to_timestamp($3 / 1000.0))
          or (cm.left_observed_at > to_timestamp($2 / 1000.0)
              and cm.left_observed_at <= to_timestamp($3 / 1000.0)))
      order by coalesce(cm.left_observed_at, cm.joined_observed_at)`,
    [tag, fromMs, toMs],
  );
  const clanChanges = [];
  for (const m of moves) {
    const joinedIn =
      m.joined_observed_at.getTime() > fromMs &&
      m.joined_observed_at.getTime() <= toMs;
    const leftIn =
      m.left_observed_at &&
      m.left_observed_at.getTime() > fromMs &&
      m.left_observed_at.getTime() <= toMs;
    if (joinedIn)
      clanChanges.push({
        kind: "joined",
        clan_tag: m.clan_tag,
        clan_name: m.clan_name,
        at: iso(m.joined_observed_at),
      });
    if (leftIn)
      clanChanges.push({
        kind: "left",
        clan_tag: m.clan_tag,
        clan_name: m.clan_name,
        role: m.role,
        at: iso(m.left_observed_at),
      });
  }

  // Presence: the last recorded battle at `to`, and a return after silence.
  const { rows: lastRows } = await db.query(
    `select max(bp.battle_time) as last_battle
       from battle_participant bp
      where bp.player_tag = $1 and bp.battle_time <= to_timestamp($2 / 1000.0)`,
    [tag, toMs],
  );
  const lastBattle = lastRows[0]?.last_battle ?? null;
  const daysQuiet = lastBattle
    ? Math.floor((toMs - lastBattle.getTime()) / DAY_MS)
    : null;
  let returnedAfterDays = null;
  if (played.length > 0) {
    const firstIn = played[0].battle_time.getTime();
    const { rows: prior } = await db.query(
      `select max(bp.battle_time) as t from battle_participant bp
        where bp.player_tag = $1 and bp.battle_time < to_timestamp($2 / 1000.0)`,
      [tag, firstIn],
    );
    const t = prior[0]?.t;
    if (t) {
      const gap = Math.floor((firstIn - t.getTime()) / DAY_MS);
      if (gap >= RETURN_AFTER_DAYS) returnedAfterDays = gap;
    }
  }
  const { rows: pollRows } = await db.query(
    `select floor(extract(epoch from (to_timestamp($2 / 1000.0) - last_admitted_at)) / 86400)::int
              as days_since_poll
       from poll_state where subject_tag = $1 and endpoint = 'player_battlelog'`,
    [tag, toMs],
  );
  const daysSincePoll = pollRows[0]?.days_since_poll ?? null;

  // War decks in the window: recorded war battles, by policy day.
  const warBattles = played.filter((b) => MODE_GROUP_BY_TYPE[b.type] === "war");

  const notables = [];
  if (best?.changed && crossed(best.from, best.to, BEST_TROPHIES_BAND))
    notables.push({ kind: "best_trophies_band", value: best.to });
  if (arena?.changed && arena.to > arena.from)
    notables.push({
      kind: "arena_promotion",
      from: arenaNumber(arena.from),
      to: arenaNumber(arena.to),
    });
  if (league?.changed && league.to > league.from)
    notables.push({ kind: "ranked_promotion", league: leagueName(league.to) });
  if (
    collectionLevel?.changed &&
    crossed(collectionLevel.from, collectionLevel.to, COLLECTION_LEVEL_STEP)
  )
    notables.push({ kind: "collection_level", value: collectionLevel.to });
  if (wins?.changed && crossed(wins.from, wins.to, CAREER_WINS_STEP))
    notables.push({ kind: "career_wins", value: wins.to });
  if (feedCount("legendary_badge_earned") > 0)
    notables.push({
      kind: "legendary_badge",
      count: feedCount("legendary_badge_earned"),
    });
  if (feedCount("badge_earned") > 0)
    notables.push({ kind: "badge_level", count: feedCount("badge_earned") });
  for (const c of clanChanges)
    notables.push({ kind: `clan_${c.kind}`, clan_name: c.clan_name });
  if (returnedAfterDays !== null)
    notables.push({ kind: "returned", after_days: returnedAfterDays });

  const entry = {
    kind: "player_activity",
    subject_tag: tag,
    name,
    nickname,
    relationship,
    window: { from: iso(fromMs), to: iso(toMs) },
    summary: null,
    battles: {
      played: played.length,
      won,
      lost,
      drawn,
      three_crown_wins: threeCrowns,
      by_mode: byMode,
      trophy_net_ladder: trophyNet,
      late_captures: late,
    },
    trophies:
      trophies || best
        ? {
            from: trophies?.from ?? null,
            to: trophies?.to ?? null,
            best: best?.to ?? null,
            new_best: Boolean(best?.changed && best.to > best.from),
            as_of: iso(after?.observed_at),
          }
        : null,
    arena: arena?.changed
      ? { from: arenaNumber(arena.from), to: arenaNumber(arena.to) }
      : null,
    ranked: league?.changed
      ? { from: leagueName(league.from), to: leagueName(league.to) }
      : null,
    collection: {
      level: collectionLevel?.changed
        ? { from: collectionLevel.from, to: collectionLevel.to }
        : null,
      unlocked: capList(
        unlocked.map((c) => c.name),
        STANDOUT_CAP,
      ),
      leveled: feedCount("card_leveled"),
      basis:
        "unlocked from the collection record; leveled from the prototype feed rows until the ledger carries card moments",
    },
    badges: {
      earned: feedCount("badge_earned"),
      legendary: feedCount("legendary_badge_earned"),
      basis:
        "counts from the prototype feed rows; names arrive with the ledger",
    },
    clan: {
      tag: who[0]?.clan_tag ?? null,
      name: who[0]?.clan_name ?? null,
      role: who[0]?.role ?? null,
      changes: clanChanges,
    },
    war: {
      battles: warBattles.length,
      days: [
        ...new Set(
          warBattles.map((b) => b.battle_time.toISOString().slice(0, 10)),
        ),
      ].length,
    },
    presence: {
      last_battle_at: iso(lastBattle),
      days_quiet: daysQuiet,
      days_since_poll: daysSincePoll,
      returned_after_days: returnedAfterDays,
    },
    notables,
  };
  entry.summary = summarizePlayer(entry, timezone);
  return entry;
}

/* ------------------------------------------------------------------ */
/* Clan entry                                                          */
/* ------------------------------------------------------------------ */

export async function buildClanEntry(
  db,
  { tag, scope = "comprehensive", fromMs, toMs, timezone = "UTC" },
) {
  const { rows: clanRows } = await db.query(
    `select name from clan where clan_tag = $1`,
    [tag],
  );
  const name = clanRows[0]?.name ?? null;
  const comprehensive = scope === "comprehensive";

  const sizeAt = async (atMs) =>
    (
      await db.query(
        `select count(*)::int as n from clan_membership
          where clan_tag = $1 and joined_observed_at <= to_timestamp($2 / 1000.0)
            and (left_observed_at is null or left_observed_at > to_timestamp($2 / 1000.0))`,
        [tag, atMs],
      )
    ).rows[0].n;
  const sizeFrom = await sizeAt(fromMs);
  const sizeTo = await sizeAt(toMs);

  // Activity: battles played while in this clan, learned in the window.
  const { rows: act } = await db.query(
    `select count(distinct bp.battle_id)::int as battles,
            count(distinct bp.player_tag)::int as active,
            count(distinct bp.battle_id) filter
              (where bp.battle_time < to_timestamp($2 / 1000.0) - interval '1 day')::int
              as late
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id
      where bp.clan_tag = $1
        and b.created_at > to_timestamp($2 / 1000.0)
        and b.created_at <= to_timestamp($3 / 1000.0)`,
    [tag, fromMs, toMs],
  );
  const { rows: modeRows } = await db.query(
    `select b.type, count(distinct bp.battle_id)::int as n
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id
      where bp.clan_tag = $1
        and b.created_at > to_timestamp($2 / 1000.0)
        and b.created_at <= to_timestamp($3 / 1000.0)
        and bp.battle_time >= to_timestamp($2 / 1000.0) - interval '1 day'
      group by b.type`,
    [tag, fromMs, toMs],
  );
  const byMode = {};
  for (const r of modeRows) {
    const g = MODE_GROUP_BY_TYPE[r.type] ?? "other";
    byMode[g] = (byMode[g] ?? 0) + r.n;
  }

  // Roster moves from the subject ledger (clan_event), named.
  const { rows: ledger } = await db.query(
    `select event_type, window_end, payload from clan_event
      where clan_tag = $1
        and window_end > to_timestamp($2 / 1000.0)
        and window_end <= to_timestamp($3 / 1000.0)
      order by event_id`,
    [tag, fromMs, toMs],
  );
  const leftTags = ledger
    .filter((e) => e.event_type === "member_left")
    .map((e) => e.payload.player_tag);
  const { rows: leftNames } = leftTags.length
    ? await db.query(
        `select player_tag, name from player where player_tag = any($1)`,
        [leftTags],
      )
    : { rows: [] };
  const nameOf = (t) => leftNames.find((r) => r.player_tag === t)?.name ?? null;
  const joined = [];
  const left = [];
  const roleChanges = [];
  for (const e of ledger) {
    const p = e.payload ?? {};
    const at = iso(e.window_end);
    if (e.event_type === "member_joined")
      joined.push({
        tag: p.player_tag,
        name: p.name ?? null,
        role: p.role ?? null,
        at,
      });
    else if (e.event_type === "member_left")
      left.push({
        tag: p.player_tag,
        name: nameOf(p.player_tag),
        role: p.role_at_departure ?? null,
        at,
        tenure_days: p.joined_observed_at
          ? Math.floor(
              (e.window_end.getTime() - Date.parse(p.joined_observed_at)) /
                DAY_MS,
            )
          : null,
      });
    else if (e.event_type === "role_changed")
      roleChanges.push({
        tag: p.player_tag,
        name: p.name ?? null,
        from: p.role_before ?? null,
        to: p.role_after ?? null,
        at,
      });
  }
  // A join and a leave by the same tag inside the window is a bounce; it
  // stays in both lists (facts) and is counted so a reader can see churn.
  const bounced = joined.filter((j) =>
    left.some((l) => l.tag === j.tag),
  ).length;

  // War: the state at `to`, and anything that resolved in the window.
  let war = null;
  const { rows: wk } = await db.query(
    `select season_id, section_index, is_colosseum, finished_observed_at
       from war_week where clan_tag = $1
      order by season_id desc, section_index desc limit 1`,
    [tag],
  );
  if (wk[0]) {
    const { rows: anchorRows } = await db.query(
      `select period_index, first_observed_at from war_period_anchor
        where clan_tag = $1 and first_observed_at <= to_timestamp($2 / 1000.0)
        order by first_observed_at desc limit 1`,
      [tag, toMs],
    );
    const { rows: ours } = await db.query(
      `select fame, rank, trophy_change, finish_time, period_points from war_week_clan
        where clan_tag = $1 and participant_clan_tag = $1
          and season_id = $2 and section_index = $3`,
      [tag, wk[0].season_id, wk[0].section_index],
    );
    const { rows: standing } = await db.query(
      `select count(*)::int + 1 as place from war_week_clan
        where clan_tag = $1 and season_id = $2 and section_index = $3
          and participant_clan_tag <> $1 and fame > $4`,
      [tag, wk[0].season_id, wk[0].section_index, ours[0]?.fame ?? 0],
    );
    war = {
      season_id: wk[0].season_id,
      week: wk[0].section_index + 1,
      is_colosseum: wk[0].is_colosseum,
      day_kind: null,
      war_day: null,
      fame: ours[0]?.fame ?? null,
      place_of_five: standing[0]?.place ?? null,
      race_finished_at: iso(ours[0]?.finish_time),
      decks: null,
      resolved: [],
    };
    if (anchorRows[0]) {
      const p = anchoredPeriod(
        anchorRows[0].period_index,
        anchorRows[0].first_observed_at.getTime(),
        toMs,
      );
      war.day_kind = p.info.kind;
      war.war_day = p.info.warDay ?? null;
      if (p.openNow && p.info.warDay) {
        const { rows: decks } = await db.query(
          `with base as (
             select wp.player_tag from war_participation wp
              where wp.clan_tag = $1 and wp.season_id = $2 and wp.section_index = $3
                and exists (select 1 from clan_membership cm
                             where cm.clan_tag = wp.clan_tag and cm.player_tag = wp.player_tag
                               and cm.left_observed_at is null)),
           att as (
             select player_tag, decks_used_today from war_attendance_day
              where clan_tag = $1 and season_id = $2 and section_index = $3 and war_day = $4),
           fought as (
             select bp.player_tag, count(distinct b.battle_id)::int as n
               from battle b join battle_participant bp on bp.battle_id = b.battle_id
              where bp.clan_tag = $1 and b.season_id = $2 and b.section_index = $3
                and b.war_day = $4
              group by bp.player_tag),
           merged as (
             select base.player_tag,
                    least(greatest(coalesce(att.decks_used_today, 0),
                                   coalesce(fought.n, 0)), 4) as d
               from base
               left join att on att.player_tag = base.player_tag
               left join fought on fought.player_tag = base.player_tag)
           select count(*) filter (where d = 0)::int as untouched,
                  count(*) filter (where d between 1 and 3)::int as partial,
                  count(*) filter (where d = 4)::int as finished,
                  count(*)::int as participants
             from merged`,
          [tag, wk[0].season_id, wk[0].section_index, p.info.warDay],
        );
        if (decks[0].participants > 0)
          war.decks = { as_of: iso(toMs), ...decks[0] };
      }
    }
    // Weeks that finished inside the window carry their result.
    const { rows: finished } = await db.query(
      `select w.season_id, w.section_index, w.is_colosseum, w.finished_observed_at,
              c.fame, c.rank, c.trophy_change
         from war_week w
         left join war_week_clan c
           on c.clan_tag = w.clan_tag and c.season_id = w.season_id
          and c.section_index = w.section_index and c.participant_clan_tag = w.clan_tag
        where w.clan_tag = $1
          and w.finished_observed_at > to_timestamp($2 / 1000.0)
          and w.finished_observed_at <= to_timestamp($3 / 1000.0)
        order by w.season_id, w.section_index`,
      [tag, fromMs, toMs],
    );
    war.resolved = finished.map((r) => ({
      season_id: r.season_id,
      week: r.section_index + 1,
      is_colosseum: r.is_colosseum,
      finished_at: iso(r.finished_observed_at),
      fame: r.fame,
      rank: r.rank,
      trophy_change: r.trophy_change,
    }));
  }

  // Presence: rung crossings inside the window, returns, never recorded.
  const { rows: members } = await db.query(
    `select cm.player_tag, p.name, cm.role,
            (select max(bp.battle_time) from battle_participant bp
              where bp.player_tag = cm.player_tag
                and bp.battle_time <= to_timestamp($2 / 1000.0)) as last_battle,
            (select floor(extract(epoch from (to_timestamp($2 / 1000.0) - ps.last_admitted_at)) / 86400)::int
               from poll_state ps
              where ps.subject_tag = cm.player_tag and ps.endpoint = 'player_battlelog')
              as days_since_poll
       from clan_membership cm
       join player p on p.player_tag = cm.player_tag
      where cm.clan_tag = $1 and cm.left_observed_at is null`,
    [tag, toMs],
  );
  const quietCrossed = [];
  let neverRecorded = 0;
  for (const m of members) {
    if (!m.last_battle) {
      neverRecorded += 1;
      continue;
    }
    const last = m.last_battle.getTime();
    const daysAtTo = (toMs - last) / DAY_MS;
    const daysAtFrom = (fromMs - last) / DAY_MS;
    const rung = QUIET_RUNGS_DAYS.filter(
      (r) => daysAtTo >= r && daysAtFrom < r,
    ).pop();
    if (
      rung !== undefined &&
      (m.days_since_poll === null || m.days_since_poll < rung)
    )
      quietCrossed.push({
        tag: m.player_tag,
        name: m.name,
        role: m.role,
        days_quiet: Math.floor(daysAtTo),
        days_since_poll: m.days_since_poll,
        rung,
      });
  }
  quietCrossed.sort((a, b) => b.days_quiet - a.days_quiet);
  const { rows: returned } = await db.query(
    `with inwin as (
       select bp.player_tag, min(bp.battle_time) as first_in
         from battle_participant bp
         join battle b on b.battle_id = bp.battle_id
        where bp.clan_tag = $1
          and b.created_at > to_timestamp($2 / 1000.0)
          and b.created_at <= to_timestamp($3 / 1000.0)
          and bp.battle_time >= to_timestamp($2 / 1000.0) - interval '1 day'
        group by bp.player_tag)
     select i.player_tag, p.name,
            floor(extract(epoch from (i.first_in - prior.t)) / 86400)::int as after_days
       from inwin i
       join player p on p.player_tag = i.player_tag
       join lateral (
         select max(bp2.battle_time) as t from battle_participant bp2
          where bp2.player_tag = i.player_tag and bp2.battle_time < i.first_in) prior on true
      where prior.t is not null
        and i.first_in - prior.t >= make_interval(days => $4)
      order by after_days desc`,
    [tag, fromMs, toMs, RETURN_AFTER_DAYS],
  );

  // Standouts, bounded and named.
  const { rows: most } = await db.query(
    `select bp.player_tag, p.name, count(distinct bp.battle_id)::int as battles
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id
       join player p on p.player_tag = bp.player_tag
      where bp.clan_tag = $1
        and b.created_at > to_timestamp($2 / 1000.0)
        and b.created_at <= to_timestamp($3 / 1000.0)
        and bp.battle_time >= to_timestamp($2 / 1000.0) - interval '1 day'
      group by bp.player_tag, p.name
      order by battles desc, p.name nulls last limit $4`,
    [tag, fromMs, toMs, STANDOUT_CAP],
  );
  const { rows: states } = await db.query(
    `with m as (select player_tag from clan_membership
                 where clan_tag = $1 and left_observed_at is null),
     b as (select distinct on (s.player_tag) s.player_tag, s.best_trophies, s.arena_id,
                  (s.pol->'current'->>'leagueNumber')::int as league,
                  (s.lifetime->>'collectionLevel')::int as cl
             from player_snapshot_daily s join m on m.player_tag = s.player_tag
            where s.observed_at <= to_timestamp($2 / 1000.0)
            order by s.player_tag, s.observed_at desc),
     a as (select distinct on (s.player_tag) s.player_tag, s.best_trophies, s.arena_id,
                  (s.pol->'current'->>'leagueNumber')::int as league,
                  (s.lifetime->>'collectionLevel')::int as cl
             from player_snapshot_daily s join m on m.player_tag = s.player_tag
            where s.observed_at <= to_timestamp($3 / 1000.0)
            order by s.player_tag, s.observed_at desc)
     select m.player_tag, p.name,
            b.best_trophies as best_before, a.best_trophies as best_after,
            b.arena_id as arena_before, a.arena_id as arena_after,
            b.league as league_before, a.league as league_after,
            b.cl as cl_before, a.cl as cl_after
       from m join player p on p.player_tag = m.player_tag
       left join b on b.player_tag = m.player_tag
       left join a on a.player_tag = m.player_tag`,
    [tag, fromMs, toMs],
  );
  const newBests = [];
  const arenaPromotions = [];
  const rankedPromotions = [];
  const collectionSteps = [];
  for (const s of states) {
    if (crossed(s.best_before, s.best_after, BEST_TROPHIES_BAND))
      newBests.push({ tag: s.player_tag, name: s.name, best: s.best_after });
    if (
      typeof s.arena_before === "number" &&
      typeof s.arena_after === "number" &&
      s.arena_after > s.arena_before
    )
      arenaPromotions.push({
        tag: s.player_tag,
        name: s.name,
        arena: arenaNumber(s.arena_after),
      });
    if (
      typeof s.league_before === "number" &&
      typeof s.league_after === "number" &&
      s.league_after > s.league_before
    )
      rankedPromotions.push({
        tag: s.player_tag,
        name: s.name,
        league: leagueName(s.league_after),
      });
    if (crossed(s.cl_before, s.cl_after, COLLECTION_LEVEL_STEP))
      collectionSteps.push({
        tag: s.player_tag,
        name: s.name,
        level: s.cl_after,
      });
  }
  newBests.sort((x, y) => y.best - x.best);
  const { rows: badgeRows } = await db.query(
    `select f.subject_tag as tag, p.name, sum((f.payload->>'count')::int)::int as n
       from event_feed f
       join clan_membership cm on cm.player_tag = f.subject_tag
        and cm.clan_tag = $1 and cm.left_observed_at is null
       join player p on p.player_tag = f.subject_tag
      where f.topic in ('badge_earned','legendary_badge_earned')
        and f.created_at > to_timestamp($2 / 1000.0)
        and f.created_at <= to_timestamp($3 / 1000.0)
      group by f.subject_tag, p.name order by n desc limit $4`,
    [tag, fromMs, toMs, STANDOUT_CAP],
  );

  // Donations: the weekly counter as of the latest snapshot at `to`, for
  // snapshots taken since the game's Monday reset.
  const { rows: don } = await db.query(
    `with m as (select player_tag from clan_membership
                 where clan_tag = $1 and left_observed_at is null),
     latest as (select distinct on (s.player_tag) s.player_tag, s.donations
                  from player_snapshot_daily s join m on m.player_tag = s.player_tag
                 where s.observed_at <= to_timestamp($2 / 1000.0)
                   and s.observed_at >= date_trunc('week', to_timestamp($2 / 1000.0))
                 order by s.player_tag, s.observed_at desc)
     select coalesce(sum(latest.donations), 0)::int as total,
            count(*)::int as counted,
            (select json_build_object('tag', l.player_tag, 'name', p.name, 'given', l.donations)
               from latest l join player p on p.player_tag = l.player_tag
              order by l.donations desc nulls last limit 1) as leader
       from latest`,
    [tag, toMs],
  );

  const entry = {
    kind: "clan_activity",
    subject_tag: tag,
    name,
    scope,
    window: { from: iso(fromMs), to: iso(toMs) },
    summary: null,
    activity: comprehensive
      ? {
          battles: act[0].battles - act[0].late,
          members_active: act[0].active,
          members_total: sizeTo,
          by_mode: byMode,
          late_captures: act[0].late,
          basis: "recorded",
        }
      : {
          battles: null,
          members_active: null,
          members_total: sizeTo,
          by_mode: null,
          late_captures: null,
          basis:
            "activity scope records roster and war only; member battles are not recorded for this clan",
        },
    roster: {
      joined: capList(joined),
      left: capList(left),
      role_changes: capList(roleChanges),
      bounced,
      size: { from: sizeFrom, to: sizeTo },
    },
    war,
    presence: comprehensive
      ? {
          quiet_crossed: capList(quietCrossed),
          returned: capList(
            returned.map((r) => ({
              tag: r.player_tag,
              name: r.name,
              after_days: r.after_days,
            })),
          ),
          never_recorded: neverRecorded,
          rungs_days: QUIET_RUNGS_DAYS,
        }
      : {
          quiet_crossed: null,
          returned: null,
          never_recorded: null,
          rungs_days: QUIET_RUNGS_DAYS,
          basis:
            "activity scope: no member battle record to judge presence from",
        },
    standouts: comprehensive
      ? {
          most_battles: most.map((r) => ({
            tag: r.player_tag,
            name: r.name,
            battles: r.battles,
          })),
          new_bests: capList(newBests, STANDOUT_CAP),
          arena_promotions: capList(arenaPromotions, STANDOUT_CAP),
          ranked_promotions: capList(rankedPromotions, STANDOUT_CAP),
          collection_levels: capList(collectionSteps, STANDOUT_CAP),
          badges: badgeRows.map((r) => ({
            tag: r.tag,
            name: r.name,
            count: r.n,
          })),
          badges_basis:
            "counts from the prototype feed rows; names arrive with the ledger",
        }
      : null,
    donations: {
      week_total: don[0]?.total ?? 0,
      members_counted: don[0]?.counted ?? 0,
      leader: don[0]?.leader ?? null,
      as_of: iso(toMs),
    },
  };
  entry.summary = summarizeClan(entry, timezone);
  return entry;
}

/* ------------------------------------------------------------------ */
/* The feed                                                            */
/* ------------------------------------------------------------------ */

/**
 * Entries for a list of subjects over one window. Player subjects with
 * nothing to say are listed under `quiet` rather than given an entry
 * (§13.4); clan subjects always get one, because a clan's silence is
 * itself the clan's activity.
 */
export async function buildEntries(
  db,
  subjects,
  { fromMs, toMs, timezone = "UTC" },
) {
  const entries = [];
  const quiet = [];
  for (const s of subjects) {
    if (s.kind === "clan") {
      entries.push(
        await buildClanEntry(db, {
          tag: s.tag,
          scope: s.scope,
          fromMs,
          toMs,
          timezone,
        }),
      );
      continue;
    }
    const e = await buildPlayerEntry(db, {
      tag: s.tag,
      relationship: s.relationship ?? null,
      nickname: s.nickname ?? null,
      fromMs,
      toMs,
      timezone,
    });
    const said =
      e.battles.played > 0 ||
      e.notables.length > 0 ||
      e.clan.changes.length > 0 ||
      e.collection.unlocked.items.length > 0;
    if (said) entries.push(e);
    else
      quiet.push({
        tag: e.subject_tag,
        name: e.name,
        nickname: e.nickname,
        relationship: e.relationship,
        days_quiet: e.presence.days_quiet,
        days_since_poll: e.presence.days_since_poll,
      });
  }
  return { window: { from: iso(fromMs), to: iso(toMs) }, entries, quiet };
}
