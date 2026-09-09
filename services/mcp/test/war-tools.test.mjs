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
  assert.ok(body.participants.length > 10);
  assert.ok(
    body.participants.every((p) => typeof p.in_clan === "boolean"),
    "every participant carries in_clan",
  );
  assert.match(body.note, /points are per-member/);
  assert.match(body.note, /zero-fame opponent can be real/);
});

test("war_history: ranks per week and one member focus with attendance", async () => {
  const { body } = await call(invoke, "war_history", { seasons: 3 });
  assert.ok(body.weeks.length >= 9, "the log fixture spans ten weeks");
  assert.ok(body.weeks.every((w) => w.our_rank >= 1 && w.our_rank <= 5));
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
    assert.equal(body.error.code, "not_entitled", name);
  }
  // Universal reads: comparing arbitrary tags now resolves (empty
  // records serve honestly rather than refusing).
  const cmp = await call(invokeOutsider, "battles_compare", {
    player_tags: ["#YYYYYYYY", "#RRRRRRRR"],
  });
  assert.equal(cmp.isError, false, JSON.stringify(cmp.body));
  assert.equal(cmp.body.players.length, 2);
});

test("war_current exposes the poll age separately from the first period sighting", async () => {
  await db.query("begin");
  try {
    await db.query("delete from war_period_anchor where clan_tag=$1", [CLAN]);
    await db.query(
      `insert into war_period_anchor (clan_tag,period_index,first_observed_at)
      values ($1,0,now()-interval '2 days')`,
      [CLAN],
    );
    await db.query(
      `insert into poll_state (subject_tag,endpoint,last_admitted_at)
      values ($1,'currentriverrace',now()-interval '3 hours')
      on conflict (subject_tag,endpoint) do update set last_admitted_at=excluded.last_admitted_at`,
      [CLAN],
    );
    const stale = await call(invoke, "war_current", { clan_tag: CLAN });
    assert.equal(stale.isError, false, JSON.stringify(stale.body));
    assert.equal(stale.body.period.period_index, 0);
    assert.ok(stale.body.period.freshness_seconds >= 10800);
    assert.equal(stale.body.period.nominal_period_elapsed, true);
    assert.match(stale.body.meta.completeness_note, /nominal end/);
    assert.notEqual(
      stale.body.period.source_observed_at,
      stale.body.period.started_observed_at,
    );
    await db.query(
      `update war_period_anchor set period_index=1,first_observed_at=now() where clan_tag=$1`,
      [CLAN],
    );
    await db.query(
      `update poll_state set last_admitted_at=now() where subject_tag=$1 and endpoint='currentriverrace'`,
      [CLAN],
    );
    const fresh = await call(invoke, "war_current", { clan_tag: CLAN });
    assert.equal(fresh.body.period.period_index, 1);
    assert.equal(fresh.body.period.nominal_period_elapsed, false);
    assert.equal(fresh.body.period.freshness_seconds, 0);
  } finally {
    await db.query("rollback");
  }
});

test("the registry declares 44 tools, every one classified and annotated", () => {
  const decls = makeRegistry().declarations();
  assert.equal(decls.length, 44);
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
      "elixir_add_clan",
      "elixir_add_player",
      "elixir_events",
      "elixir_feedback",
      "elixir_identify",
      "elixir_nickname",
    ],
    "writes are service-domain, plus curating your own collections",
  );
  const open = decls.filter((d) => d.annotations.openWorldHint === true);
  assert.deepEqual(
    open.map((d) => d.name),
    ["live_fetch"],
    "live_fetch is the only open-world tool",
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
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, season_id, section_index, war_day)
     values ('r3-war-battle', now(), 'riverRacePvP', 'pvp', $1, $2, 1)`,
    [wk.season_id, wk.section_index],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, battle_time, side, clan_tag)
     values ('r3-war-battle', $1, now(), 0, $2)`,
    [member, CLAN],
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
      `insert into battle_participant (battle_id, player_tag, battle_time, side, outcome)
       values ($1, $2, now() - make_interval(hours => $3), 0, $4)
       on conflict do nothing`,
      [id, tag, i, outcome],
    );
  };
  // Member A: 3-0. Member B: 1-2.
  for (let i = 0; i < 3; i++)
    await mkBattle(`st-a-${i}`, members[0], "win", i + 1);
  await mkBattle("st-b-0", members[1], "win", 1);
  await mkBattle("st-b-1", members[1], "loss", 2);
  await mkBattle("st-b-2", members[1], "loss", 3);

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
  assert.ok(
    Math.abs(body.median_win_rate - 0.6665) < 0.001,
    `median of the two ranked rates, got ${body.median_win_rate}`,
  );
  assert.ok(body.below_floor.length > 0, "quiet members listed without rank");
  assert.ok(
    body.below_floor.every((m) => m.rank === undefined),
    "no ranks below the floor",
  );
  assert.match(body.note, /RECORDED battles only/);

  // Bad window refused.
  const bad = await call(invoke, "clans_standings", { days: 400 });
  assert.equal(bad.isError, true);
  assert.equal(bad.body.error.code, "bad_request");

  // Outsiders refused like every clan tool.
  const out = await call(invokeOutsider, "clans_standings", {});
  assert.equal(out.body.error.code, "not_entitled");
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
  assert.match(body.basis, /count once/);

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
  assert.equal(out.body.error.code, "not_entitled");
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
        `insert into battle_participant (battle_id, player_tag, battle_time, side, outcome, deck_avg_level)
         values ($1, $2, now() - make_interval(hours => $3), 0, $4, 14.0),
                ($1, $5, now() - make_interval(hours => $3), 1, $6, 14.0)
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
  assert.match(body.note, /descriptive in-sample residual/);
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
    Date.parse(body.basis.window_to) > Date.parse(body.basis.window_from),
    "the window is a real interval",
  );
  assert.equal(
    Math.round(
      (Date.parse(body.basis.window_to) - Date.parse(body.basis.window_from)) /
        86400_000,
    ),
    body.window_days,
    "the window matches the declared window_days",
  );
  assert.match(body.note, /basis/);
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
  assert.match(miss.body.note, /No recorded player matches/);
});

test("war_current: decks_today names untouched/partial/finished on a live war day", async () => {
  // Anchor a war-day period as freshly observed: periodInfo(4) -> war day 2.
  // NOTE: now() is a convenient anchor but NOT the production shape -
  // the reset drifts early, so real anchors sit minutes BEFORE a 10:00Z
  // boundary. That case is pinned in the next test; this one covers the
  // bucket arithmetic, and the stale-anchor guard below.
  await db.query(
    `insert into war_period_anchor (clan_tag, period_index, first_observed_at)
     values ($1, 4, now())
     on conflict (clan_tag, period_index)
       do update set first_observed_at = excluded.first_observed_at`,
    [CLAN],
  );
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
     values ($1, $2, $3, 2, $4, 2), ($1, $2, $3, 2, $5, 4)
     on conflict do nothing`,
    [CLAN, wk.season_id, wk.section_index, partialTag, finishedTag],
  );

  const { body, isError } = await call(invoke, "war_current", {});
  assert.equal(isError, false, JSON.stringify(body));
  assert.equal(body.period.war_day, 2);
  const dt = body.decks_today;
  assert.ok(dt, "live war day carries decks_today");
  assert.equal(dt.war_day, 2);
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
  assert.match(dt.note, /observed so far/);

  // A stale anchor (nominal end passed) must not present an old day as
  // today. decks_today goes null rather than absent: the key stays on the
  // wire and says WHY, so "nobody owes attacks" is distinguishable from
  // "this field broke".
  await db.query(
    `update war_period_anchor set first_observed_at = now() - interval '3 days'
     where clan_tag = $1 and period_index = 4`,
    [CLAN],
  );
  const stale = await call(invoke, "war_current", {});
  assert.equal(stale.body.decks_today, null, "stale day reports no nudge list");
  assert.equal(stale.body.decks_today_reason, "war_day_over");
  assert.equal(stale.body.day_kind, "war", "it was still a war day");
});

test("war_current: a period first seen just BEFORE the reset ends a day later", async () => {
  // Feedback #9 (2026-09-06, the clan-management routine). The reset
  // runs at ~10:00Z and drifts EARLY, so the recorder first saw war day
  // 4 open at 09:57:37Z. "The next 10:00Z after the anchor" was then
  // 10:00Z the same morning - 2.4 minutes after the period started and
  // ~24h before it actually ends. By read time it was 10.5 hours in the
  // PAST, and because decks_today is gated on that boundary the whole
  // block silently disappeared on a live war day.
  //
  // The old test anchored at now(), where "next 10:00Z" is always
  // future, so it never saw this. Anchor the production shape instead:
  // three minutes before the most recent 10:00Z boundary.
  const now = new Date();
  const boundary = new Date(now);
  boundary.setUTCHours(10, 0, 0, 0);
  if (boundary > now) boundary.setUTCDate(boundary.getUTCDate() - 1);
  const observedAt = new Date(boundary.getTime() - 3 * 60_000);

  await db.query(
    `insert into war_period_anchor (clan_tag, period_index, first_observed_at)
     values ($1, 4, $2)
     on conflict (clan_tag, period_index)
       do update set first_observed_at = excluded.first_observed_at`,
    [CLAN, observedAt],
  );

  const { body, isError } = await call(invoke, "war_current", {});
  assert.equal(isError, false, JSON.stringify(body));
  const period = body.period;
  assert.equal(period.started_observed_at, observedAt.toISOString());
  assert.equal(
    period.period_end_nominal,
    new Date(boundary.getTime() + 86400_000).toISOString(),
    "the period ends at the NEXT reset, not the one it opened at",
  );
  assert.ok(
    Date.parse(period.period_end_nominal) > Date.now(),
    "a live period's nominal end is in the future",
  );
  assert.ok(
    Date.parse(period.week_end_nominal) >=
      Date.parse(period.period_end_nominal),
    "the week cannot end before the period inside it",
  );
  // The second half of the report: the boundary gates decks_today, so a
  // wrong boundary took the nudge list with it.
  assert.ok(
    body.decks_today,
    "a live war day still names who is untouched/partial/finished",
  );
  assert.equal(body.decks_today.war_day, period.war_day);

  // Policy grid (2026-09-07): the boundary is the policy hour, and the
  // observation is reported beside it rather than used as the boundary.
  assert.equal(
    period.period_start_nominal,
    boundary.toISOString(),
    "the period starts at the policy hour, whatever we observed",
  );
  assert.equal(
    period.observed_offset_minutes,
    -3,
    "the observed start is reported as a signed distance from policy",
  );
  assert.match(period.as_observed_note, /POLICY reset for every clan/);
  assert.match(body.decks_today.note, /POLICY day/);
  // The uncapped count is machinery for the over-cap check, not a field
  // consumers should see on every member.
  for (const bucket of ["untouched", "partial", "finished"]) {
    for (const m of body.decks_today[bucket]) {
      assert.deepEqual(
        Object.keys(m).sort(),
        ["decks_used", "name", "player_tag"],
        `${bucket} members carry only the capped display value`,
      );
    }
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
  assert.equal(inRange.body.limit_applied, 50, "the applied limit is visible");
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
  assert.match(body.note, /finished_early/);
  assert.match(body.note, /history_starts_at/);
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
  assert.match(clan.body.note, /counts do not identify/);
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
        "insert into battle_participant (battle_id,player_tag,side,outcome,deck_avg_level) values ($1,$2,$3,$4,$5)",
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
    plain.body.note,
    /war_days_battled/,
    "the note must not describe a field this response cannot carry",
  );
  // It should say how to get it instead of going silent.
  assert.match(plain.body.note, /player_tag/);
  // The clauses that DO apply are still there.
  assert.match(plain.body.note, /finished_early/);
  assert.match(plain.body.note, /history_starts_at/);

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
    focused.body.note,
    /war_days_battled/,
    "and then the note explains them",
  );
  assert.match(focused.body.note, /finished_early/);
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
test("war_current says what kind of day it is at the top level", async () => {
  await db.query("begin");
  try {
    await db.query("delete from war_period_anchor where clan_tag=$1", [CLAN]);
    // period_index 2: the third and last training day of the section.
    await db.query(
      `insert into war_period_anchor (clan_tag,period_index,first_observed_at)
       values ($1,2,now())`,
      [CLAN],
    );
    const training = (await call(invoke, "war_current", { clan_tag: CLAN }))
      .body;

    assert.equal(training.day_kind, "training", "beside season_id, not buried");
    assert.equal(training.war_day, null);
    assert.equal(
      training.decks_today,
      null,
      "null is an answer; the key must be present",
    );
    assert.equal(training.decks_today_reason, "training_day");
    // And it says when the nagging actually becomes possible.
    assert.match(
      training.next_war_day_opens_at,
      /^\d{4}-\d{2}-\d{2}T10:00:00\.000Z$/,
      "war opens on the 10:00Z policy hour",
    );
    assert.ok(
      Date.parse(training.next_war_day_opens_at) >
        Date.parse(training.period.period_start_nominal),
      "the next war day is after the current period started",
    );
    // The zeroed roster that caused the misread is still there - it is the
    // day_kind beside it that makes it legible.
    assert.ok(training.participants.length > 10);

    // period_index 3: war day 1.
    await db.query(
      `update war_period_anchor set period_index=3,first_observed_at=now()
       where clan_tag=$1`,
      [CLAN],
    );
    const war = (await call(invoke, "war_current", { clan_tag: CLAN })).body;
    assert.equal(war.day_kind, "war");
    assert.equal(war.war_day, 1, "1-based");
    assert.equal(war.next_war_day_opens_at, null, "war is already open");
    assert.ok(war.decks_today, "the nudge list the description promises");
    assert.equal(war.decks_today.war_day, 1);
    assert.equal(
      war.decks_today_reason,
      undefined,
      "no reason is needed when the list is there",
    );
  } finally {
    await db.query("rollback");
  }
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

    assert.match(body.note, /members_not_in_race/);
  } finally {
    await db.query("rollback");
  }
});
