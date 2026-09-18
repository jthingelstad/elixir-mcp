import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { projectRiverRaceLog } from "../../ingest/src/war.mjs";
import { ingestClanRoster } from "../../ingest/src/roster.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";
import { refreshDailyRollups } from "../../ingest/src/rollups.mjs";
import { periodAt } from "../src/war-period.mjs";

/** The (player, UTC day) pairs of hand-seeded battles, as ingest would
 *  hand them to the rollup. */
async function rollupPairs(db, like) {
  const { rows } = await db.query(
    `select distinct bp.player_tag, to_char(bp.battle_time at time zone 'UTC', 'YYYY-MM-DD') as day
     from battle_participant bp where bp.battle_id like $1`,
    [like],
  );
  return rows.map((r) => ({ playerTag: r.player_tag, day: r.day }));
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_wartools_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const CLAN = "#J2RGCRVG";

let db;
let invoke; // as alice, a plain member
let invokeOutsider;

async function fixture(rel) {
  return JSON.parse(
    await readFile(path.join(repoRoot, "fixtures", rel), "utf8"),
  );
}

async function call(fn, name, args = {}) {
  const { body, isError } = await fn(name, args);
  return { body, isError };
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: DB_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  await db.query(`insert into clan (clan_tag) values ($1)`, [CLAN]);

  // Owner + clan recording; roster from the real fixture; war history from
  // the real riverracelog.
  const {
    rows: [owner],
  } = await db.query(
    `insert into account (email_hash, status, is_owner) values ('wt-owner', 'approved', true) returning account_id`,
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, scope) values ('clan', $1, $2, 'comprehensive')`,
    [CLAN, owner.account_id],
  );
  const roster = await fixture("clan/roster.json");
  await ingestClanRoster(db, {
    payload: roster,
    observedAt: "2026-09-03T14:40:34Z",
  });
  const log = await fixture("riverracelog/log.json");
  await projectRiverRaceLog(db, { clanTag: CLAN, payload: log });

  // Alice claims a real roster member tag.
  const aliceTag = roster.memberList[0].tag;
  const {
    rows: [alice],
  } = await db.query(
    `insert into account (email_hash, status) values ('wt-alice', 'approved') returning account_id, is_owner`,
  );
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary) values ($1, $2, 'unverified', true)`,
    [alice.account_id, aliceTag],
  );
  const registry = makeRegistry();
  invoke = makeInvoker({
    db,
    account: {
      accountId: alice.account_id,
      isOwner: false,
      timezone: "America/Chicago",
    },
    registry,
  });
  const {
    rows: [out],
  } = await db.query(
    `insert into account (email_hash, status) values ('wt-out', 'approved') returning account_id`,
  );
  invokeOutsider = makeInvoker({
    db,
    account: { accountId: out.account_id, isOwner: false, timezone: null },
    registry,
  });
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("clans_roster: roster with roles, snapshots slots, membership tenure", async () => {
  const { body, isError } = await call(invoke, "clans_roster", {});
  assert.equal(isError, false);
  assert.equal(body.clan_tag, CLAN);
  assert.equal(body.member_count, 49);
  const leader = body.members.find((m) => m.role === "leader");
  assert.ok(leader, "leader present from roster");
  assert.ok(
    body.members.every((m) => m.first_observed_in_clan),
    "observed tenure on every member",
  );
});

test("war_current: latest recorded week with standings, points, note", async () => {
  const { body, isError } = await call(invoke, "war_current", {});
  assert.equal(isError, false);
  assert.equal(body.season_id, 134, "latest week in the log fixture");
  assert.ok(body.standings.length >= 5);
  assert.ok(body.standings.every((s) => typeof s.fame === "number"));
  assert.ok(
    body.standings.every(
      (s) =>
        Object.hasOwn(s, "period_points") &&
        (s.period_points === null || typeof s.period_points === "number"),
    ),
    "current-day points are exposed separately; finished-log-only rows stay unknown",
  );
  assert.ok(body.participants.length > 10);
  assert.ok(
    body.participants.every((p) => typeof p.in_clan === "boolean"),
    "every participant carries in_clan",
  );
  assert.match(body.notes.join(" "), /points are per-member/);
  assert.match(body.notes.join(" "), /banked at the day close/);
});

test("war_history: ranks per week and one member focus with attendance", async () => {
  const { body } = await call(invoke, "war_history", { seasons: 3 });
  assert.ok(body.weeks.length >= 9, "the log fixture spans ten weeks");
  assert.ok(body.weeks.every((w) => w.our_rank >= 1 && w.our_rank <= 5));

  const closed = body.weeks.find((week) => !week.in_progress);
  const allMembers = await call(invoke, "war_history", {
    season_id: closed.season_id,
    section_index: closed.section_index,
  });
  assert.equal(allMembers.isError, false, JSON.stringify(allMembers.body));
  assert.equal(allMembers.body.weeks.length, 1, "exact week means one week");
  assert.ok(
    allMembers.body.member_weeks.length > 1,
    "one closed-week call returns every recorded member",
  );
  assert.ok(
    allMembers.body.member_weeks.every(
      (week) =>
        typeof week.player_tag === "string" && Object.hasOwn(week, "war_days"),
    ),
    "each member row is identified and carries the day indices when known",
  );
  const halfExact = await call(invoke, "war_history", {
    season_id: closed.season_id,
  });
  assert.equal(halfExact.isError, true);
  assert.equal(halfExact.body.error.code, "bad_request");
  // A member with points across MORE than one season, so the seasons
  // window has something to narrow.
  const focusTag = (
    await db.query(
      `select player_tag from war_participation where clan_tag = $1 and points > 0
       group by player_tag having count(distinct season_id) > 1 limit 1`,
      [CLAN],
    )
  ).rows[0].player_tag;
  // focus member must be a current open member for entitlement; add if missing
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
     select $1, $2, now(), 'member'
     where not exists (select 1 from clan_membership where player_tag = $2 and left_observed_at is null)`,
    [CLAN, focusTag],
  );
  const focused = await call(invoke, "war_history", {
    player_tag: focusTag,
    seasons: 3,
  });
  assert.equal(focused.isError, false, JSON.stringify(focused.body));
  assert.ok(focused.body.member_weeks.length > 0);
  // The log fixture carries NO per-day attendance (it comes from daily
  // currentriverrace polls), so war_days_battled must be null — unknown,
  // never a false zero.
  assert.ok(
    focused.body.member_weeks.every(
      (w) => typeof w.points === "number" && w.war_days_battled === null,
    ),
  );

  // Give one week attendance coverage: that week turns numeric, others stay null.
  const wk = focused.body.member_weeks[0];
  await db.query(
    `insert into war_attendance_day
       (clan_tag, season_id, section_index, war_day, player_tag, decks_used_today)
     values ($1, $2, $3, 0, $4, 4)`,
    [CLAN, wk.season_id, wk.section_index, focusTag],
  );
  const covered = await call(invoke, "war_history", {
    player_tag: focusTag,
    seasons: 3,
  });
  const cw = covered.body.member_weeks.find(
    (w) => w.season_id === wk.season_id && w.section_index === wk.section_index,
  );
  assert.equal(cw.war_days_battled, 1, "covered week counts battled days");
  assert.ok(
    covered.body.member_weeks
      .filter((w) => w !== cw)
      .every((w) => w.war_days_battled === null),
    "uncovered weeks stay null",
  );

  // seasons scopes member_weeks the same as weeks (round-2 finding: it
  // ignored the arg entirely).
  const one = await call(invoke, "war_history", {
    player_tag: focusTag,
    seasons: 1,
  });
  const maxSeason = Math.max(...focused.body.weeks.map((w) => w.season_id));
  assert.ok(
    one.body.member_weeks.every((w) => w.season_id === maxSeason),
    "seasons=1 keeps only the latest season's member weeks",
  );
  assert.ok(
    one.body.member_weeks.length < focused.body.member_weeks.length,
    "narrower window returns fewer member weeks",
  );
});

test("war_history exact week: a 50-participant roster answers in one pass, attendance from both sources (defect 1, 2026-09-19)", async () => {
  // Season 132 section 3 is the fixture's oldest week and no other test
  // touches it. Fifty synthetic participants: the first ten battled on
  // day 2 by a decksUsedToday poll, the next ten by a recorded war battle
  // on day 3, one did both, the rest have no observed day.
  const season = 132;
  const section = 3;
  // Tags are CR tags: the alphabet is 0289PYLQGRJCUV.
  const alphabet = "0289PYLQGR";
  const tags = Array.from(
    { length: 50 },
    (_, i) => `#YV${alphabet[Math.floor(i / 10)]}${alphabet[i % 10]}Y`,
  );
  assert.equal(new Set(tags).size, 50);
  for (const tag of tags) {
    await db.query(
      "insert into player (player_tag, name) values ($1, $2) on conflict do nothing",
      [tag, `Fifty ${tag.slice(-2)}`],
    );
    await db.query(
      `insert into war_participation (clan_tag, season_id, section_index, player_tag, points, decks_used)
       values ($1, $2, $3, $4, $5, 4) on conflict do nothing`,
      [CLAN, season, section, tag, 100000 + tags.indexOf(tag)],
    );
  }
  for (const tag of tags.slice(0, 10))
    await db.query(
      `insert into war_attendance_day (clan_tag, season_id, section_index, war_day, player_tag, decks_used_today)
       values ($1, $2, $3, 2, $4, 4)`,
      [CLAN, season, section, tag],
    );
  const {
    rows: [day3],
  } = await db.query(
    `select starts_at from war_period where war_season_id = $1 and section_index = $2 and war_day = 3`,
    [season, section],
  );
  const at = new Date(day3.starts_at.getTime() + 3600_000);
  for (const tag of [...tags.slice(10, 20), tags[0]]) {
    const id = `fifty-${tag.slice(1)}`;
    await db.query(
      "insert into battle (battle_id, battle_time, type, type_class) values ($1, $2, 'riverRacePvP', 'pvp')",
      [id, at],
    );
    await db.query(
      `insert into battle_participant (battle_id, player_tag, battle_time, side, clan_tag, type, type_class)
       values ($1, $2, $3, 0, $4, 'riverRacePvP', 'pvp')`,
      [id, tag, at, CLAN],
    );
  }
  const started = Date.now();
  const { body, isError } = await call(invoke, "war_history", {
    season_id: season,
    section_index: section,
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.ok(Date.now() - started < 5000, "well inside the query budget");
  const mine = body.member_weeks.filter((w) => tags.includes(w.player_tag));
  assert.equal(mine.length, 50, "every participant, not the old 40-row cap");
  assert.ok(body.member_weeks.length <= 60, "the exact-week cap is 60");
  const byTag = new Map(mine.map((w) => [w.player_tag, w]));
  assert.deepEqual(byTag.get(tags[0]).war_days, [2, 3], "poll AND battle");
  assert.equal(byTag.get(tags[0]).war_days_battled, 2);
  assert.deepEqual(byTag.get(tags[5]).war_days, [2], "poll only");
  assert.deepEqual(byTag.get(tags[15]).war_days, [3], "battle only");
  assert.equal(byTag.get(tags[40]).war_days_battled, 0, "covered week, no day");
  assert.deepEqual(byTag.get(tags[40]).war_days, []);
  assert.ok(
    mine.every((w) => w.war_days_battled !== null),
    "a covered week is never null",
  );
});

test("battles_compare: two clanmates side by side", async () => {
  const roster = await fixture("clan/roster.json");
  const { body, isError } = await call(invoke, "battles_compare", {
    player_tags: [roster.memberList[0].tag, roster.memberList[1].tag],
  });
  assert.equal(isError, false);
  assert.equal(body.players.length, 2);
  assert.ok(body.players.every((p) => p.window));
});

test("entitlements hold: outsiders get structured refusals on every clan tool", async () => {
  for (const name of ["clans_roster", "war_current", "war_history"]) {
    const { body, isError } = await call(invokeOutsider, name, {});
    assert.equal(isError, true, name);
    assert.equal(body.error.code, "no_subject", name);
  }
  // Universal reads: comparing arbitrary tags now resolves (empty
  // records serve honestly rather than refusing).
  const cmp = await call(invokeOutsider, "battles_compare", {
    player_tags: ["#YYYYYYYY", "#RRRRRRRR"],
  });
  assert.equal(cmp.isError, false, JSON.stringify(cmp.body));
  assert.equal(cmp.body.players.length, 2);
});

test("war_current: the period is the calendar's; the anchor only says when this clan first saw it", async () => {
  await db.query("begin");
  try {
    const now = await periodAt(db, Date.now());
    assert.ok(now, "the calendar covers today (0104 seed + scheduler)");
    // A stale anchor for some old period blanks nothing: the day is the
    // calendar's and the sighting is null.
    await db.query("delete from war_period_anchor where clan_tag=$1", [CLAN]);
    await db.query(
      `insert into war_period_anchor (clan_tag,period_index,first_observed_at)
      values ($1,$2,now()-interval '9 days')`,
      [CLAN, (now.periodIndex + 20) % 35],
    );
    await db.query(
      `insert into poll_state (subject_tag,endpoint,last_admitted_at)
      values ($1,'currentriverrace',now()-interval '3 hours')
      on conflict (subject_tag,endpoint) do update set last_admitted_at=excluded.last_admitted_at`,
      [CLAN],
    );
    const stale = await call(invoke, "war_current", { clan_tag: CLAN });
    assert.equal(stale.isError, false, JSON.stringify(stale.body));
    assert.equal(stale.body.period.period_index, now.periodIndex);
    assert.equal(stale.body.period.kind, now.kind);
    assert.equal(
      stale.body.period.started_observed_at,
      null,
      "not seen open by this clan",
    );
    assert.equal(stale.body.period.observed_offset_minutes, null);
    assert.ok(
      stale.body.period.freshness_seconds >= 10800,
      "the poll age is its own field",
    );
    assert.equal(stale.body.period.nominal_period_elapsed, false);
    assert.equal(
      stale.body.period.period_start_nominal,
      new Date(now.startMs).toISOString(),
    );
    assert.equal(stale.body.meta.completeness_note, undefined);
    // A sighting of THIS period rides beside the calendar's bounds.
    const seenAt = new Date(now.startMs + 7 * 60_000);
    await db.query(
      `update war_period_anchor set period_index=$2, first_observed_at=$3 where clan_tag=$1`,
      [CLAN, now.periodIndex, seenAt],
    );
    await db.query(
      `update poll_state set last_admitted_at=now() where subject_tag=$1 and endpoint='currentriverrace'`,
      [CLAN],
    );
    const fresh = await call(invoke, "war_current", { clan_tag: CLAN });
    assert.equal(fresh.body.period.period_index, now.periodIndex);
    assert.equal(fresh.body.period.started_observed_at, seenAt.toISOString());
    assert.equal(fresh.body.period.observed_offset_minutes, 7);
    assert.equal(fresh.body.period.freshness_seconds, 0);
  } finally {
    await db.query("rollback");
  }
});

test("war_current: decks_today names untouched/partial/finished on a live war day", async () => {
  // The day is the calendar's (war_period), not an anchor's: on a
  // training day the tool answers decks_today null with its reason and
  // this test asserts that; on a war day it asserts the bucket
  // arithmetic. The clan timeline's test covers both at fixed instants.
  const today = await periodAt(db, Date.now());
  if (!today.warDay) {
    const { body } = await call(invoke, "war_current", {});
    assert.equal(body.decks_today, null);
    assert.equal(body.decks_today_reason, "training_day");
    return;
  }
  const wk = (
    await db.query(
      `select season_id, section_index from war_week where clan_tag = $1
       order by season_id desc, section_index desc limit 1`,
      [CLAN],
    )
  ).rows[0];
  const members = (
    await db.query(
      `select wp.player_tag from war_participation wp
       where wp.clan_tag = $1 and wp.season_id = $2 and wp.section_index = $3
         and exists (select 1 from clan_membership cm
                     where cm.clan_tag = $1 and cm.player_tag = wp.player_tag
                       and cm.left_observed_at is null)
       order by wp.player_tag limit 2`,
      [CLAN, wk.season_id, wk.section_index],
    )
  ).rows.map((r) => r.player_tag);
  assert.equal(members.length, 2, "two current members in the race roster");
  const [partialTag, finishedTag] = members;
  await db.query(
    `insert into war_attendance_day
       (clan_tag, season_id, section_index, war_day, player_tag, decks_used_today)
     values ($1, $2, $3, $6, $4, 2), ($1, $2, $3, $6, $5, 4)
     on conflict do nothing`,
    [
      CLAN,
      wk.season_id,
      wk.section_index,
      partialTag,
      finishedTag,
      today.warDay,
    ],
  );

  const { body, isError } = await call(invoke, "war_current", {});
  assert.equal(isError, false, JSON.stringify(body));
  assert.equal(body.period.war_day, today.warDay);
  const dt = body.decks_today;
  assert.ok(dt, "live war day carries decks_today");
  assert.equal(dt.war_day, today.warDay);
  const partial = dt.partial.find((m) => m.player_tag === partialTag);
  assert.ok(partial && partial.decks_used === 2, "2 decks -> partial");
  assert.ok(
    dt.finished.some((m) => m.player_tag === finishedTag),
    "4 decks -> finished",
  );
  assert.ok(
    dt.untouched.every((m) => m.decks_used === 0),
    "untouched means zero observed decks",
  );
  assert.equal(
    dt.counts.untouched + dt.counts.partial + dt.counts.finished,
    dt.counts.participants,
    "buckets partition the day's roster",
  );
  assert.match(body.notes.join(" "), /observed so far/);
});

test("the registry declares 55 tools, every one classified and annotated", () => {
  const decls = makeRegistry().declarations();
  assert.equal(decls.length, 55);
  for (const d of decls) {
    assert.ok(d.annotations, `${d.name} has annotations`);
    assert.match(
      d.annotations.title,
      /^[A-Za-z ]+ · .+$/,
      `${d.name} title carries its group`,
    );
    assert.equal(typeof d.annotations.readOnlyHint, "boolean", d.name);
  }
  const writers = decls.filter((d) => d.annotations.readOnlyHint === false);
  assert.deepEqual(
    writers.map((d) => d.name).sort(),
    [
      // Curation of a collection YOU OWN is the one write outside the
      // service domain: a collection is a domain resource, and editing
      // one is editing the domain, not administering the service.
      // Recorded game history stays read-only to every tool here - the
      // recording pipeline is the only writer of facts.
      "collections_edit",
      "elixir_feedback",
      "elixir_identify",
      "elixir_nickname",
      "elixir_track_clan",
      "elixir_track_player",
    ],
    "writes are service-domain, plus curating your own collections",
  );
  const open = decls.filter((d) => d.annotations.openWorldHint === true);
  assert.deepEqual(
    open.map((d) => d.name).sort(),
    [
      "battles_query",
      "clans_roster",
      "live_fetch",
      "players_profile",
      "rankings_clan_ladder",
      "rankings_clans",
      "rankings_players",
      "war_current",
    ],
    "the raw lane and the seven tools with a live flag reach outside the corpus",
  );
});

test("round-3: seasons range refused loudly; attendance unions recorded battles", async () => {
  const thirteen = await call(invoke, "war_history", { seasons: 13 });
  assert.equal(thirteen.isError, true);
  assert.equal(thirteen.body.error.code, "bad_request");

  // A recorded war battle proves attendance even with NO decksUsedToday
  // poll observation (sparse polls undercount — round-3 cross-check).
  const wk = (
    await db.query(
      `select season_id, section_index from war_week where clan_tag = $1
       order by season_id desc, section_index desc limit 1`,
      [CLAN],
    )
  ).rows[0];
  const member = (
    await db.query(
      `select player_tag from war_participation
       where clan_tag = $1 and season_id = $2 and section_index = $3 limit 1`,
      [CLAN, wk.season_id, wk.section_index],
    )
  ).rows[0].player_tag;
  // Nothing is stamped (0105): the battle's day is where its time falls
  // on the calendar, so it is placed an hour into the week's war day 1.
  const {
    rows: [day1Period],
  } = await db.query(
    `select starts_at from war_period
     where war_season_id = $1 and section_index = $2 and war_day = 1`,
    [wk.season_id, wk.section_index],
  );
  const at = new Date(day1Period.starts_at.getTime() + 3600_000);
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class)
     values ('r3-war-battle', $1, 'riverRacePvP', 'pvp')`,
    [at],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, battle_time, side, clan_tag, type, type_class)
     values ('r3-war-battle', $1, $2, 0, $3, 'riverRacePvP', 'pvp')`,
    [member, at, CLAN],
  );

  const war = await call(invoke, "war_current", {});
  const day1 = war.body.attendance_by_war_day.find((d) => d.war_day === 1);
  assert.ok(day1, "battle-derived war day appears");
  assert.ok(day1.battled >= 1, "recorded battle counts as battled");
  assert.ok(
    typeof day1.participants === "number",
    "attendance counts race participants, field renamed from members",
  );

  const focused = await call(invoke, "war_history", {
    player_tag: member,
    seasons: 1,
  });
  const cw = focused.body.member_weeks.find(
    (w) => w.season_id === wk.season_id && w.section_index === wk.section_index,
  );
  assert.ok(
    cw.war_days_battled >= 1,
    "battle-derived day reaches war_days_battled",
  );
  assert.ok(
    focused.body.weeks[0].in_progress === true ||
      focused.body.weeks[0].finished !== null,
    "latest week is either finished or marked in_progress",
  );
});

test("clans_standings: ranked by win rate with floor, median, and honest basis", async () => {
  // Give two members decided battles inside the window; leave the rest below floor.
  const members = (
    await db.query(
      `select player_tag from clan_membership
       where clan_tag = $1 and left_observed_at is null limit 2`,
      [CLAN],
    )
  ).rows.map((r) => r.player_tag);
  const mkBattle = async (id, tag, outcome, i) => {
    await db.query(
      `insert into battle (battle_id, battle_time, type, type_class)
       values ($1, now() - make_interval(hours => $2), 'PvP', 'pvp')
       on conflict do nothing`,
      [id, i],
    );
    await db.query(
      `insert into battle_participant (battle_id, player_tag, battle_time, side, outcome, trophy_change, type, type_class)
       values ($1, $2, now() - make_interval(hours => $3), 0, $4, $5, 'PvP', 'pvp')
       on conflict do nothing`,
      [id, tag, i, outcome, outcome === "win" ? 30 : -30],
    );
  };
  // Member A: 3-0. Member B: 1-2.
  for (let i = 0; i < 3; i++)
    await mkBattle(`st-a-${i}`, members[0], "win", i + 1);
  await mkBattle("st-b-0", members[1], "win", 1);
  await mkBattle("st-b-1", members[1], "loss", 2);
  await mkBattle("st-b-2", members[1], "loss", 3);
  // The daily rollup ingest maintains for every written participant
  // (clans_standings reads it for the whole days of its window).
  await refreshDailyRollups(db, await rollupPairs(db, "st-%"));

  const { body, isError } = await call(invoke, "clans_standings", {
    days: 7,
    min_battles: 3,
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.equal(body.ranked_members, 2, "exactly the two seeded members rank");
  assert.equal(body.members[0].player_tag, members[0], "3-0 ranks first");
  assert.equal(body.members[0].rank, 1);
  assert.equal(body.members[0].win_rate, 1);
  assert.equal(body.members[1].win_rate, 0.333);
  // 3.9.0: ladder trophy net and the streak ending at the latest battle,
  // in the same call (the per-member battles_performance loop retired).
  assert.equal(body.members[0].trophy_net, 90);
  assert.deepEqual(body.members[0].current_streak, { kind: "win", length: 3 });
  assert.equal(body.members[1].trophy_net, -30);
  assert.deepEqual(
    body.members[1].current_streak,
    { kind: "win", length: 1 },
    "the latest battle was a win; the two losses before it end the run",
  );
  assert.ok(
    body.below_floor.every(
      (m) => m.current_streak === null && m.trophy_net === 0,
    ),
    "no decided battle, no streak",
  );
  assert.ok(
    Math.abs(body.median_win_rate - 0.6665) < 0.001,
    `median of the two ranked rates, got ${body.median_win_rate}`,
  );
  assert.ok(body.below_floor.length > 0, "quiet members listed without rank");
  assert.ok(
    body.below_floor.every((m) => m.rank === undefined),
    "no ranks below the floor",
  );
  assert.match(body.notes.join(" "), /RECORDED battles only/);

  // Bad window refused.
  const bad = await call(invoke, "clans_standings", { days: 400 });
  assert.equal(bad.isError, true);
  assert.equal(bad.body.error.code, "bad_request");

  // Outsiders refused like every clan tool.
  const out = await call(invokeOutsider, "clans_standings", {});
  assert.equal(out.body.error.code, "no_subject");
});

test("war_rivals: bracket default, observer-deduped fingerprints, honest basis", async () => {
  const { body, isError } = await call(invoke, "war_rivals", {});
  assert.equal(isError, false, JSON.stringify(body));
  assert.ok(
    body.rivals.length >= 1,
    "bracket rivals found from the log fixture",
  );
  for (const r of body.rivals) {
    assert.ok(r.races_observed >= 1);
    assert.ok(r.races_shared_with_you <= r.races_observed);
    assert.ok(typeof r.clan_tag === "string");
  }
  assert.match(body.notes.join(" "), /counts once/);

  // Specific rival lookup works; junk tags refuse.
  const one = await call(invoke, "war_rivals", {
    rival_tags: [body.rivals[0].clan_tag],
  });
  assert.equal(one.body.rivals.length, 1);
  const junk = await call(invoke, "war_rivals", { rival_tags: ["#NOPE!!"] });
  assert.equal(junk.isError, true);
  assert.equal(junk.body.error.code, "invalid_tag");

  // Outsiders refused like every clan tool.
  const out = await call(invokeOutsider, "war_rivals", {});
  assert.equal(out.body.error.code, "no_subject");
});

test("clans_pilot_scores: whole clan in one call (agent feedback #1)", async () => {
  // Give two members enough leveled 1v1s to clear the floor.
  const members = (
    await db.query(
      `select player_tag from clan_membership
       where clan_tag = $1 and left_observed_at is null limit 2`,
      [CLAN],
    )
  ).rows.map((r) => r.player_tag);
  const ALPHA = "0289PYLQGRJCUV";
  const otag = (j, i) =>
    `#0PP${ALPHA[j]}${ALPHA[i % 14]}${ALPHA[Math.floor(i / 14)]}`;
  for (let i = 0; i < 55; i++) {
    for (const [j, tag] of members.entries()) {
      const id = `cps-${j}-${i}`;
      await db.query(
        `insert into battle (battle_id, battle_time, type, type_class)
         values ($1, now() - make_interval(hours => $2), 'PvP', 'pvp')
         on conflict do nothing`,
        [id, i * 2 + j],
      );
      await db.query(
        `insert into player (player_tag) values ($1) on conflict do nothing`,
        [otag(j, i)],
      );
      await db.query(
        `insert into battle_participant (battle_id, player_tag, battle_time, side, outcome, deck_avg_level, type, type_class)
         values ($1, $2, now() - make_interval(hours => $3), 0, $4, 14.0, 'PvP', 'pvp'),
                ($1, $5, now() - make_interval(hours => $3), 1, $6, 14.0, 'PvP', 'pvp')
         on conflict do nothing`,
        [
          id,
          tag,
          i * 2 + j,
          i % 2 === j % 2 ? "win" : "loss",
          otag(j, i),
          i % 2 === j % 2 ? "loss" : "win",
        ],
      );
    }
  }
  const { body, isError } = await call(invoke, "clans_pilot_scores", {
    days: 30,
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.ok(body.scored_members >= 2, "both seeded members scored");
  assert.ok(body.members[0].rank === 1);
  assert.ok(
    body.members.every((m) => typeof m.pilot_score === "number" && m.n >= 30),
  );
  assert.match(body.notes.join(" "), /descriptive in-sample residual/);
});

test("clans_pilot_scores: basis says what the curve was fit on", async () => {
  // Feedback #9: scores shifted between runs for players with no new
  // battles, because the curve is refit over a rolling window every
  // request. A version number would be a lie (no code changed); the
  // basis is the honest discriminator.
  const { body, isError } = await call(invoke, "clans_pilot_scores", {});
  assert.equal(isError, false, JSON.stringify(body));
  assert.ok(body.basis, "the response says what it was fit on");
  assert.equal(typeof body.basis.curve_pairs, "number");
  assert.equal(typeof body.basis.curve_bins, "number");
  assert.ok(
    Date.parse(body.applied.window.to) > Date.parse(body.applied.window.from),
    "the window is a real interval",
  );
  assert.equal(
    Math.round(
      (Date.parse(body.applied.window.to) -
        Date.parse(body.applied.window.from)) /
        86400_000,
    ),
    body.applied.window.days,
    "the window matches the declared days",
  );
  assert.match(body.notes.join(" "), /basis/);
});

test("players_search: corpus-wide names resolve; unknowns honest-empty", async () => {
  const member = (
    await db.query(
      `select cm.player_tag, p.name from clan_membership cm
       join player p on p.player_tag = cm.player_tag
       where cm.clan_tag = $1 and cm.left_observed_at is null and p.name is not null limit 1`,
      [CLAN],
    )
  ).rows[0];
  const hit = await call(invoke, "players_search", {
    query: member.name.slice(0, 4),
  });
  assert.equal(hit.isError, false);
  assert.ok(
    hit.body.matches.some((m) => m.player_tag === member.player_tag),
    "clanmate found by name fragment",
  );
  const miss = await call(invoke, "players_search", {
    query: "KenDoesNotExist",
  });
  assert.equal(miss.body.matches.length, 0);
  assert.match(miss.body.notes.join(" "), /No recorded player matches/);
});

test("war_current: a period first seen just BEFORE the reset is reported as an observation beside the policy bounds", async () => {
  // Feedback #9 (2026-09-06): the reset drifts EARLY, so the recorder
  // first saw a period open minutes before its 10:00Z boundary. The
  // boundary is the policy hour from the calendar whatever was
  // observed; the observation is reported beside it, and an early
  // sighting still names THIS period (an hour of early drift allowed).
  const today = await periodAt(db, Date.now());
  const observedAt = new Date(today.startMs - 3 * 60_000);
  await db.query(
    `insert into war_period_anchor (clan_tag, period_index, first_observed_at)
     values ($1, $2, $3)
     on conflict (clan_tag, period_index)
       do update set first_observed_at = excluded.first_observed_at`,
    [CLAN, today.periodIndex, observedAt],
  );
  const { body, isError } = await call(invoke, "war_current", {});
  assert.equal(isError, false, JSON.stringify(body));
  const period = body.period;
  assert.equal(period.started_observed_at, observedAt.toISOString());
  assert.equal(
    period.period_start_nominal,
    new Date(today.startMs).toISOString(),
  );
  assert.equal(period.period_end_nominal, new Date(today.endMs).toISOString());
  assert.ok(
    Date.parse(period.period_end_nominal) > Date.now(),
    "a live period's nominal end is in the future",
  );
  assert.ok(
    Date.parse(period.week_end_nominal) >=
      Date.parse(period.period_end_nominal),
    "the week cannot end before the period inside it",
  );
  assert.equal(
    period.observed_offset_minutes,
    -3,
    "the drift, signed, in minutes",
  );
  if (today.warDay) {
    assert.ok(
      body.decks_today,
      "a live war day still names who is untouched/partial/finished",
    );
    assert.equal(body.decks_today.war_day, period.war_day);
  }
});

test("0.22.1 hardening: unknown enums refuse; clamp echoes; dates guard (sol-6 + persona passes)", async () => {
  const badMode = await call(invoke, "battles_query", { mode: "2v2" });
  assert.equal(badMode.isError, true);
  assert.match(
    badMode.body.error.message,
    /Unknown mode: 2v2|mode must be one of/,
  );
  assert.match(badMode.body.error.hint, /Valid values/);

  const badOutcome = await call(invoke, "battles_query", {
    outcome: "victory",
  });
  assert.equal(badOutcome.isError, true);
  assert.match(
    badOutcome.body.error.message,
    /Unknown outcome|outcome must be one of/,
  );

  const badCard = await call(invoke, "battles_query", { with_card: 99999999 });
  assert.equal(badCard.isError, true);
  assert.match(badCard.body.error.hint, /cards_catalog/);

  const zeroWindow = await call(invoke, "battles_performance", {
    last_n_battles: 0,
  });
  assert.equal(zeroWindow.isError, true, "falsy zero refuses, never all-time");
  assert.match(zeroWindow.body.error.message, /1 to 500|at least 1/);

  const badSort = await call(invoke, "battles_decks", { sort: "losses" });
  assert.equal(badSort.isError, true);

  const badDate = await call(invoke, "players_timeline", {
    from: "not-a-date",
  });
  assert.equal(badDate.isError, true);
  assert.match(
    badDate.body.error.message,
    /Unparseable from/,
    "structured refusal, never 'failed unexpectedly'",
  );

  // Since the schema boundary (2026-09-09) an out-of-range limit is refused
  // against the declared maximum rather than silently clamped; a limit
  // inside the schema still echoes limit_applied.
  const over = await call(invoke, "battles_query", {
    limit: 10000,
    verbosity: "compact",
  });
  assert.equal(over.isError, true);
  assert.match(over.body.error.message, /limit must be at most 50/);
  const inRange = await call(invoke, "battles_query", {
    limit: 50,
    verbosity: "compact",
  });
  assert.equal(inRange.isError, false);
  assert.equal(inRange.body.applied.limit, 50, "the applied limit is visible");
});

test("war_history: finished_early flags 10000-fame regular weeks; horizon named", async () => {
  const { body } = await call(invoke, "war_history", { seasons: 12 });
  assert.ok(body.history_starts_at, "recording horizon is explicit");
  const flagged = body.weeks.filter((w) => w.finished_early);
  const tenK = body.weeks.filter(
    (w) => w.our_fame === 10000 && !w.is_colosseum,
  );
  assert.equal(
    flagged.length,
    tenK.length,
    "every 10000-fame regular week carries the flag",
  );
  assert.match(body.notes.join(" "), /finished_early/);
  assert.match(body.notes.join(" "), /history_starts_at/);
});

// ------------------------------------------------------- game_clock (0.30.0)
// The gap this fills: there was no clan-agnostic way to ask what season or war
// day it is, so Elixir Drop -- which has no clan at all -- carries a configured
// reference clan purely to borrow its river race as a calendar. That is also
// how an MCP season bug reaches a consumer with no stake in the clan it
// borrowed from.

test("game_clock answers without a clan, a player, or the database", async () => {
  const { makeRegistry } = await import("../src/tools.mjs");
  const registry = makeRegistry();

  // No db, no account, no live lane. If any of those are ever needed, this
  // throws rather than quietly reintroducing a subject.
  const body = await registry.invoke("game_clock", {}, {});

  assert.equal(typeof body.season_id, "number");
  assert.ok(body.week >= 1 && body.week <= 6);
  assert.ok(["training", "war"].includes(body.day_kind));
  assert.ok(body.meta.contract_version);
});

test("game_clock: a war day names which one; a training day names none", async () => {
  const { makeRegistry } = await import("../src/tools.mjs");
  const registry = makeRegistry();

  // 2026-09-07 10:00Z opened season 136 -- period 0, the first training day.
  const training = await registry.invoke(
    "game_clock",
    {},
    {
      at: "2026-09-07T12:00:00Z",
    },
  );
  assert.equal(training.day_kind, "training");
  assert.equal(training.war_day, null);
  assert.equal(training.week, 1);
  assert.equal(training.period_index, 0);

  // Three training days later the war days begin, numbered 1..4.
  const war = await registry.invoke(
    "game_clock",
    {},
    {
      at: "2026-09-10T12:00:00Z",
    },
  );
  assert.equal(war.day_kind, "war");
  assert.equal(war.war_day, 1);
  assert.equal(war.period_index, 3);
});

test("game_clock: the day boundary is 10:00Z, not midnight", async () => {
  const { makeRegistry } = await import("../src/tools.mjs");
  const registry = makeRegistry();
  // 09:59Z still belongs to the previous day; 10:01Z is the new one.
  const before = await registry.invoke(
    "game_clock",
    {},
    {
      at: "2026-09-10T09:59:00Z",
    },
  );
  const after = await registry.invoke(
    "game_clock",
    {},
    {
      at: "2026-09-10T10:01:00Z",
    },
  );
  assert.equal(before.period_index + 1, after.period_index);
  assert.equal(after.day_started_at, "2026-09-10T10:00:00.000Z");
  assert.equal(after.day_ends_at, "2026-09-11T10:00:00.000Z");
});

test("game_clock refuses a date it cannot read, rather than guessing now", async () => {
  const { makeRegistry } = await import("../src/tools.mjs");
  const registry = makeRegistry();
  await assert.rejects(
    () => registry.invoke("game_clock", {}, { at: "last tuesday" }),
    (err) => err.code === "bad_request",
  );
});

test("single-player and clan Pilot Scores share the same level observations and uncertainty disclosure", async () => {
  const clan = await call(invoke, "clans_pilot_scores", { days: 30 });
  assert.equal(clan.isError, false, JSON.stringify(clan.body));
  for (const member of clan.body.members) {
    const single = await call(invoke, "battles_levels", {
      player_tag: member.player_tag,
      days: 30,
    });
    assert.equal(single.isError, false, JSON.stringify(single.body));
    for (const field of [
      "n",
      "pilot_score",
      "actual_win_rate",
      "expected_from_levels",
      "standard_error",
    ]) {
      assert.equal(single.body.player[field], member[field], field);
    }
    assert.equal(
      single.body.methodology.standard_error.confidence_interval,
      false,
    );
  }
  assert.equal(clan.body.methodology.standard_error.formula, "0.5 / sqrt(n)");
  assert.match(clan.body.notes.join(" "), /counts do not identify/);
});

test("Pilot population excludes partial multiplayer and same-side observations", async () => {
  const before = await call(invoke, "clans_pilot_scores", { days: 30 });
  const tags = (
    await db.query("select player_tag from player order by player_tag limit 3")
  ).rows.map((r) => r.player_tag);
  for (const [id, sides] of [
    ["partial-team", [0, 0]],
    ["three-players", [0, 1, 1]],
  ]) {
    await db.query(
      "insert into battle (battle_id,battle_time,type,type_class) values ($1,now(),'PvP','pvp')",
      [id],
    );
    for (const [i, side] of sides.entries()) {
      await db.query(
        "insert into battle_participant (battle_id,player_tag,side,outcome,deck_avg_level,battle_time,type,type_class) values ($1,$2,$3,$4,$5,now(),'PvP','pvp')",
        [id, tags[i], side, i ? "loss" : "win", i === 2 ? null : 14],
      );
    }
  }
  const after = await call(invoke, "clans_pilot_scores", { days: 30 });
  assert.equal(after.body.basis.curve_pairs, before.body.basis.curve_pairs);
});

/**
 * The note described war_days_battled unconditionally, but that field only
 * exists on member_weeks, which only exist when player_tag was supplied.
 * A clan leader read the note on a plain war_history call and went hunting
 * for a field that was never going to be there (playtest round,
 * 2026-09-09).
 */
test("war_history only documents war_days_battled when it can actually return it", async () => {
  const plain = await call(invoke, "war_history", { seasons: 3 });
  assert.equal(plain.body.member_weeks, undefined, "no focus, no member rows");
  assert.doesNotMatch(
    plain.body.notes.join(" "),
    /war_days_battled/,
    "the note must not describe a field this response cannot carry",
  );
  // It should say how to get it instead of going silent.
  assert.match(plain.body.notes.join(" "), /player_tag/);
  // The clauses that DO apply are still there.
  assert.match(plain.body.notes.join(" "), /finished_early/);
  assert.match(plain.body.notes.join(" "), /history_starts_at/);

  const focusTag = (
    await db.query(
      `select player_tag from war_participation where clan_tag = $1 and points > 0
       limit 1`,
      [CLAN],
    )
  ).rows[0].player_tag;
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
     select $1, $2, now(), 'member'
     where not exists (select 1 from clan_membership where player_tag = $2 and left_observed_at is null)`,
    [CLAN, focusTag],
  );
  const focused = await call(invoke, "war_history", {
    player_tag: focusTag,
    seasons: 3,
  });
  assert.ok(focused.body.member_weeks, "focus returns member rows");
  assert.match(
    focused.body.notes.join(" "),
    /war_days_battled/,
    "and then the note explains them",
  );
  assert.match(focused.body.notes.join(" "), /finished_early/);
});

/**
 * A training day must not be shaped like a total no-show.
 *
 * war_current returns a full roster of zeroed points and decks and a
 * bracket at fame 0 whenever war has not started. That is identical in
 * shape to a clan that skipped a war day. The only discriminator was
 * period.kind, buried under a 900-character as_observed_note, and
 * decks_today simply vanished from the payload rather than saying why. A
 * clan leader read it as "the entire clan no-showed" and was saved only by
 * having called game_clock in the same batch (playtest round, 2026-09-09).
 */
test("war_current says what kind of day it is at the top level, from the calendar", async () => {
  const today = await periodAt(db, Date.now());
  const body = (await call(invoke, "war_current", { clan_tag: CLAN })).body;
  assert.equal(body.day_kind, today.kind, "beside season_id, not buried");
  assert.equal(body.war_day, today.warDay ?? null);
  assert.equal(body.period.period_index, today.periodIndex);
  // One name, one meaning: the next war day to open after this one, on
  // war days too, equal to game_clock's at the same instant (defect 2).
  const clock = (await call(invoke, "game_clock", {})).body;
  assert.equal(body.next_war_day_opens_at, clock.next_war_day_opens_at);
  assert.equal(body.period.next_war_day_opens_at, clock.next_war_day_opens_at);
  assert.ok(Date.parse(body.next_war_day_opens_at) > Date.now());
  if (today.warDay) {
    assert.ok(body.decks_today, "the nudge list the description promises");
    assert.equal(body.decks_today.war_day, today.warDay);
    assert.equal(body.decks_today_reason, undefined);
  } else {
    assert.equal(
      body.decks_today,
      null,
      "null is an answer; the key must be present",
    );
    assert.equal(body.decks_today_reason, "training_day");
    // And it says when the nagging actually becomes possible.
    assert.match(
      body.next_war_day_opens_at,
      /^\d{4}-\d{2}-\d{2}T10:00:00\.000Z$/,
      "war opens on the 10:00Z policy hour",
    );
    assert.ok(
      Date.parse(body.next_war_day_opens_at) >
        Date.parse(body.period.period_start_nominal),
    );
  }
  // The zeroed roster that caused the misread is still there - it is the
  // day_kind beside it that makes it legible.
  assert.ok(body.participants.length > 10);
});

/**
 * The race roster reconciles against the clan roster, out loud.
 *
 * A leader counted 44 participants against 49 members and could not tell a
 * recorder gap from a real one - and the five omissions were concentrated
 * on the least active members, which is the worst place for a silent hole.
 * Checked against the live CR API on 2026-09-09: its own currentriverrace
 * clan.participants returned the same 44 and omitted the same five tags, so
 * the list was always faithful. The fix is to make the gap visible, not to
 * change what is served.
 */
test("war_current names the current members the race roster leaves out", async () => {
  await db.query("begin");
  try {
    const { rows: participating } = await db.query(
      `select wp.player_tag from war_participation wp
       where wp.clan_tag = $1 order by wp.player_tag limit 1`,
      [CLAN],
    );
    const orphan = "#2P9YQCV0";
    await db.query(
      `insert into player (player_tag, name) values ($1, 'Not In Race')
       on conflict (player_tag) do nothing`,
      [orphan],
    );
    // In the clan, absent from this week's race roster.
    await db.query(
      `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
       values ($1, $2, now(), 'member')`,
      [CLAN, orphan],
    );

    const { body } = await call(invoke, "war_current", { clan_tag: CLAN });

    assert.equal(body.participants_count, body.participants.length);
    const missing = body.members_not_in_race.map((m) => m.player_tag);
    assert.ok(missing.includes(orphan), "the member with no race row is named");
    assert.equal(
      body.members_not_in_race.find((m) => m.player_tag === orphan).reason,
      "not_in_race_roster",
      "the API does not say why, so neither do we",
    );
    // Somebody who IS racing must not appear in the shortfall list.
    assert.ok(!missing.includes(participating[0].player_tag));

    // The two counts reconcile: current members = racing members + omitted.
    const racingMembers = body.participants.filter((p) => p.in_clan).length;
    assert.equal(
      body.member_count,
      racingMembers + body.members_not_in_race.length,
      "member_count is the clan, participants_count is the race",
    );

    assert.match(body.notes.join(" "), /members_not_in_race/);
  } finally {
    await db.query("rollback");
  }
});

test("clans_participation: every open member, per ISO week and per war week, facts only", async () => {
  const { body, isError } = await call(invoke, "clans_participation", {
    weeks: 8,
  });
  assert.equal(isError, false, JSON.stringify(body).slice(0, 300));
  assert.equal(body.clan_tag, CLAN);
  assert.equal(body.weeks.length, 8);
  assert.equal(
    body.weeks.at(-1).complete,
    false,
    "the current week is partial",
  );
  assert.match(body.weeks[0].iso_week, /^\d{4}-W\d{2}$/);
  const roster = (await call(invoke, "clans_roster", { verbosity: "compact" }))
    .body;
  assert.equal(
    body.member_count,
    roster.member_count,
    "same open members as the roster",
  );
  const m = body.members[0];
  assert.deepEqual(Object.keys(m).sort(), [
    "battles",
    "days_in_clan_observed",
    "days_since_battle",
    "donations",
    "joined_observed_at",
    "last_battle_time",
    "name",
    "player_tag",
    "ranked_battles",
    "role",
    "tenure_known",
    "war_battles_by_day",
    "war_decks",
    "war_decks_by_day",
    "war_points",
  ]);
  assert.equal(m.battles.length, 8);
  // A member present at the first roster poll has a lower-bound tenure,
  // never a fact; one seen joining later has a known one.
  assert.ok(body.first_roster_observed_at);
  for (const x of body.members)
    assert.equal(
      x.tenure_known,
      x.joined_observed_at > body.first_roster_observed_at,
      x.player_tag,
    );
  assert.ok(body.members.some((x) => x.tenure_known === false));
  // Null is unknown, never zero: a week without a snapshot answers null
  // donations; a day nobody polled answers null decks.
  for (const member of body.members) {
    for (const col of ["battles", "ranked_battles", "donations"])
      assert.equal(member[col].length, body.weeks.length, col);
    for (const b of member.battles) assert.ok(Number.isInteger(b) && b >= 0);
    for (const d of member.donations)
      assert.ok(d === null || Number.isInteger(d));
    assert.ok(
      member.days_since_battle === null ||
        typeof member.days_since_battle === "number",
    );
    for (const col of [
      "war_decks",
      "war_points",
      "war_decks_by_day",
      "war_battles_by_day",
    ])
      assert.equal(member[col].length, body.war_weeks.length, col);
    for (const days of member.war_decks_by_day) {
      assert.equal(days.length, 4);
      for (const d of days) assert.ok(d === null || Number.isInteger(d));
    }
  }
  const compact = (
    await call(invoke, "clans_participation", {
      weeks: 2,
      verbosity: "compact",
    })
  ).body;
  assert.equal(compact.applied.verbosity, "compact");
  for (const member of compact.members) {
    assert.ok(!("war_decks_by_day" in member));
    assert.ok(!("war_points" in member));
    assert.equal(member.war_decks.length, compact.war_weeks.length);
  }
  // The naming test: no field name, note or docs pointer is a judgment.
  // (The game's own role values, "elder" among them, are facts.)
  const keys = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        keys.add(k.toLowerCase());
        walk(x);
      }
  };
  walk(body);
  const prose = [...keys, ...body.notes, body.docs].join(" ").toLowerCase();
  for (const word of [
    "elder",
    "kick",
    "promot",
    "demot",
    "policy",
    "score",
    "rank ",
    "verdict",
  ])
    assert.ok(!prose.includes(word), `leaked judgment word: ${word}`);
  const { isError: refused } = await call(invoke, "clans_participation", {
    weeks: 9,
  });
  assert.equal(refused, true, "weeks above the maximum is refused");
});

test("war_current: race_finished_at is set once our boat has crossed the line", async () => {
  // POAP KINGS finished on day 4 at 09:38Z (2026-09-13) with 40 members still
  // "untouched": the lists stay facts, but the instant sits beside them so a
  // reader does not nudge toward nothing.
  const wk = (
    await db.query(
      `select season_id, section_index from war_week where clan_tag = $1
       order by season_id desc, section_index desc limit 1`,
      [CLAN],
    )
  ).rows[0];
  const { rowCount } = await db.query(
    `update war_week_clan set finish_time = '2026-09-13T09:38:04Z'
     where clan_tag = $1 and participant_clan_tag = $1
       and season_id = $2 and section_index = $3`,
    [CLAN, wk.season_id, wk.section_index],
  );
  assert.equal(rowCount, 1, "our own boat is one of the five standings rows");
  try {
    const { body, isError } = await call(invoke, "war_current", {});
    assert.equal(isError, false, JSON.stringify(body));
    assert.equal(body.race_finished_at, "2026-09-13T09:38:04.000Z");
    if (body.decks_today) {
      assert.equal(body.decks_today.race_finished_at, body.race_finished_at);
      assert.match(body.notes.join(" "), /crossed the finish line/);
    }
  } finally {
    await db.query(
      `update war_week_clan set finish_time = null
       where clan_tag = $1 and participant_clan_tag = $1
         and season_id = $2 and section_index = $3`,
      [CLAN, wk.season_id, wk.section_index],
    );
  }
});

test("game_clock: the next boundaries a routine schedules itself from", async () => {
  const { makeRegistry } = await import("../src/tools.mjs");
  const registry = makeRegistry();
  // Season 136 opened 2026-09-07 10:00Z: days 0-2 training (07, 08, 09),
  // war days 1-4 on 10, 11, 12, 13; week 2 opens 14 10:00Z.
  const training = await registry.invoke(
    "game_clock",
    {},
    { at: "2026-09-08T12:00:00Z" },
  );
  assert.equal(training.war_day_closes_at, null);
  assert.equal(training.next_war_day_opens_at, "2026-09-10T10:00:00.000Z");
  assert.equal(training.next_training_starts_at, "2026-09-14T10:00:00.000Z");
  assert.equal(training.week_ends_at, "2026-09-14T10:00:00.000Z");

  const warDay4 = await registry.invoke(
    "game_clock",
    {},
    { at: "2026-09-13T12:00:00Z" },
  );
  assert.equal(warDay4.war_day, 4);
  assert.equal(warDay4.war_day_closes_at, "2026-09-14T10:00:00.000Z");
  assert.equal(warDay4.day_ends_at, warDay4.war_day_closes_at);
  assert.equal(warDay4.next_war_day_opens_at, "2026-09-17T10:00:00.000Z");
  assert.equal(warDay4.next_training_starts_at, "2026-09-14T10:00:00.000Z");

  // War day 2: the next war day is tomorrow, training is three days out.
  const warDay2 = await registry.invoke(
    "game_clock",
    {},
    { at: "2026-09-11T12:00:00Z" },
  );
  assert.equal(warDay2.next_war_day_opens_at, "2026-09-12T10:00:00.000Z");
  assert.equal(warDay2.next_training_starts_at, "2026-09-14T10:00:00.000Z");
  assert.match(
    warDay2.notes.join(" "),
    /nothing in the event feed announces the time/i,
  );
});

test("the calendar's next_war_day_opens_at equals game_clock's on a training day and every war day (defect 2, 2026-09-19)", async () => {
  const registry = makeRegistry();
  for (const at of [
    "2026-09-08T12:00:00Z", // training day 2
    "2026-09-10T12:00:00Z", // war day 1
    "2026-09-11T12:00:00Z", // war day 2
    "2026-09-13T12:00:00Z", // war day 4: after the next training block
    "2026-10-04T12:00:00Z", // colosseum day 4: the next season's first war day
  ]) {
    const clock = await registry.invoke("game_clock", {}, { at });
    const period = await periodAt(db, Date.parse(at));
    assert.equal(
      new Date(period.nextWarDayOpensMs).toISOString(),
      clock.next_war_day_opens_at,
      `at ${at} (${clock.day_kind} ${clock.war_day ?? ""})`,
    );
  }
});

test("war_current on a clan the game has no race for says so instead of pointing at live (feedback #53)", async () => {
  // A one-member clan: recorded, its race log admitted empty, and the
  // current-race read a 404. Before, the refusal read "No war weeks
  // recorded ... live: true reads the race now", and a live read would
  // have 404'd the same way.
  const SOLO = "#GJ09RJP8";
  const {
    rows: [owner],
  } = await db.query(`select account_id from account where is_owner limit 1`);
  await db.query(`insert into clan (clan_tag) values ($1)`, [SOLO]);
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, scope) values ('clan', $1, $2, 'activity')`,
    [SOLO, owner.account_id],
  );
  const bare = await call(invoke, "war_current", { clan_tag: SOLO });
  assert.equal(bare.isError, true);
  assert.equal(bare.body.error.code, "not_recorded");
  assert.match(bare.body.error.message, /No war weeks recorded/);

  await db.query(
    `insert into poll_state (subject_tag, endpoint, last_admitted_at) values ($1, 'riverracelog', now() - interval '1 hour')`,
    [SOLO],
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status) values ($1, 'solo-gw', '127.0.0.2', 'active') returning gateway_id`,
    [owner.account_id],
  );
  await db.query(
    `insert into collector_fetch_error (gateway_id, endpoint, entity_key, fetched_at, http_status, error_kind)
     values ($1, 'currentriverrace', $2, now() - interval '30 minutes', 404, 'http')`,
    [gw.gateway_id, SOLO],
  );
  const known = await call(invoke, "war_current", { clan_tag: SOLO });
  assert.equal(known.isError, true);
  assert.equal(known.body.error.code, "not_recorded");
  assert.match(known.body.error.message, /The game reports no river race/);
  assert.match(known.body.error.hint, /live: true answers the same/);
  assert.match(known.body.error.hint, /clans_roster/);
});
