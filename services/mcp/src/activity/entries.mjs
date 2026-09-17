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

import { MODE_GROUP_BY_TYPE } from "@elixir-mcp/contracts";
import { anchoredPeriod } from "../../../ingest/src/war-clock.mjs";
import { warBattlesSql, WAR_BATTLE_TYPES } from "../war-battles-sql.mjs";
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
const TIMELINE_CAP = 200;
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
      };
      sessions.push(cur);
    }
    cur.endMs = t;
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
    const g = MODE_GROUP_BY_TYPE[b.type] ?? "other";
    cur.by_mode[g] = (cur.by_mode[g] ?? 0) + 1;
    if (g === "ladder") cur.trophy_net += b.trophy_change ?? 0;
    for (const [key, rungs] of Object.entries(SESSION_RUNGS)) {
      const value = key === "trophy_net" ? Math.abs(cur.trophy_net) : cur[key];
      for (const rung of rungs) {
        const label = `${key}>=${rung}`;
        if (value >= rung && !cur.crossed.includes(label)) {
          cur.crossed.push(label);
          if (learned(b)) cur.newly.push({ label, at: t });
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
  }));
}

/** The wire shape of a session: the bookkeeping fields stay here. */
function sessionFacts({ crossed: _c, newly: _n, ...rest }) {
  return rest;
}

/* ------------------------------------------------------------------ */
/* Player entry                                                        */
/* ------------------------------------------------------------------ */

async function snapshotAt(db, tag, atMs) {
  const { rows } = await db.query(
    `select observed_at, trophies, best_trophies, arena_id,
            collection_level, wins, battle_count,
            donations,
            pol_league as league
       from player_snapshot_daily
      where player_tag = $1 and observed_at is not null
        and observed_at <= ${ts(atMs)}
      order by observed_at desc limit 1`,
    [tag],
  );
  return rows[0] ?? null;
}

async function playerLedger(db, tag, fromMs, toMs) {
  const { rows } = await db.query(
    `select event_id, event_type, window_end, occurred_at, payload
       from player_event
      where player_tag = $1 and window_end > ${ts(fromMs)} and window_end <= ${ts(toMs)}
      order by event_id`,
    [tag],
  );
  return rows;
}

/**
 * Battles the record learned in the window: the ones played within a day
 * of it come off the player-time index; anything admitted in the window
 * but played earlier is a late capture, counted by the created_at index
 * and never narrated.
 */
async function playerBattles(db, tag, fromMs, toMs) {
  const { rows } = await db.query(
    `select b.battle_id, b.type, b.battle_time, bp.outcome, bp.crowns,
            bp.trophy_change, bp.clan_tag
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id
      where bp.player_tag = $1
        and bp.battle_time >= ${ts(fromMs - DAY_MS)} and bp.battle_time <= ${ts(toMs)}
        and b.created_at > ${ts(fromMs)} and b.created_at <= ${ts(toMs)}
      order by b.battle_time`,
    [tag],
  );
  const { rows: late } = await db.query(
    `select count(*)::int as n
       from battle b
       join battle_participant bp on bp.battle_id = b.battle_id
      where b.created_at > ${ts(fromMs)} and b.created_at <= ${ts(toMs)}
        and b.battle_time < ${ts(fromMs - DAY_MS)}
        and bp.player_tag = $1`,
    [tag],
  );
  return { rows, late: late[0]?.n ?? 0 };
}

async function presenceOf(db, tag, played, fromMs, toMs) {
  const { rows: lastRows } = await db.query(
    `select max(bp.battle_time) as last_battle
       from battle_participant bp
      where bp.player_tag = $1 and bp.battle_time <= ${ts(toMs)}`,
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
    `select floor(extract(epoch from (${ts(toMs)} - last_admitted_at)) / 86400)::int
              as days_since_poll
       from poll_state where subject_tag = $1 and endpoint = 'player_battlelog'`,
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
  if (kind === "badge_earned" || kind === "legendary_badge_earned") {
    const { name, ...rest } = payload;
    return { badge: name, ...rest };
  }
  if (kind === "card_unlocked") {
    const { name, ...rest } = payload;
    return { card: name, ...rest };
  }
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
        and ((cm.joined_observed_at > ${ts(fromMs)} and cm.joined_observed_at <= ${ts(toMs)})
          or (cm.left_observed_at > ${ts(fromMs)} and cm.left_observed_at <= ${ts(toMs)}))
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
  const warBattles = played.filter((b) => MODE_GROUP_BY_TYPE[b.type] === "war");

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
    war: {
      battles: warBattles.length,
      days: [
        ...new Set(
          warBattles.map((b) => b.battle_time.toISOString().slice(0, 10)),
        ),
      ].length,
    },
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
      facts: {
        rung: presence.rungCrossed.rung,
        days_quiet: presence.days_quiet,
        days_since_poll: presence.days_since_poll,
      },
    });
  return { entry, items };
}

/* ------------------------------------------------------------------ */
/* Clan entry                                                          */
/* ------------------------------------------------------------------ */

export async function buildClanEntry(
  db,
  { tag, scope = "comprehensive", fromMs, toMs, timezone = "UTC", perf = null },
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
  const { rows: allBattles } = await timed(perf, "clan.member_battles", () =>
    db.query(
      `select bp.player_tag, bp.battle_id, b.type, b.battle_time, bp.outcome, bp.trophy_change,
              (b.created_at > ${ts(fromMs)} and b.created_at <= ${ts(toMs)}) as learned
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id
      where bp.clan_tag = $1
        and bp.battle_time >= ${ts(fromMs - DAY_MS)} and bp.battle_time <= ${ts(toMs)}
        and b.created_at <= ${ts(toMs)}
      order by bp.player_tag, b.battle_time`,
      [tag],
    ),
  );
  const memberBattles = allBattles.filter((r) => r.learned);
  const { rows: lateRows } = await timed(perf, "clan.late", () =>
    db.query(
      `select count(distinct b.battle_id)::int as n
         from battle b
         join battle_participant bp on bp.battle_id = b.battle_id
        where b.created_at > ${ts(fromMs)} and b.created_at <= ${ts(toMs)}
          and b.battle_time < ${ts(fromMs - DAY_MS)}
          and bp.clan_tag = $1`,
      [tag],
    ),
  );
  const lateCount = lateRows[0]?.n ?? 0;
  const distinctBattles = new Set();
  const byMode = {};
  const byPlayer = new Map();
  for (const r of memberBattles) {
    if (!distinctBattles.has(r.battle_id)) {
      distinctBattles.add(r.battle_id);
      const g = MODE_GROUP_BY_TYPE[r.type] ?? "other";
      byMode[g] = (byMode[g] ?? 0) + 1;
    }
    if (!byPlayer.has(r.player_tag)) byPlayer.set(r.player_tag, []);
    byPlayer.get(r.player_tag).push(r);
  }
  let sessionsTotal = 0;
  for (const rows of byPlayer.values())
    sessionsTotal += sessionsOf(rows, toMs).length;
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
  const { rows: ledger } = await timed(perf, "clan.ledger", () =>
    db.query(
      `select event_id, event_type, window_end, occurred_at, payload from clan_event
      where clan_tag = $1
        and window_end > ${ts(fromMs)} and window_end <= ${ts(toMs)}
      order by event_id`,
      [tag],
    ),
  );
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

  // War: the state at `to`.
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
        where clan_tag = $1 and first_observed_at <= ${ts(toMs)}
        order by first_observed_at desc limit 1`,
      [tag],
    );
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
      resolved,
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
             select wb.player_tag, count(distinct wb.battle_id)::int as n
               from (${warBattlesSql({ clan: "$1", season: "$2", section: "$3", warDay: "$4", types: "$5" })}) wb
              group by wb.player_tag),
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
          [
            tag,
            wk[0].season_id,
            wk[0].section_index,
            p.info.warDay,
            WAR_BATTLE_TYPES,
          ],
        );
        if (decks[0].participants > 0)
          war.decks = { as_of: iso(toMs), ...decks[0] };
      }
    }
  }

  // Presence: rung crossings inside the window, returns, never recorded.
  const { rows: members } = await timed(perf, "clan.members", () =>
    db.query(
      `select cm.player_tag, p.name, cm.role,
            (select max(bp.battle_time) from battle_participant bp
              where bp.player_tag = cm.player_tag and bp.battle_time <= ${ts(toMs)}) as last_battle,
            (select floor(extract(epoch from (${ts(toMs)} - ps.last_admitted_at)) / 86400)::int
               from poll_state ps
              where ps.subject_tag = cm.player_tag and ps.endpoint = 'player_battlelog')
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
  const { rows: returned } = await timed(perf, "clan.returned", () =>
    db.query(
      `with inwin as (
       select bp.player_tag, min(bp.battle_time) as first_in
         from battle_participant bp
         join battle b on b.battle_id = bp.battle_id
        where bp.clan_tag = $1
          and bp.battle_time >= ${ts(fromMs - DAY_MS)} and bp.battle_time <= ${ts(toMs)}
          and b.created_at > ${ts(fromMs)} and b.created_at <= ${ts(toMs)}
        group by bp.player_tag)
     select i.player_tag, p.name, i.first_in,
            floor(extract(epoch from (i.first_in - prior.t)) / 86400)::int as after_days
       from inwin i
       join player p on p.player_tag = i.player_tag
       join lateral (
         select max(bp2.battle_time) as t from battle_participant bp2
          where bp2.player_tag = i.player_tag and bp2.battle_time < i.first_in) prior on true
      where prior.t is not null
        and i.first_in - prior.t >= make_interval(days => $2)
      order by after_days desc`,
      [tag, RETURN_AFTER_DAYS],
    ),
  );

  // Standouts, bounded and named.
  const { rows: most } = await timed(perf, "clan.most", () =>
    db.query(
      `select bp.player_tag, p.name, count(distinct bp.battle_id)::int as battles
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id
       join player p on p.player_tag = bp.player_tag
      where bp.clan_tag = $1
        and bp.battle_time >= ${ts(fromMs - DAY_MS)} and bp.battle_time <= ${ts(toMs)}
        and b.created_at > ${ts(fromMs)} and b.created_at <= ${ts(toMs)}
      group by bp.player_tag, p.name
      order by battles desc, p.name nulls last limit $2`,
      [tag, STANDOUT_CAP],
    ),
  );
  // Member moments from the ledger: named, bounded.
  const { rows: moments } = await timed(perf, "clan.moments", () =>
    db.query(
      `select pe.event_id, pe.player_tag, p.name, pe.event_type, pe.window_end, pe.occurred_at, pe.payload
       from player_event pe
       join clan_membership cm on cm.player_tag = pe.player_tag
        and cm.clan_tag = $1 and cm.left_observed_at is null
       join player p on p.player_tag = pe.player_tag
      where pe.event_type = any($2::text[])
        and pe.window_end > ${ts(fromMs)} and pe.window_end <= ${ts(toMs)}
      order by pe.event_id`,
      [tag, PLAYER_MOMENT_KINDS],
    ),
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
      `with m as (select player_tag from clan_membership
                 where clan_tag = $1 and left_observed_at is null),
     latest as (select distinct on (s.player_tag) s.player_tag, s.donations
                  from player_snapshot_daily s join m on m.player_tag = s.player_tag
                 where s.observed_at <= ${ts(toMs)}
                   and s.observed_at >= date_trunc('week', ${ts(toMs)})
                 order by s.player_tag, s.observed_at desc)
     select coalesce(sum(latest.donations), 0)::int as total,
            count(*)::int as counted,
            (select json_build_object('tag', l.player_tag, 'name', p.name, 'given', l.donations)
               from latest l join player p on p.player_tag = l.player_tag
              order by l.donations desc nulls last limit 1) as leader
       from latest`,
      [tag],
    ),
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
          battles: distinctBattles.size,
          members_active: byPlayer.size,
          members_total: sizeTo,
          sessions: sessionsTotal,
          by_mode: byMode,
          late_captures: lateCount,
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
          quiet_crossed: capList(quietCrossed.map(({ at: _at, ...r }) => r)),
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
      kind: m.event_type,
      section: "standouts",
      facts: {
        player_tag: m.player_tag,
        name: m.name,
        ...decorate(m.event_type, m.payload, arenaNames),
      },
    }));
  items.push(...memberItems.slice(0, MEMBER_MOMENTS_CAP));
  // A standout session is an item at the instant of the first rung this
  // window learned; the cap keeps a busy clan to its five strongest.
  for (const sess of standoutSessions.slice(0, STANDOUT_CAP))
    items.push({
      ...subject,
      at: iso(sess.newly[0].at),
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
    for (const q of quietCrossed)
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
          days_quiet: q.days_quiet,
          days_since_poll: q.days_since_poll,
        },
      });
    for (const r of returned)
      items.push({
        ...subject,
        at: iso(r.first_in),
        kind: "returned",
        section: "presence",
        facts: {
          player_tag: r.player_tag,
          name: r.name,
          after_days: r.after_days,
        },
      });
  }
  return {
    entry,
    items,
    more: Math.max(0, memberItems.length - MEMBER_MOMENTS_CAP),
  };
}

/* ------------------------------------------------------------------ */
/* The timeline                                                        */
/* ------------------------------------------------------------------ */

async function accountItems(db, accountId, fromMs, toMs) {
  if (!accountId) return [];
  const { rows } = await db.query(
    `select kind, detail, created_at from account_event
      where account_id = $1 and created_at > ${ts(fromMs)} and created_at <= ${ts(toMs)}
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

/**
 * The timeline and its entries for a list of subjects over one window.
 * Player subjects with nothing to say are listed under `quiet` rather than
 * given an entry (§13.4); clan subjects always get one, because a clan's
 * silence is itself the clan's activity. Items are oldest first, capped.
 */
export async function buildTimeline(
  db,
  subjects,
  { fromMs, toMs, timezone = "UTC", accountId = null, perf = null },
) {
  const entries = [];
  const quiet = [];
  let items = [];
  let more = 0;
  for (const s of subjects) {
    if (s.kind === "clan") {
      const built = await buildClanEntry(db, {
        tag: s.tag,
        scope: s.scope,
        fromMs,
        toMs,
        timezone,
        perf,
      });
      entries.push(built.entry);
      items.push(...built.items);
      more += built.more;
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
  items.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  if (items.length > TIMELINE_CAP) {
    more += items.length - TIMELINE_CAP;
    items = items.slice(0, TIMELINE_CAP);
  }
  for (const it of items) it.text = itemText(it, timezone);
  return {
    window: { from: iso(fromMs), to: iso(toMs) },
    timeline: items,
    timeline_more: more,
    entries,
    quiet,
  };
}

/** Entries only: the ops preview and the console read this shape. */
export async function buildEntries(db, subjects, opts) {
  const out = await buildTimeline(db, subjects, opts);
  return { window: out.window, entries: out.entries, quiet: out.quiet };
}
