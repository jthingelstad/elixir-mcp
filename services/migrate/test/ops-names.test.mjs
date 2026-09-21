import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { nameCensus } from "../src/ops-names.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_names_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

let db;

// Four names, four shapes; the digit-suffixed pair loses, the others win.
const PLAYERS = [
  ["#2PP0V9PP", "King Thing", "win"],
  ["#2PP0V9QQ", "xXNoobXx", "win"],
  ["#2PP0V9RR", "Ryu2009", "loss"],
  ["#2PP0V9UU", "꧁★Иван★꧂", "loss"],
];

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
  for (const [tag, name] of PLAYERS)
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      name,
    ]);
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class)
     values ('b1', now(), 'PvP', 'pvp'), ('b2', now(), 'PvP', 'pvp'),
            ('b3', now(), 'boatBattle', 'boat')`,
  );
  for (const [i, [tag, , outcome]] of PLAYERS.entries())
    await db.query(
      `insert into battle_participant (battle_id, player_tag, side, outcome, starting_trophies, battle_time, type, type_class)
       values ($1, $2, $3, $4, $5, now(), 'PvP', 'pvp')`,
      [i < 2 ? "b1" : "b2", tag, i % 2, outcome, 5000 + i * 100],
    );
  // A boat battle never counts.
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, outcome, battle_time, type, type_class)
     values ('b3', '#2PP0V9RR', 0, 'win', now(), 'boatBattle', 'boat')`,
  );
  await db.query(
    `insert into ranking_board (board, location_key, label, location_kind)
     values ('pol', 'global', 'Path of Legends', 'global')
     on conflict do nothing`,
  );
  await db.query(
    `insert into ranking_snapshot (board, location_key, observed_at, last_confirmed_at, content_hash, entries, season_month)
     values ('pol', 'global', now(), now(), 'h', 2, '2026-09')`,
  );
  await db.query(
    `insert into ranking_entry (snapshot_id, rank, player_tag, name, rating)
     select snapshot_id, 1, '#2PP0V9PP', 'King Thing', 2100 from ranking_snapshot
     union all
     select snapshot_id, 2, '#2PP0V9RR', 'Ryu2009', 1900 from ranking_snapshot`,
  );
  await db.query(
    `insert into player_snapshot_daily (player_tag, snapshot_date, trophies, best_trophies, battle_count, wins, losses)
     values ('#2PP0V9PP', current_date, 9000, 9200, 500, 300, 200),
            ('#2PP0V9PP', current_date - 1, 8900, 9100, 490, 295, 195),
            ('#2PP0V9RR', current_date, 7000, 7000, 50, 20, 30)`,
  );
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

test("name_census aggregates every population by name shape", async () => {
  const out = await nameCensus(SCRATCH_URL, { min_players: 1 });
  const battles = out.populations.battles;
  assert.equal(battles.baseline.n, 4);
  assert.equal(battles.baseline.battles, 4);
  assert.equal(battles.baseline.win_rate_pooled, 0.5);
  const by = Object.fromEntries(battles.features.map((f) => [f.feature, f]));
  assert.equal(by.ends_with_digits.n, 1);
  assert.equal(by.ends_with_digits.win_rate_per_player, 0);
  assert.equal(by.year_suffix.n, 1);
  assert.equal(by.x_wrapped.n, 1);
  assert.equal(by.x_wrapped.win_rate_per_player, 1);
  assert.equal(by.kw_noob.n, 1);
  assert.equal(by.kw_king.n, 1);
  assert.equal(by.has_space.n, 1);
  assert.equal(by.decorative.n, 1);
  assert.equal(by.cyrillic.n, 1);
  assert.equal(by.non_ascii.n, 1);
  assert.equal(by.letters_only.n, 1);
  assert.equal(by["len_8-10"].n, 3);
  assert.equal(by.has_digit.battles, 1);
  // No name, tag or row shape leaks: only feature rows and counts.
  for (const f of battles.features)
    assert.deepEqual(Object.keys(f).sort(), [
      "battles",
      "decided_per_player",
      "feature",
      "n",
      "starting_trophies",
      "win_rate_per_player",
      "win_rate_pooled",
    ]);

  const ranked = out.populations.ranked;
  assert.equal(ranked.baseline.n, 2);
  assert.equal(ranked.baseline.rating, 2000);
  const rby = Object.fromEntries(ranked.features.map((f) => [f.feature, f]));
  assert.equal(rby.has_digit.rating, 1900);
  assert.equal(rby.has_space.rating, 2100);

  // The latest snapshot per player, and a 50-battle lifetime is withheld.
  const profiles = out.populations.profiles;
  assert.equal(profiles.baseline.n, 2);
  assert.equal(profiles.baseline.trophies, 8000);
  assert.equal(profiles.baseline.lifetime_win_rate, 0.6);
  assert.ok(Array.isArray(out.notes) && out.notes.length > 0);
});

test("min_players drops thin features", async () => {
  const out = await nameCensus(SCRATCH_URL, { min_players: 2 });
  const by = Object.fromEntries(
    out.populations.battles.features.map((f) => [f.feature, f]),
  );
  assert.equal(by.year_suffix, undefined);
  assert.equal(by.has_digit, undefined);
  assert.equal(by["len_8-10"].n, 3);
  assert.equal(out.min_players, 2);
});
