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
    `insert into recording (subject_type, subject_tag, requested_by) values ('clan', $1, $2)`,
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

test("get_clan: roster with roles, snapshots slots, membership tenure", async () => {
  const { body, isError } = await call(invoke, "get_clan", {});
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

test("get_war: latest recorded week with standings, points, note", async () => {
  const { body, isError } = await call(invoke, "get_war", {});
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

test("get_war_history: ranks per week and one member focus with attendance", async () => {
  const { body } = await call(invoke, "get_war_history", { seasons: 3 });
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
  const focused = await call(invoke, "get_war_history", {
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
  const covered = await call(invoke, "get_war_history", {
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
  const one = await call(invoke, "get_war_history", {
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

test("compare_players: two clanmates side by side", async () => {
  const roster = await fixture("clan/roster.json");
  const { body, isError } = await call(invoke, "compare_players", {
    player_tags: [roster.memberList[0].tag, roster.memberList[1].tag],
  });
  assert.equal(isError, false);
  assert.equal(body.players.length, 2);
  assert.ok(body.players.every((p) => p.window));
});

test("entitlements hold: outsiders get structured refusals on every clan tool", async () => {
  for (const name of ["get_clan", "get_war", "get_war_history"]) {
    const { body, isError } = await call(invokeOutsider, name, {});
    assert.equal(isError, true, name);
    assert.equal(body.error.code, "not_entitled", name);
  }
  const cmp = await call(invokeOutsider, "compare_players", {
    player_tags: ["#YYYYYYYY", "#RRRRRRRR"],
  });
  assert.equal(cmp.body.error.code, "not_entitled");
});

test("the registry declares 17 tools, every one classified and annotated", () => {
  const decls = makeRegistry().declarations();
  assert.equal(decls.length, 17);
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
    writers.map((d) => d.name),
    ["send_feedback"],
    "send_feedback is the only write tool",
  );
  const open = decls.filter((d) => d.annotations.openWorldHint === true);
  assert.deepEqual(
    open.map((d) => d.name),
    ["cr_api_live"],
    "cr_api_live is the only open-world tool",
  );
});

test("round-3: seasons range refused loudly; attendance unions recorded battles", async () => {
  const thirteen = await call(invoke, "get_war_history", { seasons: 13 });
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

  const war = await call(invoke, "get_war", {});
  const day1 = war.body.attendance_by_war_day.find((d) => d.war_day === 1);
  assert.ok(day1, "battle-derived war day appears");
  assert.ok(day1.battled >= 1, "recorded battle counts as battled");
  assert.ok(
    typeof day1.participants === "number",
    "attendance counts race participants, field renamed from members",
  );

  const focused = await call(invoke, "get_war_history", {
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
