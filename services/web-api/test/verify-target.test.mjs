/**
 * The Verify target, end to end over the real routes and a scratch
 * database: a player with recorded battles gets their most-played deck
 * with two marked swaps; the poll carries the marks; a player without
 * battles gets a random eight.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { verifyRoutes, DECK_SIZE } from "../src/routes/verify.mjs";
import { deckKey } from "../src/routes/verify-draw.mjs";
import {
  seedPlayedDeck,
  seedDeck,
  hashFor,
} from "../../mcp/test/deck-rows.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_verify_target_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
let db, person, routes;
const PLAYER = "#2PP0V90Y"; // plays deck A
const FRESH = "#8QU2PJ8C"; // no battles
const OPP = "#PPRJ8V0L";
const A = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => 26000000 + i);
const B = [9, 10, 11, 12, 13, 14, 15, 16].map((i) => 26000000 + i);

async function seedCards(tag, n = 24) {
  await db.query(
    `insert into player (player_tag, name) values ($1, 'Seed') on conflict do nothing`,
    [tag],
  );
  for (let i = 1; i <= n; i += 1) {
    await db.query(
      `insert into card (card_id, name, kind, elixir_cost, icon_medium)
       values ($1, $2, 'card', $3, $4) on conflict (card_id) do nothing`,
      [26000000 + i, `Card ${i}`, (i % 6) + 1, `https://x/${i}.png`],
    );
    await db.query(
      `insert into player_card (player_tag, card_id, level, first_seen_at, observed_at)
       values ($1, $2, 10, now(), now()) on conflict do nothing`,
      [tag, 26000000 + i],
    );
  }
}

let seq = 0;
async function battle(tag, ids, at) {
  seq += 1;
  const id = `target-${process.pid}-${seq}`;
  await db.query(
    `insert into player (player_tag, name) values ($1, 'Rival') on conflict do nothing`,
    [OPP],
  );
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class)
     values ($1, $2, 'PvP', 'pvp')`,
    [id, at],
  );
  // The verify routes read a deck's ids from its identity rows (0091).
  const cards = ids.map((c) => ({ id: c, level: 14 }));
  await seedDeck(db, { battle_time: at, cards });
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, deck_hash, battle_time, type, type_class)
     values ($1, $2, 0, $3, $4, 'PvP', 'pvp'), ($1, $5, 1, null, $4, 'PvP', 'pvp')`,
    [id, tag, hashFor(cards), at, OPP],
  );
  await seedPlayedDeck(db, {
    battle_id: id,
    player_tag: tag,
    battle_time: at,
    cards,
  });
}

before(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  await migrate({
    databaseUrl,
    migrationsDir: new URL("../../../db/migrations", import.meta.url).pathname,
  });
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  person = (
    await db.query(
      "insert into account(email_hash,status,role) values ('target-person','approved','member') returning account_id",
    )
  ).rows[0].account_id;
  await seedCards(PLAYER);
  await seedCards(FRESH);
  for (const [tag, primary] of [
    [PLAYER, true],
    [FRESH, false],
  ])
    await db.query(
      `insert into claim (account_id, player_tag, status, is_primary, relationship)
       values ($1, $2, 'unverified', $3, $4)`,
      [person, tag, primary, primary ? "primary" : "alt"],
    );
  // Three battles with A, one with B, all in the last month.
  const h = 3_600_000;
  await battle(PLAYER, A, new Date(Date.now() - 5 * h));
  await battle(PLAYER, B, new Date(Date.now() - 4 * h));
  await battle(PLAYER, A, new Date(Date.now() - 3 * h));
  await battle(PLAYER, A, new Date(Date.now() - 2 * h));
  routes = verifyRoutes({
    resolveAccount: async () => ({
      accountId: person,
      role: "member",
      kind: "person",
    }),
    logEvent: async () => {},
    live: async () => ({
      ok: false,
      reason: "pending",
      retry_after_s: 15,
      job_id: 1,
      minted: true,
    }),
  });
});
after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
});

test("start: the most-played deck with two marked swaps of similar cost, never a deck played this month; the poll carries the marks", async () => {
  const started = await routes["POST /api/me/verify"](
    db,
    {},
    { player_tag: PLAYER },
  );
  assert.equal(started.statusCode, 200, started.body);
  const c = JSON.parse(started.body);
  assert.equal(c.target_source, "most_played");
  const ids = c.target.map((x) => x.id);
  assert.equal(new Set(ids).size, DECK_SIZE);
  assert.equal(ids.filter((id) => A.includes(id)).length, 6, "six of A stay");
  const swapped = c.target.filter((x) => x.swapped);
  assert.equal(swapped.length, 2, "two swaps, marked");
  assert.ok(swapped.every((x) => !A.includes(x.id) && x.icon && x.name));
  assert.notEqual(deckKey(ids), deckKey(A));
  assert.notEqual(deckKey(ids), deckKey(B));
  const { rows } = await db.query(
    `select target_source, swapped_card_ids from claim_challenge where player_tag = $1`,
    [PLAYER],
  );
  assert.equal(rows[0].target_source, "most_played");
  assert.deepEqual(
    rows[0].swapped_card_ids.sort(),
    swapped.map((x) => x.id).sort(),
  );
  const polled = await routes["GET /api/me/verify/*"](db, {
    pathParam: c.challenge_id,
  });
  assert.equal(polled.statusCode, 200, polled.body);
  const p = JSON.parse(polled.body);
  assert.deepEqual(
    p.target
      .filter((x) => x.swapped)
      .map((x) => x.id)
      .sort(),
    swapped.map((x) => x.id).sort(),
  );
  assert.equal(p.target_source, "most_played");
});

test("start: no recorded battles means a random owned eight, unmarked", async () => {
  const started = await routes["POST /api/me/verify"](
    db,
    {},
    { player_tag: FRESH },
  );
  assert.equal(started.statusCode, 200, started.body);
  const c = JSON.parse(started.body);
  assert.equal(c.target_source, "random");
  assert.equal(c.target.length, DECK_SIZE);
  assert.ok(c.target.every((x) => !x.swapped));
});
