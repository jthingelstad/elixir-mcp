/**
 * The timeline and its entries — synthesized at read time.
 *
 * Two layers (review 2026-09-13, Parts II–IV, ratified by Jamie):
 *
 *   - THE TIMELINE is the stream of things that happened, in order, each
 *     with an instant and a subject: the per-subject ledger (player_event,
 *     clan_event, account_event) plus a few items derived here that have a
 *     moment but no observer (a battle session, a quiet rung crossed, a
 *     return after silence).
 *   - THE ENTRIES are the summary of the unread span, one per subject: a
 *     sentence a person can read, always-present sections, named notables.
 *
 * Built from the record and the ledger when asked, per reader, so nothing
 * is fanned out, folded or pruned. The four tests every field passes: not
 * computable by the reader; assumes nothing about the reader's purpose;
 * synthesis over ticks; named. No field is an instruction, and none says
 * what time it is.
 *
 * Window semantics (§13.2): the window is what the record LEARNED between
 * `from` and `to`, keyed on commit time (`battle.created_at`) or the
 * ledger's `window_end`. Battles admitted in the window but played more
 * than a day before `from` are counted once as late captures and never
 * narrated. State facts are a diff of the latest snapshot at each end.
 */

import { badgeLabel } from "../badge-names.mjs";
import {
  ATTESTED_FACT_KINDS,
  FAMILY_APP_NAMES,
  modeGroupOf,
} from "@elixir-mcp/contracts";
import { periodAt } from "../war-period.mjs";
import { finishInstant } from "../time.mjs";
import {
  hydratePlayerEvents,
  hydrateClanEvents,
  PLAYER_EVENT_COLUMNS,
  CLAN_EVENT_COLUMNS,
} from "../event-payloads.mjs";
import { collectionLevelStep } from "../../../ingest/src/snapshots.mjs";
import { summarizePlayer, summarizeClan, itemText } from "./summary.mjs";

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
/** Disclosed rungs and rules (§13.8): data, not code. */
const QUIET_RUNGS_DAYS = [5, 10, 20];
const BEST_TROPHIES_BAND = 500;
const CAREER_WINS_STEP = 1000;
const RETURN_AFTER_DAYS = 7;
/** A session breaks on a gap of thirty minutes or more (Jamie, 2026-09-13). */
const SESSION_GAP_MS = 30 * MIN_MS;
/**
 * A session is a STANDOUT when it crosses a disclosed rung — wins in a
 * row, ladder trophies net, battles in one sitting — and the crossing
 * battle was learned in this window, so a member's session is surfaced
 * on a clan's timeline once per rung and never re-reported (consumer
 * request, docs/reviews/2026-09-16-TIMELINE-FOR-PROACTIVE.md §1: a bot
 * spent ten calls a day rebuilding these three numbers from
 * battles_performance). Absolute trophy bands on purpose: a win is worth
 * about the same at every ladder floor, so the rungs are arena-invariant.
 */
const SESSION_RUNGS = {
  won_in_a_row: [5, 10, 20],
  trophy_net: [150, 300, 500],
  battles: [20, 40],
};
const LIST_CAP = 20;
const STANDOUT_CAP = 5;
// Items per response, sized to the 48,000-character result cap: 200
// compact items ran 54,766 once every session_standout became an item
// (6.34.0); the rest page through next_cursor.
const TIMELINE_CAP = 150;
const MEMBER_MOMENTS_CAP = 100;

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

/** Player-ledger kinds that are timeline items; the rest are counted. */
const PLAYER_MOMENT_KINDS = [
  "badge_earned",
  "legendary_badge_earned",
  "arena_changed",
  "ranked_promotion",
  "best_trophies_band",
  "collection_level_step",
  "career_wins_step",
  "card_unlocked",
];
const CLAN_LEDGER_KINDS = [
  "member_joined",
  "member_left",
  "role_changed",
  "bracket_observed",
  "race_finished",
  "week_resolved",
];

/** Every item kind the timeline can carry, for the tool's `kinds` filter. */
export const ITEM_KINDS = [
  "battle_session",
  "session_standout",
  ...PLAYER_MOMENT_KINDS,
  "clan_joined",
  "clan_left",
  "member_joined",
  "member_left",
  "member_role_changed",
  "bracket_observed",
  "race_finished",
  "week_resolved",
  "quiet_crossed",
  "returned",
  // What a person did in a clan, or a family app's game produced for a
  // player, said by the app (attested facts, 9.2.0): section `attested`.
  ...ATTESTED_FACT_KINDS,
];

/**
 * badge_earned rows are lossless in the ledger (every level-up); the
 * timeline surfaces one as an ITEM only at a rung — the badge's final
 * level, or a multiple of five — and the entry counts the rest. A
 * 47-member clan produced 14 mastery level-ups in one day, all texture
 * (the 2026-09-16 request, §5). Rows written before 3.9.0 carry no
 * max_level; for them only the multiple-of-five rung applies.
 */
function badgeItemWorthy(payload) {
  const level = payload?.level;
  if (typeof level !== "number") return true; // a one-off badge is always a moment
  if (typeof payload.max_level === "number" && level >= payload.max_level)
    return true;
  return level % 5 === 0;
}

const iso = (v) => (v ? new Date(v).toISOString() : null);
/** Optional per-query timings for the ops preview (perf is a plain object). */
async function timed(perf, name, fn) {
  if (!perf) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    perf[name] = (perf[name] ?? 0) + Math.round(performance.now() - t0);
  }
}
const crossed = (before, after, step) =>
  typeof before === "number" &&
  typeof after === "number" &&
  Math.floor(after / step) > Math.floor(before / step);
const capList = (rows, cap = LIST_CAP) =>
  rows.length > cap
    ? { items: rows.slice(0, cap), more: rows.length - cap }
    : { items: rows, more: 0 };
const ts = (ms) => `to_timestamp(${Math.floor(ms)} / 1000.0)`;
// Window bounds compare at the millisecond precision the tool serves
// (Gym #245): created_at keeps microseconds, so an item echoed at
// 17:06:27.573 sat past a window ending at .573. (from, to] is written
// ">= from + 1 ms" and "< to + 1 ms", which is the same for a column
// stored in milliseconds and index-friendly for one in microseconds.

/* ------------------------------------------------------------------ */
/* Subjects                                                            */
/* ------------------------------------------------------------------ */

/**
 * The subjects an account hears about (§13.5): every claim with notify on
 * as a player entry, every added clan with notify on as a clan entry.
 * Members of an agent's clan are NOT subjects; they live inside the clan
 * entry and on the clan's timeline.
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
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

/**
 * Battle sessions: a run of one player's battles where no two consecutive
 * battles are SESSION_GAP_MS or more apart. Individual battles are never
 * items; a session is the unit a player would speak of.
 */
function sessionsOf(battles, toMs, { learned = () => true } = {}) {
  const sorted = [...battles].sort(
    (a, b) => a.battle_time.getTime() - b.battle_time.getTime(),
  );
  const sessions = [];
  let cur = null;
  for (const b of sorted) {
    const t = b.battle_time.getTime();
    if (!cur || t - cur.endMs >= SESSION_GAP_MS) {
      cur = {
        startMs: t,
        endMs: t,
        battles: 0,
        won: 0,
        lost: 0,
        drawn: 0,
        by_mode: {},
        trophy_net: 0,
        run: 0,
        won_in_a_row: 0,
        // Rungs crossed so far, and which of those crossings this window
        // learned (the battle that crossed it, for the item's instant).
        crossed: [],
        newly: [],
        // When the record LEARNED this session (Gym #162): the latest
        // commit of a battle this window learned, the instant that
        // selects the session into a window.
        learnedMs: null,
      };
      sessions.push(cur);
    }
    cur.endMs = t;
    if (b.created_at && learned(b)) {
      const c = b.created_at.getTime();
      if (cur.learnedMs === null || c > cur.learnedMs) cur.learnedMs = c;
    }
    cur.battles += 1;
    if (b.outcome === "win") {
      cur.won += 1;
      cur.run += 1;
      if (cur.run > cur.won_in_a_row) cur.won_in_a_row = cur.run;
    } else {
      if (b.outcome === "loss") cur.lost += 1;
      else cur.drawn += 1;
      cur.run = 0;
    }
    const g = modeGroupOf(b.type, b.event_tag);
    cur.by_mode[g] = (cur.by_mode[g] ?? 0) + 1;
    if (g === "ladder") cur.trophy_net += b.trophy_change ?? 0;
    for (const [key, rungs] of Object.entries(SESSION_RUNGS)) {
      const value = key === "trophy_net" ? Math.abs(cur.trophy_net) : cur[key];
      for (const rung of rungs) {
        const label = `${key}>=${rung}`;
        if (value >= rung && !cur.crossed.includes(label)) {
          cur.crossed.push(label);
          if (learned(b))
            cur.newly.push({
              label,
              at: t,
              learnedAt: b.created_at ? b.created_at.getTime() : t,
            });
        }
      }
    }
  }
  return sessions.map((s) => ({
    started_at: iso(s.startMs),
    ended_at: iso(s.endMs),
    battles: s.battles,
    won: s.won,
    lost: s.lost,
    drawn: s.drawn,
    by_mode: s.by_mode,
    trophy_net: s.trophy_net,
    won_in_a_row: s.won_in_a_row,
    open: toMs - s.endMs < SESSION_GAP_MS,
    crossed: s.crossed,
    newly: s.newly,
    learned_at: s.learnedMs === null ? null : iso(s.learnedMs),
  }));
}

/** The wire shape of a session: the bookkeeping fields stay here. */
function sessionFacts({ crossed: _c, newly: _n, learned_at: _l, ...rest }) {
  return rest;
}

/* ------------------------------------------------------------------ */
/* Player entry                                                        */
/* ------------------------------------------------------------------ */

async function snapshotAt(db, tag, atMs) {
  const { rows } = await db.query(
    `select profile_observed_at as observed_at, trophies, best_trophies, arena_id,
            collection_level, wins, battle_count,
            donations,
            pol_league as league
       from player_snapshot_daily
      where player_tag = $1 and profile_observed_at is not null
        and profile_observed_at <= ${ts(atMs)}
      order by profile_observed_at desc limit 1`,
    [tag],
  );
  return rows[0] ?? null;
}

async function playerLedger(db, tag, fromMs, toMs) {
  const { rows } = await db.query(
    `select ${PLAYER_EVENT_COLUMNS}
       from player_event
      where player_tag = $1 and window_end >= ${ts(fromMs + 1)} and window_end < ${ts(toMs + 1)}
      order by event_id`,
    [tag],
  );
  return hydratePlayerEvents(db, rows);
}

/**
 * Battles the record learned in the window: the ones played within a day
 * of it come off the player-time index. A battle the record learned more
 * than a day after it was played is a late capture (a history backfill,
 * a log polled late), counted by the created_at index and never
 * narrated. "Late" is the battle's own capture delay, not its distance
 * from the window's start (Gym #211): measured against `from`, the same
 * backfilled session was a standout in a wide window and absent in a
 * narrow one. A boat DEFENSE is not the member's battle (Jamie
 * 2026-09-24; 0171): an enemy attacked their boat and their defense deck
 * answered, so it never counts here.
 */
async function playerBattles(db, tag, fromMs, toMs) {
  const { rows } = await db.query(
    `select b.battle_id, b.type, b.event_tag, b.battle_time, b.created_at, bp.outcome, bp.crowns,
            bp.trophy_change, bp.clan_tag
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id
      where bp.player_tag = $1
        and bp.battle_time >= ${ts(fromMs - DAY_MS)} and bp.battle_time < ${ts(toMs + 1)}
        and b.created_at >= ${ts(fromMs + 1)} and b.created_at < ${ts(toMs + 1)}
        and b.battle_time >= b.created_at - interval '1 day'
        and not (b.boat_battle_side is not null
                 and (b.boat_battle_side = 'defender') = (bp.side = 0))
      order by b.battle_time`,
    [tag],
  );
  const { rows: late } = await db.query(
    `select count(*)::int as n
       from battle b
       join battle_participant bp on bp.battle_id = b.battle_id
      where b.created_at >= ${ts(fromMs + 1)} and b.created_at < ${ts(toMs + 1)}
        and b.battle_time < b.created_at - interval '1 day'
        and bp.player_tag = $1`,
    [tag],
  );
  return { rows, late: late[0]?.n ?? 0 };
}

async function presenceOf(db, tag, played, fromMs, toMs) {
  const { rows: lastRows } = await db.query(
    `select max(bp.battle_time) as last_battle
       from battle_participant bp
      where bp.player_tag = $1 and bp.battle_time < ${ts(toMs + 1)}`,
    [tag],
  );
  const lastBattle = lastRows[0]?.last_battle ?? null;
  const daysQuiet = lastBattle
    ? Math.floor((toMs - lastBattle.getTime()) / DAY_MS)
    : null;
  let returned = null;
  if (played.length > 0) {
    const firstIn = played[0].battle_time.getTime();
    const { rows: prior } = await db.query(
      `select max(bp.battle_time) as t from battle_participant bp
        where bp.player_tag = $1 and bp.battle_time < ${ts(firstIn)}`,
      [tag],
    );
    const t = prior[0]?.t;
    if (t) {
      const gap = Math.floor((firstIn - t.getTime()) / DAY_MS);
      if (gap >= RETURN_AFTER_DAYS)
        returned = { after_days: gap, at: iso(firstIn) };
    }
  }
  const { rows: pollRows } = await db.query(
    // Null only when no read at or before the window's end exists (Gym
    // #119: a negative day count read as nonsense). The last battle-log read at or before the window's end, from the
    // receipts (Gym #163): poll_state holds only the latest read, so a
    // past window had read null whenever a later poll existed.
    `select floor(extract(epoch from (${ts(toMs)} - max(r.fetched_at))) / 86400)::int
              as days_since_poll
       from api_receipt r
      where r.entity_key = $1 and r.endpoint = 'player_battlelog'
        and r.fetched_at < ${ts(toMs + 1)}`,
    [tag],
  );
  const daysSincePoll = pollRows[0]?.days_since_poll ?? null;
  // A rung crossed inside the window is a moment with an instant.
  let rungCrossed = null;
  if (lastBattle) {
    const last = lastBattle.getTime();
    const rung = QUIET_RUNGS_DAYS.filter(
      (r) => (toMs - last) / DAY_MS >= r && (fromMs - last) / DAY_MS < r,
    ).pop();
    if (rung !== undefined && (daysSincePoll === null || daysSincePoll < rung))
      rungCrossed = { rung, at: iso(last + rung * DAY_MS) };
  }
  return {
    last_battle_at: iso(lastBattle),
    days_quiet: daysQuiet,
    days_since_poll: daysSincePoll,
    returned_after_days: returned?.after_days ?? null,
    returned,
    rungCrossed,
  };
}

async function arenaNamesFor(db, ids) {
  const wanted = [...new Set(ids.filter((v) => typeof v === "number"))];
  if (wanted.length === 0) return new Map();
  const { rows } = await db.query(
    `select arena_id, name from arena where arena_id = any($1::int[])`,
    [wanted],
  );
  return new Map(rows.map((r) => [r.arena_id, r.name]));
}

function sectionOfKind(kind) {
  switch (kind) {
    case "badge_earned":
    case "legendary_badge_earned":
      return "badges";
    case "arena_changed":
    case "best_trophies_band":
      return "trophies";
    case "ranked_promotion":
      return "ranked";
    case "collection_level_step":
    case "card_unlocked":
      return "collection";
    case "career_wins_step":
      return "battles";
    default:
      return "notables";
  }
}

function decorate(kind, payload, arenaNames) {
  // The badge's or card's own name under its own key, so it never shadows
  // the member's `name` on a clan timeline ("Lava Hound unlocked Lava
  // Hound", 2026-09-16).
  // badge_label is the badge as a player says it (badge-names.mjs);
  // badge stays the API's identifier, which badges_holders matches on.
  if (kind === "badge_earned" || kind === "legendary_badge_earned") {
    const { name, ...rest } = payload;
    return { badge: name, badge_label: badgeLabel(name), ...rest };
  }
  if (kind === "card_unlocked") {
    const { name, ...rest } = payload;
    return { card: name, ...rest };
  }
  // A step recorded before the step rule (2026-09-18) carries no step:
  // said as null, so the key is always there and the note explains it
  // (Gym #121).
  if (kind === "collection_level_step")
    return { ...payload, step: payload?.step ?? null };
  if (kind === "arena_changed")
    return {
      ...payload,
      from_name: arenaNames.get(payload.from) ?? null,
      to_name: payload.to_name ?? arenaNames.get(payload.to) ?? null,
    };
  if (kind === "ranked_promotion")
    return {
      ...payload,
      from_name: leagueName(payload.from),
      to_name: leagueName(payload.to),
    };
  return payload;
}

export async function buildPlayerEntry(
  db,
  {
    tag,
    relationship = null,
    nickname = null,
    fromMs,
    toMs,
    timezone = "UTC",
    perf = null,
  },
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

  const { rows: played, late } = await timed(perf, "player.battles", () =>
    playerBattles(db, tag, fromMs, toMs),
  );
  const byMode = {};
  let won = 0;
  let lost = 0;
  let drawn = 0;
  let threeCrowns = 0;
  for (const b of played) {
    const group = modeGroupOf(b.type, b.event_tag);
    byMode[group] = (byMode[group] ?? 0) + 1;
    if (b.outcome === "win") won += 1;
    else if (b.outcome === "loss") lost += 1;
    else drawn += 1;
    if (b.outcome === "win" && b.crowns === 3) threeCrowns += 1;
  }
  const trophyNet = played
    .filter((b) => modeGroupOf(b.type, b.event_tag) === "ladder")
    .reduce((s, b) => s + (b.trophy_change ?? 0), 0);
  const sessions = sessionsOf(played, toMs);

  const before = await timed(perf, "player.snapshot", () =>
    snapshotAt(db, tag, fromMs),
  );
  const after = await timed(perf, "player.snapshot", () =>
    snapshotAt(db, tag, toMs),
  );
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

  const ledger = await timed(perf, "player.ledger", () =>
    playerLedger(db, tag, fromMs, toMs),
  );
  const ofKind = (k) => ledger.filter((r) => r.event_type === k);
  const arenaNames = await arenaNamesFor(db, [
    ...(arena ? [arena.from, arena.to] : []),
    ...ofKind("arena_changed").flatMap((r) => [r.payload.from, r.payload.to]),
  ]);

  const { rows: moves } = await db.query(
    `select cm.clan_tag, c.name as clan_name, cm.role,
            cm.joined_observed_at, cm.left_observed_at
       from clan_membership cm
       left join clan c on c.clan_tag = cm.clan_tag
      where cm.player_tag = $1
        and ((cm.joined_observed_at >= ${ts(fromMs + 1)} and cm.joined_observed_at < ${ts(toMs + 1)})
          or (cm.left_observed_at >= ${ts(fromMs + 1)} and cm.left_observed_at < ${ts(toMs + 1)}))
      order by coalesce(cm.left_observed_at, cm.joined_observed_at)`,
    [tag],
  );
  const clanChanges = [];
  for (const m of moves) {
    const j = m.joined_observed_at.getTime();
    if (j > fromMs && j <= toMs)
      clanChanges.push({
        kind: "joined",
        clan_tag: m.clan_tag,
        clan_name: m.clan_name,
        at: iso(m.joined_observed_at),
      });
    const l = m.left_observed_at?.getTime();
    if (l && l > fromMs && l <= toMs)
      clanChanges.push({
        kind: "left",
        clan_tag: m.clan_tag,
        clan_name: m.clan_name,
        role: m.role,
        at: iso(m.left_observed_at),
      });
  }
  clanChanges.sort((a, b) => a.at.localeCompare(b.at));

  const presence = await timed(perf, "player.presence", () =>
    presenceOf(db, tag, played, fromMs, toMs),
  );
  const warBattles = played.filter(
    (b) => modeGroupOf(b.type, b.event_tag) === "war",
  );

  const notables = [];
  if (best?.changed && crossed(best.from, best.to, BEST_TROPHIES_BAND))
    notables.push({ kind: "best_trophies_band", value: best.to });
  if (arena?.changed && arena.to > arena.from)
    notables.push({
      kind: "arena_promotion",
      from: arenaNames.get(arena.from) ?? null,
      to: arenaNames.get(arena.to) ?? null,
    });
  if (league?.changed && league.to > league.from)
    notables.push({ kind: "ranked_promotion", league: leagueName(league.to) });
  if (
    collectionLevel?.changed &&
    crossed(
      collectionLevel.from,
      collectionLevel.to,
      collectionLevelStep(collectionLevel.to),
    )
  )
    notables.push({ kind: "collection_level", value: collectionLevel.to });
  if (wins?.changed && crossed(wins.from, wins.to, CAREER_WINS_STEP))
    notables.push({ kind: "career_wins", value: wins.to });
  for (const r of ofKind("legendary_badge_earned"))
    notables.push({ kind: "legendary_badge", name: r.payload.name });
  const badgeUps = ofKind("badge_earned");
  if (badgeUps.length > 0)
    notables.push({
      kind: "badge_level",
      count: badgeUps.length,
      names: badgeUps.slice(0, 3).map((r) => r.payload.name),
    });
  for (const c of clanChanges)
    notables.push({ kind: `clan_${c.kind}`, clan_name: c.clan_name });
  if (presence.returned_after_days !== null)
    notables.push({
      kind: "returned",
      after_days: presence.returned_after_days,
    });

  const unlocked = ofKind("card_unlocked").map(
    (r) => r.payload.name ?? `card ${r.payload.card_id}`,
  );

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
      sessions: sessions.length,
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
      ? {
          from: arenaNames.get(arena.from) ?? null,
          to: arenaNames.get(arena.to) ?? null,
          from_id: arena.from,
          to_id: arena.to,
        }
      : null,
    ranked: league?.changed
      ? { from: leagueName(league.from), to: leagueName(league.to) }
      : null,
    collection: {
      level: collectionLevel?.changed
        ? { from: collectionLevel.from, to: collectionLevel.to }
        : null,
      unlocked: capList(unlocked, STANDOUT_CAP),
      leveled: ofKind("card_leveled").length,
    },
    badges: {
      earned: badgeUps.length,
      legendary: ofKind("legendary_badge_earned").length,
      names: capList(
        [...ofKind("legendary_badge_earned"), ...badgeUps].map(
          (r) => r.payload.name,
        ),
        STANDOUT_CAP,
      ),
    },
    clan: {
      tag: who[0]?.clan_tag ?? null,
      name: who[0]?.clan_name ?? null,
      role: who[0]?.role ?? null,
      changes: clanChanges,
    },
    // The week's war battles only: which war DAY each fell on is not
    // served (Jamie 2026-09-25: a war day's rollover cannot be placed
    // reliably at Elixir's scale; war facts are weekly aggregates).
    war: { battles: warBattles.length },
    presence: {
      last_battle_at: presence.last_battle_at,
      days_quiet: presence.days_quiet,
      days_since_poll: presence.days_since_poll,
      returned_after_days: presence.returned_after_days,
    },
    notables,
  };
  entry.summary = summarizePlayer(entry, timezone);

  // What the timeline needs from this build, without a second read.
  const items = [];
  const subject = { subject_tag: tag, subject_name: nickname ?? name };
  for (const s of sessions)
    items.push({
      ...subject,
      at: s.started_at,
      observed_at: s.learned_at ?? s.started_at,
      kind: "battle_session",
      section: "battles",
      facts: sessionFacts(s),
    });
  for (const r of ledger) {
    if (!PLAYER_MOMENT_KINDS.includes(r.event_type)) continue;
    if (r.event_type === "badge_earned" && !badgeItemWorthy(r.payload))
      continue;
    items.push({
      ...subject,
      at: iso(r.occurred_at ?? r.window_end),
      // When a poll saw it, which is what selects it into a window (Gym
      // #118); `at` is when it happened.
      observed_at: iso(r.window_end),
      kind: r.event_type,
      section: sectionOfKind(r.event_type),
      facts: decorate(r.event_type, r.payload, arenaNames),
    });
  }
  for (const c of clanChanges)
    items.push({
      ...subject,
      at: c.at,
      kind: c.kind === "joined" ? "clan_joined" : "clan_left",
      section: "clan",
      facts: c,
    });
  if (presence.returned)
    items.push({
      ...subject,
      at: presence.returned.at,
      kind: "returned",
      section: "presence",
      facts: { after_days: presence.returned.after_days },
    });
  if (presence.rungCrossed)
    items.push({
      ...subject,
      at: presence.rungCrossed.at,
      kind: "quiet_crossed",
      section: "presence",
      // As of the crossing, not the window's end (Gym #119): quiet for
      // exactly the rung's days at `at`.
      facts: {
        rung: presence.rungCrossed.rung,
        days_quiet: presence.rungCrossed.rung,
        days_since_poll: presence.days_since_poll,
      },
    });
  return { entry, items };
}

/* ------------------------------------------------------------------ */
/* Clan entry                                                          */
/* ------------------------------------------------------------------ */

/** The empty-path probe (3.18.0): did this window learn a battle of the
 *  clan's at all, split into played within a day of the window (the
 *  narrated ones) and late captures. Exported so {explain_timeline} can
 *  EXPLAIN the same statement the tool runs. */
export function clanLearnedQuery({ tag, fromMs, toMs }) {
  return {
    text: `select count(distinct b.battle_id) filter (where b.battle_time >= b.created_at - interval '1 day')::int as recent,
                  count(distinct b.battle_id) filter (where b.battle_time < b.created_at - interval '1 day')::int as late
             from battle b
             join battle_participant bp on bp.battle_id = b.battle_id
            where b.created_at >= ${ts(fromMs + 1)} and b.created_at < ${ts(toMs + 1)}
              and bp.clan_tag = $1`,
    values: [tag],
  };
}

/** The day-wide member battle fetch behind sessions and standouts: the
 *  statement an empty window used to pay for (review Part 6.1). */
export function clanMemberBattlesQuery({ tag, fromMs, toMs }) {
  return {
    text: `select bp.player_tag, bp.battle_id, b.type, b.event_tag, b.battle_time, b.created_at, bp.outcome, bp.trophy_change,
                  (b.created_at >= ${ts(fromMs + 1)} and b.created_at < ${ts(toMs + 1)}
                   and b.battle_time >= b.created_at - interval '1 day') as learned
             from battle_participant bp
             join battle b on b.battle_id = bp.battle_id
            where bp.clan_tag = $1
              and bp.battle_time >= ${ts(fromMs - DAY_MS)} and bp.battle_time < ${ts(toMs + 1)}
              and b.created_at < ${ts(toMs + 1)}
            order by bp.player_tag, b.battle_time`,
    values: [tag],
  };
}

export async function buildClanEntry(
  db,
  {
    tag,
    scope = "comprehensive",
    fromMs,
    toMs,
    timezone = "UTC",
    perf = null,
    memberTag = null,
  },
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
          where clan_tag = $1 and joined_observed_at <= ${ts(atMs)}
            and (left_observed_at is null or left_observed_at > ${ts(atMs)})`,
        [tag],
      )
    ).rows[0].n;
  const sizeFrom = await timed(perf, "clan.size", () => sizeAt(fromMs));
  const sizeTo = await timed(perf, "clan.size", () => sizeAt(toMs));

  // Activity: battles played while in this clan, learned in the window,
  // with sessions per member computed from the same rows. The fetch reaches
  // a day back on battle_time regardless of when a row was learned so a
  // session that straddles windows is judged whole; `learned` marks the
  // rows this window admitted, and the activity counts use only those.
  // The empty path first (review Part 6.1, 3.18.0): 95-99% of the
  // Discord agents' reads return nothing, and the day-wide member
  // battle scan below is most of an empty read's cost. One probe off
  // the battle created_at index says whether this window learned a
  // battle of the clan's at all; when it did not, the session, standout,
  // returned and most-active queries have nothing to find and are
  // skipped. The probe splits the learned count into played-within-a-day
  // (narrated) and late captures, so the late count comes for free.
  const { rows: learnedRows } = await timed(perf, "clan.learned", () =>
    db.query(clanLearnedQuery({ tag, fromMs, toMs })),
  );
  const learnedRecent = learnedRows[0]?.recent ?? 0;
  const lateCount = learnedRows[0]?.late ?? 0;
  const { rows: allBattles } = learnedRecent
    ? await timed(perf, "clan.member_battles", () =>
        db.query(clanMemberBattlesQuery({ tag, fromMs, toMs })),
      )
    : { rows: [] };
  const memberBattles = allBattles.filter((r) => r.learned);
  const distinctBattles = new Set();
  const byMode = {};
  const byPlayer = new Map();
  for (const r of memberBattles) {
    if (!distinctBattles.has(r.battle_id)) {
      distinctBattles.add(r.battle_id);
      const g = modeGroupOf(r.type, r.event_tag);
      byMode[g] = (byMode[g] ?? 0) + 1;
    }
    if (!byPlayer.has(r.player_tag)) byPlayer.set(r.player_tag, []);
    byPlayer.get(r.player_tag).push(r);
  }
  let sessionsTotal = 0;
  for (const rows of byPlayer.values())
    sessionsTotal += sessionsOf(rows, toMs).length;
  // One member's sessions as items when the reader asked about that
  // member (Gym #258): a clan feed carries only standout sessions, so a
  // member who played two ordinary games read 0 items.
  // Sessions of two or more battles, as a player's own timeline serves
  // them (Gym #265: single battles were served).
  // Whole sittings, from the day-wide fetch the standouts read, kept
  // when this window learned one of their battles (Gym #270: hourly
  // reads cut one sitting into per-window pieces).
  const memberSessions = memberTag
    ? sessionsOf(
        allBattles.filter((r) => r.player_tag === memberTag),
        toMs,
        { learned: (b) => b.learned },
      ).filter((x) => x.battles >= 2 && x.learned_at !== null)
    : [];
  // Session standouts: every member's sessions over the wider fetch, kept
  // when a rung was crossed by a battle this window learned. Named below,
  // once the roster query has the names.
  const byPlayerAll = new Map();
  for (const r of allBattles) {
    if (!byPlayerAll.has(r.player_tag)) byPlayerAll.set(r.player_tag, []);
    byPlayerAll.get(r.player_tag).push(r);
  }
  const standoutSessions = [];
  for (const [playerTag, rows] of byPlayerAll)
    for (const sess of sessionsOf(rows, toMs, { learned: (b) => b.learned }))
      if (sess.newly.length)
        standoutSessions.push({ player_tag: playerTag, ...sess });

  // Roster moves and war resolutions from the subject ledger, named.
  const { rows: ledgerRows } = await timed(perf, "clan.ledger", () =>
    db.query(
      `select ${CLAN_EVENT_COLUMNS} from clan_event
      where clan_tag = $1
        and window_end >= ${ts(fromMs + 1)} and window_end < ${ts(toMs + 1)}
      order by event_id`,
      [tag],
    ),
  );
  const ledger = await hydrateClanEvents(db, ledgerRows);
  // Rows written before 3.0.0 name the leaver by tag only; the player
  // table still knows the name.
  const unnamed = ledger
    .filter((e) => e.event_type === "member_left" && !e.payload?.name)
    .map((e) => e.payload?.player_tag)
    .filter(Boolean);
  const { rows: namedRows } = unnamed.length
    ? await db.query(
        `select player_tag, name from player where player_tag = any($1::text[])`,
        [unnamed],
      )
    : { rows: [] };
  const nameOf = new Map(namedRows.map((r) => [r.player_tag, r.name]));
  for (const e of ledger)
    if (e.event_type === "member_left" && e.payload && !e.payload.name)
      e.payload = {
        ...e.payload,
        name: nameOf.get(e.payload.player_tag) ?? null,
      };
  const joined = [];
  const left = [];
  const roleChanges = [];
  const resolved = [];
  for (const e of ledger) {
    const p = e.payload ?? {};
    const at = iso(e.occurred_at ?? e.window_end);
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
        name: p.name ?? null,
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
        direction: p.direction ?? null,
        at,
      });
    else if (e.event_type === "week_resolved")
      resolved.push({
        season_id: p.season_id,
        week: (p.section_index ?? 0) + 1,
        is_colosseum: Boolean(p.is_colosseum),
        finished_at: at,
        fame: p.fame ?? null,
        rank: p.rank ?? null,
        trophy_change: p.trophy_change ?? null,
      });
  }
  const bounced = joined.filter((j) =>
    left.some((l) => l.tag === j.tag),
  ).length;

  // War: the week the window ENDS in (Gym #166: a past window had
  // served the current week's race under the past day's label), or the
  // latest recorded week before it; the period from the calendar.
  let war = null;
  const p = await periodAt(db, toMs);
  const { rows: wk } = await db.query(
    `select season_id, section_index, is_colosseum, finished_observed_at, closed_at
       from war_week where clan_tag = $1
        and ($2::int is null or (season_id, section_index) <= ($2::int, $3::int))
      order by season_id desc, section_index desc limit 1`,
    [tag, p?.warSeasonId ?? null, p?.sectionIndex ?? null],
  );
  const sameWeek =
    p &&
    wk[0] &&
    wk[0].season_id === p.warSeasonId &&
    wk[0].section_index === p.sectionIndex;
  if (wk[0]) {
    const { rows: ours } = await db.query(
      `select fame, rank, trophy_change, finish_time from war_week_clan
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
    // A window that ends before the week's race closed reads the race as
    // it stood at `to` (Gym #213: 09-12..09-15 served the week's final
    // 10,146 and a finish 5 days after `to`, where the clan stood at
    // 3,435): the banked fame and place at the last war day closed by
    // then, and no finish.
    const finishedAt = finishInstant(ours[0]?.finish_time);
    // The finish instant decides when the record has one; otherwise the
    // API's own close stamp (war_week.closed_at, exact), and only then
    // when the log was seen closing, which can lag the close by a day
    // (the gate's 213.3: finished 09:38, seen the next day).
    const closedMs = finishedAt
      ? Date.parse(finishedAt)
      : (wk[0].closed_at?.getTime() ?? null);
    const closedAfterTo =
      closedMs !== null
        ? closedMs > toMs
        : Boolean(
            wk[0].finished_observed_at &&
            wk[0].finished_observed_at.getTime() > toMs &&
            toMs < Date.now() - 3_600_000,
          );
    let asOf = null;
    if (closedAfterTo) {
      const { rows: day } = await db.query(
        `select l.progress_start, l.progress_earned, l.progress_from_defenses,
                l.progress_end, l.end_of_day_rank
           from war_period_log l
           join war_period wp on wp.war_season_id = l.season_id and wp.period_index = l.period_index
          where l.clan_tag = $1 and l.participant_clan_tag = $1
            and l.season_id = $2 and l.section_index = $3
            and wp.ends_at < ${ts(toMs + 1)}
          order by l.period_index desc limit 1`,
        [tag, wk[0].season_id, wk[0].section_index],
      );
      const r = day[0];
      const parts = r
        ? [r.progress_start, r.progress_earned, r.progress_from_defenses]
        : [];
      // No day closed by `to` in the record (a Colosseum week has no boat
      // log, or the first war day was still open): unknown, never 0 (Gym
      // #249: the Colosseum read 0 against a final of 38,700).
      asOf = {
        fame: !r
          ? null
          : parts.every(Number.isInteger) &&
              r.progress_end === 10000 &&
              parts.reduce((a, b) => a + b, 0) > 10000
            ? parts.reduce((a, b) => a + b, 0)
            : r.progress_end,
        place:
          r && Number.isInteger(r.end_of_day_rank) && r.end_of_day_rank >= 0
            ? r.end_of_day_rank + 1
            : null,
      };
    }
    // The day is the calendar's at the window's end, always; the race's
    // facts are that week's record, and null when the record holds no
    // race for it - never another week's under this day's label (#166).
    war = {
      season_id: sameWeek || !p ? wk[0].season_id : p.warSeasonId,
      week: (sameWeek || !p ? wk[0].section_index : p.sectionIndex) + 1,
      is_colosseum: sameWeek || !p ? wk[0].is_colosseum : null,
      day_kind: null,
      war_day: null,
      fame: !(sameWeek || !p)
        ? null
        : asOf
          ? asOf.fame
          : (ours[0]?.fame ?? null),
      place_of_five: !(sameWeek || !p)
        ? null
        : asOf
          ? asOf.place
          : (standing[0]?.place ?? null),
      race_finished_at: sameWeek || !p ? (asOf ? null : finishedAt) : null,
      ...(asOf ? { as_of_window_end: true } : {}),
      decks: null,
      resolved,
    };
    if (p) {
      war.day_kind = p.kind;
      war.war_day = p.warDay ?? null;
      // A training day of the week in progress: no race day has run, so
      // there is no fame or place yet (Gym #266: it read fame 0, place 1
      // of 5, where war_current ranks every clan null).
      // The same until the week's first war day closes (Gym #319: an open
      // war day 1 read "0 fame, place 1 of 5" where every clan is 0 and
      // unranked; a past window in that state already served null).
      if (sameWeek && (!p.warDay || p.warDay === 1) && !finishedAt && !asOf) {
        war.fame = null;
        war.place_of_five = null;
      }
    }
    // The deck tally is the day IN PROGRESS only (Jamie 2026-09-25): a
    // closed war day's per-member decks would place the game's counter
    // and recorded battles on a day the record cannot place reliably.
    const nowMs = Date.now();
    const dayInProgress = p && nowMs >= p.startMs && nowMs < p.endMs;
    if (p && sameWeek && dayInProgress) {
      if (p.warDay) {
        // The game's own counter, as war_current.decks_today reads it
        // (9.1.2, Jamie 2026-09-25): no longer raised to war battles
        // placed on the policy day, which was the per-day attribution
        // the weekly decision retired.
        const { rows: decks } = await db.query(
          `with merged as (
             select wp.player_tag,
                    least(coalesce(t.decks_used_today, 0), 4) as d
               from war_participation wp
               left join war_attendance_day t
                 on t.clan_tag = wp.clan_tag and t.season_id = wp.season_id
                and t.section_index = wp.section_index and t.war_day = $4
                and t.player_tag = wp.player_tag
              where wp.clan_tag = $1 and wp.season_id = $2 and wp.section_index = $3
                and exists (select 1 from clan_membership cm
                             where cm.clan_tag = wp.clan_tag and cm.player_tag = wp.player_tag
                               and cm.left_observed_at is null))
           select count(*) filter (where d = 0)::int as untouched,
                  count(*) filter (where d between 1 and 3)::int as partial,
                  count(*) filter (where d = 4)::int as finished,
                  count(*)::int as participants
             from merged`,
          [tag, wk[0].season_id, wk[0].section_index, p.warDay],
        );
        if (decks[0].participants > 0)
          war.decks = { as_of: iso(Math.min(toMs, nowMs)), ...decks[0] };
      }
    }
  }

  // Presence: rung crossings inside the window, returns, never recorded.
  const { rows: members } = await timed(perf, "clan.members", () =>
    db.query(
      `select cm.player_tag, p.name, cm.role,
            (select max(bp.battle_time) from battle_participant bp
              where bp.player_tag = cm.player_tag and bp.battle_time < ${ts(toMs + 1)}) as last_battle,
            (select floor(extract(epoch from (${ts(toMs)} - max(r.fetched_at))) / 86400)::int
               from api_receipt r
              where r.entity_key = cm.player_tag and r.endpoint = 'player_battlelog'
                and r.fetched_at < ${ts(toMs + 1)})
              as days_since_poll
       from clan_membership cm
       join player p on p.player_tag = cm.player_tag
      where cm.clan_tag = $1 and cm.left_observed_at is null`,
      [tag],
    ),
  );
  const quietCrossed = [];
  let neverRecorded = 0;
  for (const m of members) {
    if (!m.last_battle) {
      neverRecorded += 1;
      continue;
    }
    const last = m.last_battle.getTime();
    const rung = QUIET_RUNGS_DAYS.filter(
      (r) => (toMs - last) / DAY_MS >= r && (fromMs - last) / DAY_MS < r,
    ).pop();
    if (
      rung !== undefined &&
      (m.days_since_poll === null || m.days_since_poll < rung)
    )
      quietCrossed.push({
        tag: m.player_tag,
        name: m.name,
        role: m.role,
        days_quiet: Math.floor((toMs - last) / DAY_MS),
        days_since_poll: m.days_since_poll,
        rung,
        at: iso(last + rung * DAY_MS),
      });
  }
  quietCrossed.sort((a, b) => b.days_quiet - a.days_quiet);
  // Every crossing the window holds, for the items (Gym #247): from each
  // member's battle gaps, not the last battle as of `to`, so a member who
  // crossed five quiet days and then played again, or crossed ten, keeps
  // the crossing the window saw. The entry's quiet_crossed stays the
  // window-end state.
  const crossings = [];
  const returns = [];
  if (comprehensive && members.length) {
    const maxRung = QUIET_RUNGS_DAYS.at(-1);
    const { rows: times } = await timed(perf, "clan.quiet_gaps", () =>
      db.query(
        `select * from (
           select bp.player_tag, bp.battle_time,
                  (select b.created_at from battle b where b.battle_id = bp.battle_id) as learned_at
             from battle_participant bp
            where bp.player_tag = any($1::text[])
              and bp.battle_time > ${ts(fromMs - maxRung * DAY_MS)}
              and bp.battle_time < ${ts(toMs + 1)}
           union all
           -- Each member's last battle before that, so a return after a
           -- longer absence has the gap's start.
           select m.tag, lb.battle_time, null
             from unnest($1::text[]) as m(tag)
             join lateral (
               select bp.battle_time from battle_participant bp
                where bp.player_tag = m.tag
                  and bp.battle_time <= ${ts(fromMs - maxRung * DAY_MS)}
                order by bp.battle_time desc limit 1) lb on true
         ) t order by player_tag, battle_time`,
        [members.map((m) => m.player_tag)],
      ),
    );
    const byTag = new Map();
    const learnedAt = new Map();
    for (const r of times) {
      if (!byTag.has(r.player_tag)) byTag.set(r.player_tag, []);
      byTag.get(r.player_tag).push(r.battle_time.getTime());
      learnedAt.set(
        `${r.player_tag}|${r.battle_time.getTime()}`,
        r.learned_at?.getTime() ?? null,
      );
    }
    for (const m of members) {
      const t = byTag.get(m.player_tag) ?? [];
      // Gaps start at each battle; the last one runs to `to`.
      for (let i = 0; i < t.length; i += 1) {
        const start = t[i];
        const end = i + 1 < t.length ? t[i + 1] : toMs;
        const open = i + 1 === t.length;
        // A return is the battle that closes a long gap, observed when
        // the record learned it (Gym #272: a return whose absence began
        // inside the window was missed).
        const learnedMs = open ? null : learnedAt.get(`${m.player_tag}|${end}`);
        if (
          !open &&
          end - start >= RETURN_AFTER_DAYS * DAY_MS &&
          (learnedMs ?? end) > fromMs &&
          (learnedMs ?? end) <= toMs
        )
          returns.push({
            tag: m.player_tag,
            name: m.name,
            after_days: Math.floor((end - start) / DAY_MS),
            at: iso(end),
            observed_at: iso(learnedMs ?? end),
          });
        for (const rung of QUIET_RUNGS_DAYS) {
          const atMs = start + rung * DAY_MS;
          // (from, to]: an open gap ends AT `to`, so a crossing there is
          // in this window (Gym #318: it was in neither window and paging
          // lost it); a closed gap ends at the battle that ended it.
          if (
            atMs <= fromMs ||
            atMs > toMs ||
            (open ? atMs > end : atMs >= end)
          )
            continue;
          // Never while the silence is ours (the gap still open and the
          // record not polling the member).
          // days_since_poll is today's, so it speaks only for a window
          // ending near now (a past window's crossings are the record's:
          // the older-items read lost two, Gym #274).
          if (
            open &&
            toMs >= Date.now() - DAY_MS &&
            m.days_since_poll !== null &&
            m.days_since_poll >= rung
          )
            continue;
          crossings.push({
            tag: m.player_tag,
            name: m.name,
            role: m.role,
            rung,
            // The member's poll lag rides along, as on every crossing (#163).
            days_since_poll: m.days_since_poll,
            at: iso(atMs),
          });
        }
      }
    }
  }
  const memberName = new Map(members.map((m) => [m.player_tag, m.name]));
  // Strongest crossing first: the highest rung index, then trophies moved.
  const strength = (sess) =>
    Math.max(
      ...sess.crossed.map((label) => {
        const [key, rung] = label.split(">=");
        return SESSION_RUNGS[key].indexOf(Number(rung));
      }),
    );
  standoutSessions.sort(
    (a, b) =>
      strength(b) - strength(a) ||
      Math.abs(b.trophy_net) - Math.abs(a.trophy_net),
  );
  const sessionStandouts = standoutSessions.map((sess) => ({
    tag: sess.player_tag,
    name: memberName.get(sess.player_tag) ?? null,
    ...sessionFacts(sess),
    crossed: sess.crossed,
  }));
  // Returns come from the battle gaps below (Gym #272), which also see
  // a return whose absence began inside the window.
  // Standouts, bounded and named.
  const { rows: most } = !learnedRecent
    ? { rows: [] }
    : await timed(perf, "clan.most", () =>
        db.query(
          `select bp.player_tag, p.name, count(distinct bp.battle_id)::int as battles
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id
       join player p on p.player_tag = bp.player_tag
      where bp.clan_tag = $1
        and bp.battle_time >= ${ts(fromMs - DAY_MS)} and bp.battle_time < ${ts(toMs + 1)}
        and b.created_at >= ${ts(fromMs + 1)} and b.created_at < ${ts(toMs + 1)}
        and b.battle_time >= b.created_at - interval '1 day'
      group by bp.player_tag, p.name
      order by battles desc, p.name nulls last limit $2`,
          [tag, STANDOUT_CAP],
        ),
      );
  // Member moments from the ledger: named, bounded.
  const { rows: momentRows } = await timed(perf, "clan.moments", () =>
    db.query(
      `select ${PLAYER_EVENT_COLUMNS.replaceAll(/(^|, )/g, "$1pe.")}, p.name
       from player_event pe
       join clan_membership cm on cm.player_tag = pe.player_tag
        and cm.clan_tag = $1 and cm.left_observed_at is null
       join player p on p.player_tag = pe.player_tag
      where pe.event_type = any($2::text[])
        and pe.window_end >= ${ts(fromMs + 1)} and pe.window_end < ${ts(toMs + 1)}
      order by pe.event_id`,
      [tag, PLAYER_MOMENT_KINDS],
    ),
  );
  // The same moment written twice in the ledger is one moment in the
  // entry too, as in the items (Gym #250: "Aaqib Javed -> Master 2"
  // twice in the standouts and the summary while the items said it once).
  const moments = (await hydratePlayerEvents(db, momentRows)).filter(
    ((seen) => (m) => {
      const key = `${m.player_tag}|${m.event_type}|${JSON.stringify(m.payload ?? null)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })(new Set()),
  );
  const arenaNames = await arenaNamesFor(
    db,
    moments
      .filter((m) => m.event_type === "arena_changed")
      .flatMap((m) => [m.payload.from, m.payload.to]),
  );
  const pick = (kind, map) =>
    moments
      .filter((m) => m.event_type === kind)
      .map((m) => ({ tag: m.player_tag, name: m.name, ...map(m.payload) }));
  const newBests = pick("best_trophies_band", (p) => ({ best: p.best }));
  newBests.sort((x, y) => y.best - x.best);
  const arenaPromotions = pick("arena_changed", (p) => ({
    arena: p.to_name ?? arenaNames.get(p.to) ?? null,
    ...(p.promoted_by
      ? {
          over:
            p.promoted_by.opponent?.name ??
            p.promoted_by.opponent?.player_tag ??
            null,
          score: `${p.promoted_by.crowns}-${p.promoted_by.crowns_against}`,
        }
      : {}),
  }));
  const rankedPromotions = pick("ranked_promotion", (p) => ({
    league: leagueName(p.to),
    ...(p.promoted_by
      ? {
          over:
            p.promoted_by.opponent?.name ??
            p.promoted_by.opponent?.player_tag ??
            null,
          score: `${p.promoted_by.crowns}-${p.promoted_by.crowns_against}`,
        }
      : {}),
  }));
  const collectionSteps = pick("collection_level_step", (p) => ({
    level: p.level,
  }));
  const badgeCounts = new Map();
  for (const m of moments) {
    if (
      m.event_type !== "badge_earned" &&
      m.event_type !== "legendary_badge_earned"
    )
      continue;
    const cur = badgeCounts.get(m.player_tag) ?? {
      tag: m.player_tag,
      name: m.name,
      count: 0,
      names: [],
    };
    cur.count += 1;
    if (cur.names.length < 3) cur.names.push(m.payload.name);
    badgeCounts.set(m.player_tag, cur);
  }
  const badges = [...badgeCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, STANDOUT_CAP);

  const { rows: don } = await timed(perf, "clan.donations", () =>
    db.query(
      // The members AT the window's end (Gym #216: a past week summed
      // today's roster, 8,977 where the week's 47 members gave 9,094; the
      // 117 was a member who left three days after the week closed).
      `with m as (select distinct player_tag from clan_membership
                 where clan_tag = $1 and joined_observed_at < ${ts(toMs + 1)}
                   and (left_observed_at is null or left_observed_at > ${ts(toMs)})),
     -- The week's donations are the highest counter value seen in its
     -- game days (Monday 10:00Z on; Jamie, 2026-09-23), not the latest
     -- read, which after the weekly reset is the new week's.
     latest as (select s.player_tag, max(s.donations)::int as donations
                  from player_snapshot_daily s join m on m.player_tag = s.player_tag
                 where s.observed_at < ${ts(toMs + 1)}
                   -- The game week the window ends in, read from its last
                   -- instant before to: a window ending on the Monday 10:00Z
                   -- boundary is the week that just closed (Gym #165).
                   and s.snapshot_date >= date_trunc('week', game_day(${ts(toMs - 1)}))::date
                   and s.snapshot_kind in ('daily', 'pre_reset')
                 group by s.player_tag)
     select coalesce(sum(latest.donations), 0)::int as total,
            count(*)::int as counted,
            (select json_build_object('tag', l.player_tag, 'name', p.name, 'given', l.donations)
               from latest l join player p on p.player_tag = l.player_tag
              order by l.donations desc nulls last limit 1) as leader
       from latest`,
      [tag],
    ),
  );

  // Battles PLAYED in the window that the record learned only after it
  // (a history backfill, a late poll): activity counts what the window
  // learned, so a backfilled week read "0 battles by 0 of 48 members"
  // where clans_standings, which counts by play time, had 3,547 (Gym #248).
  const { rows: laterRows } = comprehensive
    ? await timed(perf, "clan.learned_later", () =>
        db.query(
          `select count(distinct b.battle_id)::int as n
             from battle_participant bp join battle b on b.battle_id = bp.battle_id
            where bp.clan_tag = $1
              and bp.battle_time >= ${ts(fromMs + 1)} and bp.battle_time < ${ts(toMs + 1)}
              and b.created_at >= ${ts(toMs + 1)}`,
          [tag],
        ),
      )
    : { rows: [] };
  const learnedLater = laterRows[0]?.n ?? 0;
  const entry = {
    kind: "clan_activity",
    subject_tag: tag,
    name,
    scope,
    window: { from: iso(fromMs), to: iso(toMs) },
    summary: null,
    activity: comprehensive
      ? {
          battles: distinctBattles.size,
          members_active: byPlayer.size,
          members_total: sizeTo,
          sessions: sessionsTotal,
          by_mode: byMode,
          late_captures: lateCount,
          played_here_learned_later: learnedLater,
          // Counted above because the record learned them here, though
          // they were played (within a day) before the window opened (Gym
          // #259: 39 battles said, 33 played in the window).
          learned_here_played_before: memberBattles.filter(
            (r) => r.battle_time.getTime() <= fromMs,
          ).length,
          basis: "recorded",
        }
      : {
          battles: null,
          members_active: null,
          members_total: sizeTo,
          sessions: null,
          by_mode: null,
          late_captures: null,
          basis:
            "activity scope records roster and war only; member battles are not recorded for this clan",
        },
    // Newest first, like the timeline they sit beside (Jamie,
    // 2026-09-23): the ledger reads oldest first, and a busy week keeps
    // its latest twenty.
    roster: {
      joined: capList([...joined].reverse()),
      left: capList([...left].reverse()),
      role_changes: capList([...roleChanges].reverse()),
      bounced,
      size: { from: sizeFrom, to: sizeTo },
    },
    war,
    presence: comprehensive
      ? {
          quiet_crossed: capList(quietCrossed.map(({ at: _at, ...r }) => r)),
          // Every return the window's battle gaps hold, as the items say
          // (Gym #272: a return whose absence began inside the window was
          // missing from the entry). Newest first.
          returned: capList(
            [...returns]
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((r) => ({
                tag: r.tag,
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
          badges,
          sessions: capList(sessionStandouts, STANDOUT_CAP),
          session_rungs: SESSION_RUNGS,
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

  // Timeline items for this clan: the ledger, member moments (bounded),
  // and the derived presence moments.
  const items = [];
  const subject = { subject_tag: tag, subject_name: name };
  for (const e of ledger) {
    if (!CLAN_LEDGER_KINDS.includes(e.event_type)) continue;
    const warKind =
      e.event_type === "race_finished" ||
      e.event_type === "week_resolved" ||
      e.event_type === "bracket_observed";
    items.push({
      ...subject,
      at: iso(e.occurred_at ?? e.window_end),
      kind:
        e.event_type === "role_changed" ? "member_role_changed" : e.event_type,
      section: warKind ? "war" : "roster",
      facts: e.payload,
    });
  }
  const memberItems = moments
    .filter(
      (m) => m.event_type !== "badge_earned" || badgeItemWorthy(m.payload),
    )
    .map((m) => ({
      ...subject,
      at: iso(m.occurred_at ?? m.window_end),
      observed_at: iso(m.window_end),
      kind: m.event_type,
      section: "standouts",
      facts: {
        player_tag: m.player_tag,
        name: m.name,
        ...decorate(m.event_type, m.payload, arenaNames),
      },
    }));
  // Newest first before the cap (Jamie, 2026-09-23: the timeline is a
  // stream of what is new), so what a busy window drops is the oldest,
  // counted in `more`.
  memberItems.sort((a, b) => b.at.localeCompare(a.at));
  items.push(...memberItems.slice(0, MEMBER_MOMENTS_CAP));
  // A standout session is an item at the instant of the first rung this
  // window learned, observed when the record learned that battle. Every
  // standout is an item (Gym #164: five were served and the rest dropped
  // with has_more false); the timeline's own cap and cursor bound them.
  for (const sess of memberSessions)
    items.push({
      ...subject,
      // The member is who played it; the item stays on the clan's
      // timeline (Gym #265: the text named the clan as the player).
      subject_name: memberName.get(memberTag) ?? memberTag,
      at: sess.started_at,
      observed_at: sess.learned_at ?? sess.started_at,
      kind: "battle_session",
      section: "battles",
      facts: {
        player_tag: memberTag,
        name: memberName.get(memberTag) ?? null,
        ...sessionFacts(sess),
      },
    });
  for (const sess of standoutSessions)
    items.push({
      ...subject,
      at: iso(sess.newly[0].at),
      observed_at: iso(sess.newly[0].learnedAt),
      kind: "session_standout",
      section: "standouts",
      facts: {
        player_tag: sess.player_tag,
        name: memberName.get(sess.player_tag) ?? null,
        ...sessionFacts(sess),
        crossed: sess.crossed,
        newly: sess.newly.map((n) => n.label),
      },
    });
  if (comprehensive) {
    for (const q of crossings)
      items.push({
        ...subject,
        at: q.at,
        kind: "quiet_crossed",
        section: "presence",
        facts: {
          player_tag: q.tag,
          name: q.name,
          role: q.role,
          rung: q.rung,
          // At the crossing, as the player item (Gym #119).
          days_quiet: q.rung,
          days_since_poll: q.days_since_poll,
        },
      });
    for (const r of returns)
      items.push({
        ...subject,
        at: r.at,
        observed_at: r.observed_at,
        kind: "returned",
        section: "presence",
        facts: {
          player_tag: r.tag,
          name: r.name,
          after_days: r.after_days,
        },
      });
  }
  return {
    entry,
    items,
    more: Math.max(0, memberItems.length - MEMBER_MOMENTS_CAP),
    dropped: memberItems.slice(MEMBER_MOMENTS_CAP),
  };
}

/* ------------------------------------------------------------------ */
/* The timeline                                                        */
/* ------------------------------------------------------------------ */

async function accountItems(db, accountId, fromMs, toMs) {
  if (!accountId) return [];
  const { rows } = await db.query(
    `select kind, detail, created_at from account_event
      where account_id = $1 and created_at >= ${ts(fromMs + 1)} and created_at < ${ts(toMs + 1)}
      order by event_id`,
    [accountId],
  );
  return rows.map((r) => ({
    subject_tag: null,
    subject_name: "your account",
    at: iso(r.created_at),
    kind: `account_${r.kind}`,
    section: "account",
    facts: r.detail ?? {},
  }));
}

const ROLE_RANK_SQL = `max(case cm.role when 'leader' then 3 when 'coLeader' then 2
  when 'elder' then 1 else 0 end)`;

/**
 * Attested facts (9.2.0; Jamie, 2026-09-25): what a person did in a clan
 * through a family app, and what a family app's own game produced for a
 * player, held apart from the game record (attested_fact, 0178). Each is
 * shown only to the reader its type allows, decided here per reader:
 *
 *   - clan: the reader's (an agent's owner's) verified player is in the
 *     clan today;
 *   - leaders: a PERSON whose verified player leads it (leader or
 *     co-leader); never an agent, so a kick is never narrated;
 *   - player: the player is one of the reader's subjects.
 *
 * Only clan subjects carry clan facts, and nothing without a reader
 * (the clan mail's composition) carries any. Selected by when Elixir
 * recorded them, like every ledger item; `at` is when they happened.
 */
export async function factItems(db, subjects, { accountId, fromMs, toMs }) {
  if (!accountId) return [];
  const clanTags = subjects.filter((s) => s.kind === "clan").map((s) => s.tag);
  const playerTags = subjects
    .filter((s) => s.kind === "player")
    .map((s) => s.tag);
  if (!clanTags.length && !playerTags.length) return [];
  const { rows: who } = await db.query(
    `select kind, coalesce(owned_by_account_id, account_id) as seat_account
       from account where account_id = $1`,
    [accountId],
  );
  if (!who[0]) return [];
  const seats = clanTags.length
    ? (
        await db.query(
          `select cm.clan_tag, ${ROLE_RANK_SQL} as rank
             from claim c
             join clan_membership cm
               on cm.player_tag = c.player_tag and cm.left_observed_at is null
            where c.account_id = $1 and c.status = 'verified'
              and cm.clan_tag = any($2::text[])
            group by cm.clan_tag`,
          [who[0].seat_account, clanTags],
        )
      ).rows
    : [];
  const inClan = seats.map((r) => r.clan_tag);
  const leads =
    who[0].kind === "person"
      ? seats.filter((r) => r.rank >= 2).map((r) => r.clan_tag)
      : [];
  if (!inClan.length && !playerTags.length) return [];
  const { rows } = await db.query(
    `select f.*, cl.name as clan_name, p.name as player_name,
            ap.name as attester_name
       from attested_fact f
       left join clan cl on cl.clan_tag = f.clan_tag
       left join player p on p.player_tag = f.player_tag
       left join player ap on ap.player_tag = f.attester_tag
      where f.recorded_at >= ${ts(fromMs + 1)} and f.recorded_at < ${ts(toMs + 1)}
        and ((f.subject_kind = 'clan' and f.visibility = 'clan'
              and f.clan_tag = any($1::text[]))
          or (f.subject_kind = 'clan' and f.visibility = 'leaders'
              and f.clan_tag = any($2::text[]))
          or (f.subject_kind = 'player' and f.player_tag = any($3::text[])))
      order by f.recorded_at, f.fact_id`,
    [inClan, leads, playerTags],
  );
  const nicknames = new Map(
    subjects
      .filter((s) => s.kind === "player" && s.nickname)
      .map((s) => [s.tag, s.nickname]),
  );
  return rows.map((f) => {
    const clan = f.subject_kind === "clan";
    return {
      subject_tag: clan ? f.clan_tag : f.player_tag,
      subject_name: clan
        ? f.clan_name
        : (nicknames.get(f.player_tag) ?? f.player_name),
      at: iso(f.occurred_at),
      observed_at: iso(f.recorded_at),
      kind: f.fact_type,
      section: "attested",
      facts: {
        ...f.detail,
        ...(clan && f.player_tag
          ? { player_tag: f.player_tag, name: f.player_name }
          : {}),
        attested_by: {
          app: FAMILY_APP_NAMES[f.source] ?? f.source,
          player_tag: f.attester_tag,
          name: f.attester_name,
          role: f.attester_role,
        },
        visibility: f.visibility,
      },
    };
  });
}

/**
 * The timeline and its entries for a list of subjects over one window.
 * Player subjects with nothing to say are listed under `quiet` rather than
 * given an entry (§13.4); clan subjects always get one, because a clan's
 * silence is itself the clan's activity. Items are newest first, and
 * the cap keeps the newest.
 */
/** The timeline's cap. The timeline is a stream of what is new, read
 *  newest first by everyone (Jamie, 2026-09-23; contract 7.0.0), so a
 *  window past the cap keeps its newest items and the rest are counted,
 *  not paged: a reader catching up lands on the present. `items` is
 *  newest first. */
export function capTimeline(items) {
  return {
    kept: items.slice(0, TIMELINE_CAP),
    cut: items.slice(TIMELINE_CAP),
  };
}

export async function buildTimeline(
  db,
  subjects,
  {
    fromMs,
    toMs,
    timezone = "UTC",
    accountId = null,
    perf = null,
    filter = null,
    memberTag = null,
  },
) {
  const entries = [];
  const quiet = [];
  let items = [];
  let more = 0;
  // Every item a cap left out, so the caller can say where a reader must
  // continue from (Gym #120) and count only what its filters would show.
  const dropped = [];
  for (const s of subjects) {
    if (s.kind === "clan") {
      const built = await buildClanEntry(db, {
        tag: s.tag,
        scope: s.scope,
        fromMs,
        toMs,
        timezone,
        perf,
        memberTag,
      });
      entries.push(built.entry);
      items.push(...built.items);
      more += built.more;
      dropped.push(...(built.dropped ?? []));
      continue;
    }
    const built = await buildPlayerEntry(db, {
      tag: s.tag,
      relationship: s.relationship ?? null,
      nickname: s.nickname ?? null,
      fromMs,
      toMs,
      timezone,
      perf,
    });
    const e = built.entry;
    const said =
      e.battles.played > 0 ||
      e.notables.length > 0 ||
      e.clan.changes.length > 0 ||
      e.collection.unlocked.items.length > 0;
    if (said) {
      entries.push(e);
      items.push(...built.items);
    } else
      quiet.push({
        tag: e.subject_tag,
        name: e.name,
        nickname: e.nickname,
        relationship: e.relationship,
        days_quiet: e.presence.days_quiet,
        days_since_poll: e.presence.days_since_poll,
      });
  }
  items.push(...(await accountItems(db, accountId, fromMs, toMs)));
  items.push(...(await factItems(db, subjects, { accountId, fromMs, toMs })));
  items.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  // The same moment written twice (feedback #48, still in the 09-14
  // ledger rows, Gym #121): identical subject, kind and facts is one
  // moment, kept at its first instant. Nothing is deleted; the read
  // serves it once.
  // Every item says when the record observed it; an item that is not a
  // polled moment (a battle session, a join) was observed at its instant.
  for (const it of items) it.observed_at ??= it.at;
  // Roster moves are real repeats, never a duplicated row, unless they
  // share their instant (Gym #246: a same-day rejoin collapsed into the
  // first join, and the feed ended on "alex left").
  const ROSTER_KINDS = new Set([
    "member_joined",
    "member_left",
    "member_role_changed",
    "clan_joined",
    "clan_left",
    // A second absence at the same rung, or a second return, is a new
    // moment with the same facts (Gym #272).
    "quiet_crossed",
    "returned",
  ]);
  const seen = new Set();
  items = items.filter((it) => {
    const key = `${it.subject_tag}|${it.kind}|${ROSTER_KINDS.has(it.kind) ? it.at : ""}|${JSON.stringify(it.facts ?? null)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // The caller's filter (kinds, sections, a member) applies BEFORE the
  // cap (Gym #244: the cap counted items the filter then removed, so a
  // filtered reader got 18 of 50 items and a busy-window note).
  if (filter) items = items.filter(filter);
  // Deduplicated oldest first (a moment is kept at its first instant),
  // then served newest first.
  items.reverse();
  // The cap cuts in OBSERVED order, the order a window pages by (Gym
  // #317): cut by `at`, an item learned 17 h late was the oldest left
  // out, its observed_at became the boundary, and a continuation to that
  // instant held the same item and served nothing, forever. Display order
  // stays newest `at` first.
  const observed = (it) => Date.parse(it.observed_at ?? it.at);
  const { kept, cut } = capTimeline(
    [...items].sort((a, b) => observed(b) - observed(a)),
  );
  const keptSet = new Set(kept);
  more += cut.length;
  dropped.push(...cut);
  items = items.filter((it) => keptSet.has(it));
  for (const it of items) it.text = itemText(it, timezone);
  return {
    window: { from: iso(fromMs), to: iso(toMs) },
    timeline: items,
    timeline_more: more,
    timeline_dropped: dropped,
    entries,
    quiet,
  };
}

/** Entries only: the ops preview and the console read this shape. */
export async function buildEntries(db, subjects, opts) {
  const out = await buildTimeline(db, subjects, opts);
  return { window: out.window, entries: out.entries, quiet: out.quiet };
}
