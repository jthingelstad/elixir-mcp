/**
 * The public card catalog with its running season (2026-10-01): one read
 * the cards index and the home page's board draw from. Every card's
 * season, mode by mode, from the same rollup cards_card reads, for the
 * latest season it holds. Modes are never pooled: 'all' stays out, and a
 * per-form row never stands in for the card.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { makeHandler } from "../src/handler.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_public_cards_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
let db, handler;

const get = async (p) => {
  const res = await handler({
    rawPath: p,
    requestContext: { http: { method: "GET" } },
    headers: {},
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

const KNIGHT = 26000000;
const ARCHERS = 26000001;

before(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  await migrate({
    databaseUrl,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  for (const [id, cardName, rarity, cost] of [
    [KNIGHT, "Knight", "common", 3],
    [ARCHERS, "Archers", "common", 3],
  ])
    await db.query(
      `insert into card (card_id, name, kind, rarity, elixir_cost, max_level,
                         icon_medium, in_catalog)
       values ($1, $2, 'card', $3, $4, 16,
               $5, true)
       on conflict (card_id) do update
         set name = excluded.name, kind = 'card', rarity = excluded.rarity,
             elixir_cost = excluded.elixir_cost, in_catalog = true`,
      [id, cardName, rarity, cost, `https://example.test/${id}.png`],
    );
  handler = makeHandler({ databaseUrl, secret: "test" });
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
});

test("with nothing rolled up the catalog says so: season is null, never zeros", async () => {
  const { status, body } = await get("/api/public/cards");
  assert.equal(status, 200);
  assert.ok(body.cards.some((c) => c.id === KNIGHT));
  assert.equal(body.season, null);
});

test("the latest season, mode by mode: shares of that mode's decided battles, no pooled row", async () => {
  for (const [month, war, starts, ends] of [
    ["2026-09", 135, "2026-09-07T10:00:00Z", "2026-10-05T10:00:00Z"],
    ["2026-10", 136, "2026-10-05T10:00:00Z", "2026-11-02T10:00:00Z"],
  ])
    await db.query(
      `insert into season (season_month, war_season_id, starts_at, ends_at,
                           sections, colosseum_section)
       values ($1, $2, $3, $4, 4, 3) on conflict do nothing`,
      [month, war, starts, ends],
    );
  // An older season that must not be the one read.
  await db.query(
    `insert into meta_season_totals (season_month, mode_group, decided, wins)
     values ('2026-09', 'ladder', 999, 500)`,
  );
  await db.query(
    `insert into card_meta_season (season_month, mode_group, card_id, form, battles, wins, losses, players)
     values ('2026-09', 'ladder', $1, -1, 900, 450, 450, 90)`,
    [KNIGHT],
  );
  // The running season: two modes with battles, war with none decided.
  for (const [mode, decided] of [
    ["all", 30000],
    ["ladder", 20000],
    ["ranked", 10000],
    ["war", 0],
  ])
    await db.query(
      `insert into meta_season_totals (season_month, mode_group, decided, wins)
       values ('2026-10', $1, $2, $3)`,
      [mode, decided, decided / 2],
    );
  for (const [card, mode, form, battles, wins, losses, players] of [
    [KNIGHT, "all", -1, 3000, 1500, 1500, 700],
    [KNIGHT, "ladder", -1, 2000, 1050, 950, 500],
    [KNIGHT, "ladder", 0, 1999, 1, 1, 1], // a form's row: never the card's
    [KNIGHT, "ranked", -1, 1000, 333, 667, 200],
    [KNIGHT, "war", -1, 5, 0, 0, null],
    [ARCHERS, "ladder", -1, 1500, 750, 750, 400],
  ])
    await db.query(
      `insert into card_meta_season (season_month, mode_group, card_id, form, battles, wins, losses, players)
       values ('2026-10', $1, $2, $3, $4, $5, $6, $7)`,
      [mode, card, form, battles, wins, losses, players],
    );
  await db.query(
    `insert into meta_season_state (season_month, counters_through, rebuilt_at)
     values ('2026-10', '2026-10-02T05:00:00Z', '2026-10-02T03:10:00Z')`,
  );

  const { status, body } = await get("/api/public/cards");
  assert.equal(status, 200);
  const s = body.season;
  assert.equal(s.season_month, "2026-10");
  assert.equal(s.as_of, "2026-10-02T05:00:00.000Z");
  assert.equal(s.players_as_of, "2026-10-02T03:10:00.000Z");
  // Each mode with its own decided battles, biggest first; 'all' and a
  // mode with nothing decided are not modes to read.
  assert.deepEqual(s.modes, [
    { mode_group: "ladder", decided_battles: 20000 },
    { mode_group: "ranked", decided_battles: 10000 },
  ]);
  assert.deepEqual(s.cards[KNIGHT], {
    ladder: {
      battles: 2000,
      players: 500,
      decided_battles: 20000,
      usage_share: 0.1,
      win_rate: 0.525,
    },
    ranked: {
      battles: 1000,
      players: 200,
      decided_battles: 10000,
      usage_share: 0.1,
      win_rate: 0.333,
    },
  });
  assert.deepEqual(Object.keys(s.cards[ARCHERS]), ["ladder"]);
  assert.equal(s.cards[ARCHERS].ladder.usage_share, 0.075);
});

test("a season the hourly increment has not stamped yet still reads, with no as_of", async () => {
  await db.query(`delete from meta_season_state`);
  const { body } = await get("/api/public/cards");
  assert.equal(body.season.season_month, "2026-10");
  assert.equal(body.season.as_of, null);
  assert.equal(body.season.players_as_of, null);
});

test("the per-card page reads the same row shape, and says when it moved", async () => {
  await db.query(
    `insert into meta_season_state (season_month, counters_through)
     values ('2026-10', '2026-10-02T06:00:00Z')`,
  );
  const { status, body } = await get(`/api/public/cards/${KNIGHT}`);
  assert.equal(status, 200);
  assert.equal(body.season, "2026-10");
  assert.equal(body.as_of, "2026-10-02T06:00:00.000Z");
  assert.deepEqual(
    body.by_mode.find((m) => m.mode_group === "ladder"),
    {
      mode_group: "ladder",
      battles: 2000,
      players: 500,
      decided_battles: 20000,
      usage_share: 0.1,
      win_rate: 0.525,
    },
  );
});
