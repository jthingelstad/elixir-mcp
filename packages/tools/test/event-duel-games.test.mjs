/**
 * A duel of any type counts its games (13.1.0). Ingest stores the round
 * rows of every battle the API sends rounds[] for, whatever its type;
 * battles_decks, battles_performance and battles_cards knew a duel only
 * by the river race types, so an event's multi-deck duel was a battle
 * with "no deck" whose games counted nowhere. Real fixtures through the
 * real pipeline: one player with a Colosseum duel (war), an event's
 * multi-deck duel (event) and ladder battles. Each duel's games stay in
 * their own mode group.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import pg from "pg";
import { processResult } from "../../ingest/src/pipeline.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { createScratch, dropScratch } from "../../ingest/test/helpers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_event_duel_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

// The team side of both fixtures (invented).
const PLAYER = "#0QRVVG22J";

let db;
let account;
const registry = makeRegistry();
const call = (name, args = {}) => registry.invoke(name, { db, account }, args);
const fixture = async (rel) =>
  JSON.parse(await readFile(path.join(repoRoot, "fixtures", rel), "utf8"));

before(async () => {
  await createScratch(NAME);
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const {
    rows: [acct],
  } = await db.query(
    `insert into account (email_hash, status, is_owner) values ('event-duel', 'approved', true)
     returning account_id`,
  );
  account = {
    accountId: acct.account_id,
    isOwner: true,
    timezone: "UTC",
    kind: "person",
    role: "member",
  };
  await db.query(`insert into player (player_tag) values ($1)`, [PLAYER]);
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by) values ('player', $1, $2)`,
    [PLAYER, account.accountId],
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'event-duel-gw', '127.0.0.1', 'active') returning gateway_id`,
    [account.accountId],
  );
  const send = async (endpoint, entityKey, payload, fetchedAt) => {
    const result = await processResult(db, {
      v: 1,
      job: { endpoint, entity_key: entityKey, lane: "bulk" },
      gateway_id: gw.gateway_id,
      fetched_at: fetchedAt,
      status: "ok",
      body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
        "base64",
      ),
    });
    assert.equal(result.outcome, "admitted", JSON.stringify(result));
  };
  await send(
    "cards",
    "GLOBAL",
    await fixture("cards/catalog.json"),
    "2026-09-03T13:00:00Z",
  );
  await send(
    "player_battlelog",
    PLAYER,
    await fixture("player_battlelog/with_colosseum_duel.json"),
    "2026-09-03T14:30:34Z",
  );
  await send(
    "player_battlelog",
    PLAYER,
    await fixture("player_battlelog/with_event_multideck_duel.json"),
    "2026-09-03T14:31:34Z",
  );
});

after(async () => {
  await db.end();
  await dropScratch(NAME);
});

test("the record holds the event duel as one battle with three round rows", async () => {
  const { rows } = await db.query(
    `select b.type, count(r.*)::int as rounds
       from battle b
       join battle_participant_round r on r.battle_id = b.battle_id
      where r.player_tag = $1
      group by b.type order by b.type`,
    [PLAYER],
  );
  // The event's multi-deck duel comes as `trail` with an event tag.
  assert.deepEqual(
    rows.map((r) => r.type),
    ["riverRaceDuelColosseum", "trail"],
  );
  assert.equal(rows.find((r) => r.type === "trail").rounds, 3);
});

test("battles_decks: an event duel is a duel, its rounds listed in its own mode group", async () => {
  const all = await call("battles_decks", { player_tag: PLAYER });
  // Before 13.1.0 the event duel sat under no_deck.
  assert.equal(all.excluded.duels, 2);
  assert.equal(all.excluded.no_deck, 0);
  const modes = new Set(all.duel_decks.map((d) => d.mode));
  assert.deepEqual([...modes].sort(), ["event", "war"]);

  const event = await call("battles_decks", {
    player_tag: PLAYER,
    mode: "event",
  });
  assert.deepEqual(event.excluded, { duels: 1, no_deck: 0 });
  assert.equal(event.duel_decks.length, 3);
  assert.ok(event.duel_decks.every((d) => d.mode === "event"));
  // One round each, won or lost by that round's own crowns: 1-0, 0-1, 2-1.
  assert.equal(
    event.duel_decks.reduce((n, d) => n + d.rounds, 0),
    3,
  );
  assert.equal(
    event.duel_decks.reduce((n, d) => n + d.wins, 0),
    2,
  );
  assert.equal(
    event.duel_decks.reduce((n, d) => n + d.losses, 0),
    1,
  );

  // War keeps only the river race duel's rounds; ladder has none.
  const war = await call("battles_decks", { player_tag: PLAYER, mode: "war" });
  assert.equal(war.excluded.duels, 1);
  assert.ok(war.duel_decks.length > 0);
  assert.ok(war.duel_decks.every((d) => d.mode === "war"));
  const ladder = await call("battles_decks", {
    player_tag: PLAYER,
    mode: "ladder",
  });
  assert.deepEqual(ladder.excluded, { duels: 0, no_deck: 0 });
  assert.deepEqual(ladder.duel_decks, []);
});

test("battles_performance: an event duel is a duel, out of head-to-head and three-crown counts", async () => {
  const event = await call("battles_performance", {
    player_tag: PLAYER,
    mode: "event",
  });
  assert.equal(event.window.battles, 1);
  assert.equal(event.window.duel_battles, 1);
  // Its crowns are summed over three games, so 3 crowns is no sweep.
  assert.equal(event.window.head_to_head_battles, 0);
  assert.equal(event.window.three_crown_rate, null);
});

test("battles_cards: an event duel's rounds are three event games", async () => {
  const event = await call("battles_cards", {
    player_tag: PLAYER,
    mode: "event",
  });
  assert.deepEqual(Object.keys(event.modes_in_window), ["event"]);
  assert.equal(event.modes_in_window.event.battles, 3);
  // Unfiltered, the event games stay in their own group, never in war.
  const all = await call("battles_cards", { player_tag: PLAYER });
  assert.equal(all.modes_in_window.event.battles, 3);
});
