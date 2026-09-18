/**
 * The elixir-bot series import over a scratch database: staging,
 * the census against a live-shaped day set, and the commit's
 * non-overlap rule (a clan row only where the record has none, a
 * member's row only where the member has none, the Sunday pre_reset row
 * only where the recorder's window missed it, rollup keys only where
 * absent), all through the projector with source elixir-bot.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { seriesImport, seriesCensus } from "../src/ops-bot-import.mjs";
import { projectClanSeries } from "../../ingest/src/series.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_botimport_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
let db;
const CLAN = "#J2RGCRVG";
const A = "#2PP0V9QP";
const B = "#2PP0V9UP";
const C = "#2PP0V9CP";

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: DB_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
});
after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

const roster = (members, at) => ({
  tag: CLAN,
  name: "POAP KINGS",
  clanScore: 70000,
  clanWarTrophies: 160,
  requiredTrophies: 2000,
  donationsPerWeek: 700,
  members: members.length,
  memberList: members.map((m, i) => ({
    tag: m.tag,
    name: `M${i}`,
    role: "member",
    trophies: m.trophies,
    donations: m.donations,
    donationsReceived: 0,
    clanRank: i + 1,
    previousClanRank: i + 1,
    arena: { id: 54000050, name: "Legendary Arena" },
    lastSeen: at.replace(/[-:]/g, "").replace("Z", ".000Z"),
  })),
});

test("stage, census, commit: only what the record lacks lands, with source elixir-bot", async () => {
  // The record: game day 2026-03-14 (a Saturday) from the archive at
  // 09:55Z next morning, members A and B; game day 03-15 (a Sunday)
  // with A only, and a pre_reset row for A; nothing on 03-12, 03-13.
  await projectClanSeries(db, {
    payload: roster(
      [
        { tag: A, trophies: 6000, donations: 100 },
        { tag: B, trophies: 5000, donations: 50 },
      ],
      "2026-03-15T09:55:00Z",
    ),
    observedAt: "2026-03-15T09:55:00Z",
    receiptId: null,
  });
  await projectClanSeries(db, {
    payload: roster(
      [{ tag: A, trophies: 6010, donations: 130 }],
      "2026-03-16T09:55:00Z",
    ),
    observedAt: "2026-03-16T09:55:00Z",
  });
  await projectClanSeries(db, {
    payload: roster(
      [{ tag: A, trophies: 6010, donations: 130 }],
      "2026-03-15T23:30:00Z",
    ),
    observedAt: "2026-03-15T23:30:00Z",
    kind: "pre_reset",
  });
  // The bot's intermediate: 03-13 (no record), 03-14 (both; B moved
  // between the bot's 04:50Z and the recorder's 09:55Z), 03-15 Sunday
  // (A and C; C has no record row; the bot's donations are the MAX).
  const entries = [
    {
      day: "2026-03-13",
      fetched_at: "2026-03-14T04:50:00Z",
      sunday: false,
      has_clan_row: true,
      payload: {
        tag: CLAN,
        name: "POAP KINGS",
        members: 2,
        clanScore: 69900,
        clanWarTrophies: 160,
        requiredTrophies: 2000,
        donationsPerWeek: 700,
        memberList: [
          {
            tag: A,
            trophies: 5990,
            donations: 80,
            donationsReceived: 0,
            clanRank: 1,
            lastSeen: "20260313T200000.000Z",
          },
          {
            tag: B,
            trophies: 4990,
            donations: 40,
            donationsReceived: 0,
            clanRank: 2,
            lastSeen: "20260313T200000.000Z",
          },
        ],
      },
    },
    {
      day: "2026-03-14",
      fetched_at: "2026-03-15T04:50:00Z",
      sunday: false,
      has_clan_row: true,
      payload: {
        tag: CLAN,
        name: "POAP KINGS",
        members: 2,
        clanScore: 70000,
        clanWarTrophies: 160,
        requiredTrophies: 2000,
        donationsPerWeek: 700,
        memberList: [
          {
            tag: A,
            trophies: 6000,
            donations: 100,
            donationsReceived: 0,
            clanRank: 1,
            lastSeen: "20260314T200000.000Z",
          },
          {
            tag: B,
            trophies: 4970,
            donations: 50,
            donationsReceived: 0,
            clanRank: 2,
            lastSeen: "20260314T200000.000Z",
          },
        ],
      },
    },
    {
      day: "2026-03-15",
      fetched_at: "2026-03-16T04:50:00Z",
      sunday: true,
      has_clan_row: true,
      payload: {
        tag: CLAN,
        name: "POAP KINGS",
        members: 2,
        clanScore: 70100,
        clanWarTrophies: 160,
        requiredTrophies: 2000,
        donationsPerWeek: 700,
        memberList: [
          {
            tag: A,
            trophies: 6010,
            donations: 130,
            donationsReceived: 0,
            clanRank: 1,
            lastSeen: "20260315T200000.000Z",
          },
          {
            tag: C,
            trophies: 4000,
            donations: 20,
            donationsReceived: 0,
            clanRank: 2,
            lastSeen: "20260315T200000.000Z",
          },
        ],
      },
    },
  ];
  const rollups = [
    {
      player_tag: A,
      day: "2026-03-13",
      mode_group: "ladder",
      game_mode_id: 72000006,
      wins: 2,
      losses: 1,
      draws: 0,
      crowns_for: 6,
      crowns_against: 4,
      trophy_delta: 35,
      battles_captured: 3,
    },
    {
      player_tag: A,
      day: "2026-03-14",
      mode_group: "casual",
      game_mode_id: 0,
      wins: 1,
      losses: 0,
      draws: 0,
      crowns_for: 3,
      crowns_against: 0,
      trophy_delta: 0,
      battles_captured: 1,
    },
  ];
  await db.query(
    `insert into player_daily_battle_rollup (player_tag, day, mode_group, game_mode_id, wins, losses, draws, battles_captured)
     values ($1, '2026-03-14', 'casual', 0, 1, 0, 0, 1)`,
    [A],
  );

  const staged = await seriesImport(DB_URL, { stage: { entries, rollups } });
  assert.deepEqual(staged.staged, {
    clan_days: 3,
    member_rows: 6,
    rollups: 2,
    days: 3,
  });

  const census = await seriesCensus(DB_URL, {
    from: "2026-03-13",
    to: "2026-03-16",
  });
  assert.equal(census.days.only_bot, 1);
  assert.deepEqual(census.days.only_bot_days, ["2026-03-13"]);
  assert.equal(census.days.both, 2);
  assert.equal(census.days.only_recorder, 0);
  assert.equal(census.clan.days, 2);
  assert.equal(census.clan.clan_score_equal, 1, "03-14 equal");
  assert.equal(
    census.clan.clan_score_residual,
    1,
    "03-15: the recorder observed later and the score moved",
  );
  assert.equal(census.clan.clan_score_disagree, 0);
  assert.equal(census.members.only_bot, 3, "A and B on 03-13, C on 03-15");
  assert.equal(census.members.both, 3);
  assert.equal(census.members.metrics.trophies_equal, 2);
  assert.equal(
    census.members.metrics.trophies_residual,
    1,
    "B moved between the bot's read and the recorder's",
  );
  assert.equal(census.members.metrics.trophies_disagree, 0);
  assert.equal(census.members.metrics.delta_hours["3_to_6"], 3);
  assert.equal(census.sundays.bot_sunday_rows, 2);
  assert.equal(
    census.sundays.pre_reset_equal,
    1,
    "A's pre_reset row carries the bot's MAX",
  );
  assert.equal(census.sundays.recorder_window_missed, 1, "C");
  assert.deepEqual(census.rollup, {
    bot_keys: 2,
    absent: 1,
    present_equal: 1,
    present_different: 0,
  });

  const committed = await seriesImport(DB_URL, { commit: true });
  assert.equal(committed.days, 3);
  assert.equal(committed.clan_rows, 1, "03-13 only");
  assert.equal(committed.member_rows, 3, "A and B on 03-13, C on 03-15");
  assert.equal(committed.members_skipped_overlap, 3);
  assert.equal(committed.pre_reset_rows, 1, "C's Sunday MAX");
  assert.equal(committed.rollup_keys_added, 1);

  const { rows: clanRows } = await db.query(
    `select day::text as day, source, clan_score from clan_snapshot_daily where clan_tag = $1 and snapshot_kind = 'daily' order by day`,
    [CLAN],
  );
  assert.deepEqual(
    clanRows.map((r) => [r.day, r.source, r.clan_score]),
    [
      ["2026-03-13", "elixir-bot", 69900],
      ["2026-03-14", "api", 70000],
      ["2026-03-15", "api", 70000],
    ],
  );
  const { rows: cRows } = await db.query(
    `select snapshot_kind, source, trophies, donations from player_snapshot_daily
      where player_tag = $1 and snapshot_date = '2026-03-15' order by snapshot_kind`,
    [C],
  );
  assert.deepEqual(
    cRows.map((r) => [r.snapshot_kind, r.source, r.trophies, r.donations]),
    [
      ["daily", "elixir-bot", 4000, null],
      ["pre_reset", "elixir-bot", 4000, 20],
    ],
    "a Sunday: the daily row's donations null, the pre_reset row carries the MAX",
  );
  const {
    rows: [bRow],
  } = await db.query(
    `select trophies, source from player_snapshot_daily where player_tag = $1 and snapshot_date = '2026-03-14' and snapshot_kind = 'daily'`,
    [B],
  );
  assert.deepEqual(
    bRow,
    { trophies: 5000, source: "api" },
    "the overlapping row is untouched",
  );
  const {
    rows: [{ n }],
  } = await db.query(`select count(*)::int as n from player_event`);
  assert.equal(n, 0);
  // A second commit changes nothing.
  const again = await seriesImport(DB_URL, { commit: true });
  assert.equal(
    again.clan_rows +
      again.member_rows +
      again.pre_reset_rows +
      again.rollup_keys_added,
    0,
  );
});
