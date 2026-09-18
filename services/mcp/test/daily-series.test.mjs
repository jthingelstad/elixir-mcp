/**
 * The daily series readers (contract 3.12.0): players_timeline extended,
 * clans_timeline, clans_members_timeline, and the roster's lifetime
 * block, over rows the live projectors wrote from the fixtures.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { processResult } from "../../ingest/src/pipeline.mjs";
import { ensureSeasonsAround } from "../../ingest/src/season.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_series_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const CLAN = "#J2RGCRVG";
const ME = "#JYRQ8U92C"; // the profile fixture's subject, a roster member

let db;
let invoke;
let roster;
let profile;

const fixture = async (rel) =>
  JSON.parse(await readFile(path.join(repoRoot, "fixtures", rel), "utf8"));
const call = async (name, args = {}) => invoke(name, args);

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
  await ensureSeasonsAround(db);
  const {
    rows: [owner],
  } = await db.query(
    `insert into account (email_hash, status, is_owner) values ('ds-owner', 'approved', true) returning account_id`,
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, scope) values ('clan', $1, $2, 'comprehensive')`,
    [CLAN, owner.account_id],
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'ds-gw', '127.0.0.1', 'active') returning gateway_id`,
    [owner.account_id],
  );
  const send = async (endpoint, entityKey, payload, fetchedAt) => {
    const r = await processResult(db, {
      v: 1,
      job: { endpoint, entity_key: entityKey, lane: "bulk" },
      gateway_id: gw.gateway_id,
      fetched_at: fetchedAt,
      status: "ok",
      body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
        "base64",
      ),
    });
    assert.equal(r.outcome, "admitted", JSON.stringify(r));
  };
  roster = await fixture("clan/roster.json");
  profile = await fixture("player/profile.json");
  // Three game days of rosters (09-01, 09-02, Sunday 09-06 inside the
  // pre-reset hour), the profile on 09-01 and 09-02, and a profile on
  // the 09-06 pre-reset hour too.
  await send("clan", CLAN, roster, "2026-09-01T12:00:00Z");
  await send("player", ME, profile, "2026-09-01T14:00:00Z");
  const day2 = structuredClone(roster);
  day2.clanScore += 500;
  const me2 = day2.memberList.find((m) => m.tag === ME);
  me2.trophies += 30;
  me2.donations += 40;
  await send("clan", CLAN, day2, "2026-09-02T12:00:00Z");
  const p2 = structuredClone(profile);
  p2.trophies += 30;
  p2.donations += 40; // the 16:00Z profile is the day's last observation of the shared columns
  p2.wins += 5;
  p2.battleCount += 7;
  p2.progress["AutoChess_2026_Season_11"].trophies = 120;
  p2.progress["AutoChess_2026_Season_11"].bestTrophies = 120;
  await send("player", ME, p2, "2026-09-02T16:00:00Z");
  await send("clan", CLAN, day2, "2026-09-06T23:30:00Z");
  await send("player", ME, p2, "2026-09-06T23:35:00Z");

  const {
    rows: [alice],
  } = await db.query(
    `insert into account (email_hash, status) values ('ds-alice', 'approved') returning account_id`,
  );
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary) values ($1, $2, 'verified', true)`,
    [alice.account_id, ME],
  );
  invoke = makeInvoker({
    db,
    account: {
      accountId: alice.account_id,
      isOwner: false,
      timezone: "America/Chicago",
    },
    registry: makeRegistry(),
  });
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("players_timeline: every metric, the stamps, kind, progress_key, the season echo", async () => {
  const { body, isError } = await call("players_timeline", {
    metrics: [
      "trophies",
      "wins",
      "king_tower_level",
      "clan_tag",
      "clan_rank",
      "game_last_seen_at",
    ],
    from: "2026-09-01",
    to: "2026-09-06",
    progress_key: "all",
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.equal(body.series.length, 3);
  const [d1, d2, d6] = body.series;
  assert.equal(d1.day, "2026-09-01");
  assert.ok(!("date" in d1), "4.0.0: date is gone, day is the one key");
  assert.equal(d1.kind, "daily");
  assert.equal(d1.source, "api");
  assert.equal(d1.clan_tag, CLAN);
  assert.equal(typeof d1.clan_rank, "number");
  assert.equal(d1.king_tower_level, profile.kingTowerLevel);
  assert.equal(d1.roster_observed_at, "2026-09-01T12:00:00.000Z");
  assert.equal(d1.profile_observed_at, "2026-09-01T14:00:00.000Z");
  assert.equal(d1.observed_at, "2026-09-01T14:00:00.000Z");
  assert.equal(d2.wins - d1.wins, 5);
  assert.equal(d2.trophies - d1.trophies, 30);
  assert.equal(d6.day, "2026-09-06");
  assert.equal(body.applied.kind, "daily");
  assert.equal(body.applied.progress_key, "all");
  assert.equal(
    body.applied.window.season.month,
    "2026-08",
    "September 1st is inside the 2026-08 season",
  );
  assert.ok(Array.isArray(body.progress));
  const auto = body.progress.filter(
    (p) => p.key === "AutoChess_2026_Season_11",
  );
  assert.equal(
    auto.length,
    2,
    "the zero bucket on 09-01 wrote no row; 09-02 and 09-06 did",
  );
  assert.equal(auto[0].trophies, 120);
  assert.ok(body.notes.some((n) => n.includes("game days")));
  assert.equal(body.docs, "recording#daily-series");

  const pre = await call("players_timeline", {
    kind: "pre_reset",
    metrics: ["donations"],
  });
  assert.equal(pre.isError, false);
  assert.equal(
    pre.body.series.length,
    1,
    "one pre_reset row: Sunday 09-06's hour",
  );
  assert.equal(pre.body.series[0].kind, "pre_reset");
  assert.equal(pre.body.applied.kind, "pre_reset");

  const bad = await call("players_timeline", { metrics: ["nope"] });
  assert.equal(bad.isError, true);
});

test("clans_timeline: the clan's five metrics and the roster aggregates per game day; compact; kind; week", async () => {
  const { body, isError } = await call("clans_timeline", {
    from: "2026-09-01",
    to: "2026-09-06",
    metrics: [
      "clan_score",
      "members",
      "total_member_trophies",
      "avg_member_trophies",
      "members_seen",
      "members_with_profile",
      "avg_member_wins",
      "members_14000_plus",
    ],
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.equal(body.clan_tag, CLAN);
  assert.equal(body.series_available_from, "2026-09-01");
  assert.equal(body.series.length, 3);
  const [d1, d2] = body.series;
  assert.equal(d1.day, "2026-09-01");
  assert.equal(d1.kind, "daily");
  assert.equal(d1.source, "api");
  assert.equal(d1.clan_score, roster.clanScore);
  assert.equal(d2.clan_score, roster.clanScore + 500);
  assert.equal(d1.members, roster.members);
  assert.equal(
    d1.members_seen,
    roster.memberList.length,
    "every member row the roster wrote",
  );
  // 3.16.0: the denominator of the profile-derived aggregates.
  assert.equal(d1.members_with_profile, 1, "one recorded profile that day");
  assert.ok(
    body.notes.some((n) => /members_with_profile is that denominator/.test(n)),
  );
  assert.equal(
    d1.total_member_trophies,
    roster.memberList.reduce((s, m) => s + m.trophies, 0),
  );
  assert.equal(
    d1.avg_member_trophies,
    Math.round(d1.total_member_trophies / roster.memberList.length),
  );
  assert.equal(
    d1.avg_member_wins,
    profile.wins,
    "one recorded profile: the average is its wins",
  );
  assert.equal(
    d1.members_14000_plus,
    roster.memberList.filter((m) => m.trophies >= 14000).length,
  );
  // The note says both readings: above members (a leaver's row still
  // carries the tag) and below (a partial day) (defect 9, 2026-09-19).
  assert.ok(
    body.notes.some(
      (n) =>
        n.includes("members_seen") &&
        /members who left/.test(n) &&
        /above members/.test(n) &&
        /below members/.test(n),
    ),
    body.notes.join("\n"),
  );
  assert.ok(body.notes.some((n) => n.includes("profile-derived")));

  const compact = await call("clans_timeline", {
    verbosity: "compact",
    days: 30,
  });
  assert.equal(compact.isError, false);
  assert.deepEqual(Object.keys(compact.body.series[0]), [
    "day",
    "kind",
    "observed_at",
    "source",
    "clan_score",
    "clan_war_trophies",
    "members",
    "donations_per_week",
    "required_trophies",
  ]);

  const pre = await call("clans_timeline", { kind: "pre_reset" });
  assert.equal(pre.body.series.length, 1);
  assert.equal(pre.body.series[0].day, "2026-09-06");

  const weekly = await call("clans_timeline", {
    granularity: "week",
    from: "2026-09-01",
    to: "2026-09-06",
  });
  assert.equal(weekly.body.series.length, 1, "one ISO week (Sep 1-6 is W36)");
  assert.equal(weekly.body.series[0].day, "2026-09-06", "the week's last row");
  assert.equal(weekly.body.series[0].iso_week, "2026-W36");
});

test("clans_members_timeline: every member's roster series, the stamps, player_tags, compact deltas, limit", async () => {
  const { body, isError } = await call("clans_members_timeline", {
    from: "2026-09-01",
    to: "2026-09-02",
    metrics: ["trophies", "donations", "wins", "clan_rank"],
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.equal(body.member_count, roster.memberList.length);
  const me = body.members.find((m) => m.player_tag === ME);
  assert.equal(me.points, 2);
  assert.equal(me.series[0].day, "2026-09-01");
  assert.equal(me.series[0].clan_tag, CLAN);
  assert.equal(
    me.series[0].wins,
    profile.wins,
    "a recorded profile carries the lifetime metric",
  );
  assert.equal(me.series[1].trophies - me.series[0].trophies, 30);
  const other = body.members.find((m) => m.player_tag !== ME);
  assert.equal(
    other.series[0].wins,
    null,
    "a member without a recorded profile: null there",
  );
  assert.equal(other.series[0].profile_observed_at, null);
  assert.equal(typeof other.series[0].roster_observed_at, "string");
  assert.ok(body.notes.some((n) => n.includes("roster-only")));
  assert.equal(body.docs, "recording#daily-series");

  const compact = await call("clans_members_timeline", {
    player_tags: [ME],
    from: "2026-09-01",
    to: "2026-09-02",
    verbosity: "compact",
  });
  assert.equal(compact.isError, false);
  assert.equal(compact.body.member_count, 1);
  const c = compact.body.members[0];
  assert.equal(c.series, undefined);
  assert.equal(c.first.day, "2026-09-01");
  assert.equal(c.last.day, "2026-09-02");
  assert.deepEqual(c.delta, { trophies: 30, donations: 40 });

  const limited = await call("clans_members_timeline", { limit: 2, days: 30 });
  assert.equal(limited.body.member_count, 2);
  assert.ok(
    limited.body.notes.some((n) => n.startsWith("More than 2 members")),
  );

  const bad = await call("clans_members_timeline", { player_tags: ["nope!"] });
  assert.equal(bad.isError, true);
});

test("clans_roster carries the lifetime block, tenure and badge count per member", async () => {
  const { body, isError } = await call("clans_roster", {});
  assert.equal(isError, false, JSON.stringify(body));
  const me = body.members.find((m) => m.player_tag === ME);
  assert.equal(me.lifetime.wins, profile.wins + 5);
  assert.equal(me.lifetime.king_tower_level, profile.kingTowerLevel);
  assert.equal(me.lifetime.total_donations, profile.totalDonations);
  assert.equal(me.lifetime.as_of, "2026-09-06T23:35:00.000Z");
  // 3.17.0: the same instant under the stamp's one name.
  assert.equal(me.lifetime.profile_observed_at, me.lifetime.as_of);
  assert.ok(me.badge_count > 0);
  assert.equal(typeof me.years_played, "number");
  const other = body.members.find((m) => m.player_tag !== ME);
  assert.equal(other.lifetime, null, "no recorded profile: null, never zeros");
  assert.equal(other.badge_count, 0);
  assert.equal(
    typeof other.trophies,
    "number",
    "the roster's trophies are there for every member",
  );
});

test("one window grammar (3.17.0, call 3): an instant on a series tool is floored to its game day, echoed and said, never refused; days is N game days", async () => {
  // 2026-09-06T04:00Z is before the 10:00Z grid start: game day 09-05.
  const { body, isError } = await call("players_timeline", {
    from: "2026-09-01T12:30:00Z",
    to: "2026-09-06T04:00:00Z",
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.equal(body.applied.window.from, "2026-09-01");
  assert.equal(body.applied.window.to, "2026-09-05");
  assert.deepEqual(body.applied.window.floored, {
    from: "2026-09-01T12:30:00Z",
    to: "2026-09-06T04:00:00Z",
  });
  assert.ok(
    body.notes.some((n) =>
      /to 2026-09-06T04:00:00Z was an instant.*to is game day 2026-09-05/.test(
        n,
      ),
    ),
    JSON.stringify(body.notes),
  );
  assert.ok(
    body.series.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.day) && !("date" in p)),
    "day rides beside date",
  );
  // A date-only window says nothing about flooring.
  const plain = await call("players_timeline", {
    from: "2026-09-01",
    to: "2026-09-06",
  });
  assert.equal(plain.body.applied.window.floored, undefined);
  assert.ok(!plain.body.notes.some((n) => /was an instant/.test(n)));
  // The clan series take the same grammar.
  const clan = await call("clans_timeline", {
    from: "2026-09-01T00:00:00Z",
    to: "2026-09-06",
  });
  assert.equal(clan.isError, false, JSON.stringify(clan.body));
  assert.equal(
    clan.body.applied.window.from,
    "2026-08-31",
    "midnight UTC is still the previous game day",
  );
  assert.deepEqual(clan.body.applied.window.floored, {
    from: "2026-09-01T00:00:00Z",
  });
  const members = await call("clans_members_timeline", {
    to: "2026-09-06T09:59:59Z",
    days: 3,
  });
  assert.equal(members.isError, false, JSON.stringify(members.body));
  assert.equal(members.body.applied.window.to, "2026-09-05");
  // Garbage is still refused.
  const bad = await call("players_timeline", { from: "yesterday" });
  assert.equal(bad.isError, true);
  assert.equal(bad.body.error.code, "bad_request");
});
