/**
 * The record reaches the wire (interface review 2026-09-19, Part 1.3;
 * Phase 2 of the execution brief, contract 3.15.0): every collected
 * column an agent would ask about is served on the tool that owns the
 * question. Real fixtures through the real pipeline, then the tools.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { processResult } from "../../ingest/src/pipeline.mjs";
import { makeRegistry } from "../src/tools.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_record_wire_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

const BOATS = "#2YG98VVQ"; // with_boat_and_duel.json
const EVENTS = "#VGC22YGP"; // with_clanmate_2v2.json: eventTag, draft picks

let db;
let account;
const registry = makeRegistry();
const call = (name, args = {}) => registry.invoke(name, { db, account }, args);
const fixture = async (rel) =>
  JSON.parse(await readFile(path.join(repoRoot, "fixtures", rel), "utf8"));

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
  const {
    rows: [acct],
  } = await db.query(
    `insert into account (email_hash, status, is_owner) values ('record-wire', 'approved', true)
     returning account_id`,
  );
  account = {
    accountId: acct.account_id,
    isOwner: true,
    timezone: "UTC",
    kind: "person",
    role: "member",
  };
  for (const tag of [BOATS, EVENTS]) {
    await db.query(
      "insert into player (player_tag) values ($1) on conflict do nothing",
      [tag],
    );
    await db.query(
      `insert into recording (subject_type, subject_tag, requested_by) values ('player', $1, $2)`,
      [tag, account.accountId],
    );
  }
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'record-wire-gw', '127.0.0.1', 'active') returning gateway_id`,
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
    "player_battlelog",
    BOATS,
    await fixture("player_battlelog/with_boat_and_duel.json"),
    "2026-09-02T08:00:49Z",
  );
  await send(
    "player_battlelog",
    EVENTS,
    await fixture("player_battlelog/with_clanmate_2v2.json"),
    "2026-09-02T11:10:50Z",
  );
  // A profile poll in September writes the August final once, and the
  // three frozen counters onto the player.
  const profile = await fixture("player/profile.json");
  await send("player", profile.tag, profile, "2026-09-03T14:40:34Z");
  PROFILE = profile;
});
let PROFILE;

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("battles_query rows carry mode_group, context and, on a boat battle, boat (Phase 2 item 1, 8)", async () => {
  const boats = await call("battles_query", {
    player_tag: BOATS,
    mode: "war",
    limit: 50,
    verbosity: "compact",
  });
  // Compact: mode_group and deck_selection ride, context and boat do not.
  assert.ok(boats.battles.length >= 5);
  assert.ok(boats.battles.every((b) => b.mode_group === "war"));
  assert.ok(boats.battles.every((b) => "deck_selection" in b));
  assert.ok(boats.battles.every((b) => !("context" in b) && !("boat" in b)));
  const duel = boats.battles.find((b) => b.type === "riverRaceDuel");
  assert.equal(duel.deck_selection, "warDeckPick");

  const full = await call("battles_query", {
    player_tag: BOATS,
    mode: "war",
    limit: 25,
  });
  const boat = full.battles.find((b) => b.type === "boatBattle");
  assert.deepEqual(boat.context, {
    event_tag: null,
    tournament_tag: null,
    ladder_tournament: false,
    hosted: false,
    deck_selection: "collection",
  });
  assert.equal(boat.boat.side, "attacker");
  assert.ok(Number.isInteger(boat.boat.towers_before));
  assert.ok(Number.isInteger(boat.boat.towers_after));
  assert.ok(Number.isInteger(boat.boat.remaining));
  assert.ok(!("deck_selection" in boat), "full keeps it inside context");
  const pvp = full.battles.find((b) => b.type === "riverRacePvP");
  assert.equal(pvp.boat, undefined, "boat only on boat battles");

  const events = await call("battles_query", {
    player_tag: EVENTS,
    mode: "casual",
    limit: 25,
  });
  const event = events.battles.find((b) => b.context.event_tag !== null);
  assert.ok(event, "an event battle names its event");
  assert.match(event.context.event_tag, /^#/);
  assert.equal(event.mode_group, "casual");
  const drafted = events.battles.find(
    (b) => b.context.deck_selection === "draft",
  );
  assert.ok(drafted, "a drafted deck says so");
});

test("players_profile carries the Path of Legends finals and the frozen counters; clans_roster.lifetime the counters (Phase 2 items 4, 5)", async () => {
  const tag = PROFILE.tag;
  const finals = await db.query(
    "select season_month, league, trophies, rank from player_pol_season where player_tag = $1",
    [tag],
  );
  assert.equal(finals.rows.length, 1, "the poll wrote one final");
  // A second, older final, so the order and the cap are visible.
  await db.query(
    `insert into player_pol_season (player_tag, season_month, league, trophies, rank, observed_at)
     values ($1, '2026-06', 5, 1200, 8000, now())`,
    [tag],
  );
  const profile = await call("players_profile", { player_tag: tag });
  const seasons = profile.snapshot.path_of_legend.seasons;
  assert.equal(seasons.length, 2);
  assert.equal(seasons[0].season_month, finals.rows[0].season_month);
  assert.deepEqual(seasons[1], {
    season_month: "2026-06",
    league: 5,
    trophies: 1200,
    rank: 8000,
  });
  assert.deepEqual(profile.snapshot.path_of_legend.current, {
    leagueNumber: 1,
    trophies: 0,
    rank: null,
  });
  assert.equal(profile.attributes.war_day_wins, PROFILE.warDayWins);
  assert.equal(
    profile.attributes.clan_cards_collected,
    PROFILE.clanCardsCollected,
  );
  assert.equal(
    profile.attributes.legacy_trophy_road_high_score,
    PROFILE.legacyTrophyRoadHighScore,
  );
  assert.match(profile.notes.join(" "), /path_of_legend.seasons/);

  // The roster's lifetime block carries the same counters.
  await db.query(
    "insert into clan (clan_tag, name) values ($1, 'POAP KINGS') on conflict do nothing",
    [PROFILE.clan.tag],
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by) values ('clan', $1, $2)`,
    [PROFILE.clan.tag, account.accountId],
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
     values ($1, $2, now(), 'elder') on conflict do nothing`,
    [PROFILE.clan.tag, tag],
  );
  const roster = await call("clans_roster", { clan_tag: PROFILE.clan.tag });
  const me = roster.members.find((m) => m.player_tag === tag);
  assert.equal(
    me.lifetime.legacy_trophy_road_high_score,
    PROFILE.legacyTrophyRoadHighScore,
  );
  assert.equal(me.lifetime.war_day_wins, PROFILE.warDayWins);
  assert.equal(me.lifetime.clan_cards_collected, PROFILE.clanCardsCollected);
});
