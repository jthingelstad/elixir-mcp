import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { pilotPairs, polSeasons } from "../src/ops-analysis.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_analysis_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

let db;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${SCRATCH}`);
  await admin.end();
  await migrate({
    databaseUrl: SCRATCH_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

const unpack = (b64) =>
  gunzipSync(Buffer.from(b64, "base64"))
    .toString()
    .split("\n")
    .map((line) => line.split(","));

test("pilot_pairs exports both sides of each qualifying match, pages, and carries the players", async () => {
  await db.query(
    `insert into player (player_tag, years_played) values ('#2PP0V9PP', 4), ('#2PP0V9QQ', null), ('#2PP0V9RR', 1)`,
  );
  await db.query(
    `insert into player_snapshot_daily (player_tag, snapshot_date, trophies, wins)
     values ('#2PP0V9PP', current_date - 1, 6000, 100),
            ('#2PP0V9PP', current_date, 6100, 101)`,
  );
  // One qualifying ladder match, one PvP draw (excluded), one battle with
  // a missing level (excluded).
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, arena_id)
     values ('m1', now() - interval '1 day', 'PvP', 'pvp', 54000012),
            ('m2', now() - interval '1 day', 'PvP', 'pvp', 54000012),
            ('m3', now() - interval '1 day', 'PvP', 'pvp', 54000012)`,
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, battle_time, side, outcome, type, type_class, deck_avg_level, starting_trophies, crowns, trophy_change)
     values ('m1', '#2PP0V9PP', now() - interval '1 day', 0, 'win', 'PvP', 'pvp', 14.5, 6000, 3, 30),
            ('m1', '#2PP0V9QQ', now() - interval '1 day', 1, 'loss', 'PvP', 'pvp', 13.25, 6010, 0, -30),
            ('m2', '#2PP0V9PP', now() - interval '1 day', 0, 'draw', 'PvP', 'pvp', 14.5, 6030, 1, 0),
            ('m2', '#2PP0V9RR', now() - interval '1 day', 1, 'draw', 'PvP', 'pvp', 14.0, 6020, 1, 0),
            ('m3', '#2PP0V9PP', now() - interval '1 day', 0, 'loss', 'PvP', 'pvp', null, 6030, 0, -29),
            ('m3', '#2PP0V9RR', now() - interval '1 day', 1, 'win', 'PvP', 'pvp', 14.0, 6020, 2, 29)`,
  );

  const all = await pilotPairs(SCRATCH_URL, { days: 30 });
  assert.equal(all.total, 2);
  assert.equal(all.returned, 2);
  assert.equal(all.done, true);
  const pairs = unpack(all.pairs_csv_gz_b64);
  assert.equal(pairs[0][0], "bid");
  const rows = pairs
    .slice(1)
    .map((r) => Object.fromEntries(pairs[0].map((k, i) => [k, r[i]])));
  assert.equal(rows.length, 2);
  const winner = rows.find((r) => r.player_tag === "#2PP0V9PP");
  const loser = rows.find((r) => r.player_tag === "#2PP0V9QQ");
  assert.equal(winner.bid, loser.bid);
  assert.equal(winner.win, "1");
  assert.equal(loser.win, "0");
  assert.equal(Number(winner.gap), 1.25);
  assert.equal(Number(loser.gap), -1.25);
  assert.equal(winner.opponent_level, "13.25");
  assert.equal(winner.arena_id, "54000012");
  assert.equal(winner.crowns, "3");
  assert.equal(winner.trophy_change, "30");

  const players = unpack(all.players_csv_gz_b64);
  const prow = players
    .slice(1)
    .map((r) => Object.fromEntries(players[0].map((k, i) => [k, r[i]])));
  assert.equal(prow.length, 2);
  const pp = prow.find((r) => r.player_tag === "#2PP0V9PP");
  assert.equal(pp.years_played, "4");
  assert.equal(pp.trophies, "6100", "latest snapshot with trophies");
  const qq = prow.find((r) => r.player_tag === "#2PP0V9QQ");
  assert.equal(qq.years_played, "");
  assert.equal(qq.trophies, "");

  // Paging: offset 1, limit 1 returns the second side and says not done at offset 0.
  const page = await pilotPairs(SCRATCH_URL, { days: 30, offset: 0, limit: 1 });
  assert.equal(page.returned, 1);
  assert.equal(page.done, false);
  const rest = await pilotPairs(SCRATCH_URL, { days: 30, offset: 1, limit: 1 });
  assert.equal(rest.returned, 1);
  assert.equal(rest.done, true);
});

test("pol_seasons exports season finals for players with enough seasons and the top of every final board", async () => {
  // Seasons are seeded by migrations; use two that exist.
  const { rows: seasons } = await db.query(
    `select season_month from season order by season_month desc limit 2`,
  );
  const [s1, s2] = seasons.map((r) => r.season_month);
  await db.query(
    `insert into player (player_tag) values ('#2PP0V9GG'), ('#2PP0V9YY') on conflict do nothing`,
  );
  await db.query(
    `insert into player_pol_season (player_tag, season_month, league, trophies, rank, observed_at)
     values ('#2PP0V9GG', $1, 10, 1900, null, now()),
            ('#2PP0V9GG', $2, 10, 2010, 500, now()),
            ('#2PP0V9YY', $2, 9, 1500, null, now())`,
    [s1, s2],
  );
  const { rows: snap } = await db.query(
    `insert into ranking_snapshot (board, location_key, season_month, observed_at, last_confirmed_at, content_hash, entries)
     values ('pol_final', 'global', $1, now(), now(), 'h1', 2) returning snapshot_id`,
    [s2],
  );
  await db.query(
    `insert into ranking_entry (snapshot_id, rank, player_tag, rating)
     values ($1, 1, '#2PP0V9GG', 4100), ($1, 2, '#2PP0V9YY', 4000)`,
    [snap[0].snapshot_id],
  );
  const out = await polSeasons(SCRATCH_URL, { min_seasons: 2, top: 100 });
  assert.equal(out.rows, 2, "only the two-season player's rows");
  assert.equal(out.players, 1);
  assert.equal(out.final_rows, 2);
  assert.equal(out.final_seasons, 1);
  const seasonsCsv = unpack(out.seasons_csv_gz_b64);
  assert.deepEqual(seasonsCsv[0], [
    "player_tag",
    "season_month",
    "league",
    "trophies",
    "rank",
  ]);
  assert.equal(seasonsCsv[1][0], "#2PP0V9GG");
  const finals = unpack(out.finals_csv_gz_b64);
  assert.deepEqual(finals[1].slice(1), ["1", "#2PP0V9GG", "4100"]);
});
