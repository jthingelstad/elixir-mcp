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

  // 6.17.0: an event-tagged battle is `event`, whatever its type. It used
  // to fold into `casual`, which filed the Seasonal Trophy Road as casual
  // play and pooled a fortnight's tournament with ordinary friendlies.
  const events = await call("battles_query", {
    player_tag: EVENTS,
    mode: "event",
    limit: 25,
  });
  const event = events.battles.find((b) => b.context.event_tag !== null);
  assert.ok(event, "an event battle names its event");
  assert.match(event.context.event_tag, /^#/);
  assert.equal(event.mode_group, "event");
  assert.ok(
    events.battles.every((b) => b.context.event_tag !== null),
    "mode: event selects exactly the event-tagged battles",
  );
  // And the old bucket no longer claims them.
  const casual = await call("battles_query", {
    player_tag: EVENTS,
    mode: "casual",
    limit: 25,
  });
  assert.ok(
    (casual.battles ?? []).every((b) => b.context.event_tag === null),
    "casual no longer carries event content",
  );
  // A drafted deck is orthogonal to the event split - a draft happens in
  // a friendly too - so it is found across both groups, and it is the
  // other half of what the meta must not count.
  const drafted = [...events.battles, ...(casual.battles ?? [])].find(
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

test("clans_roster carries the clan's type, location and description; clans_timeline serves type and location_id on request (Phase 2 item 6)", async () => {
  const clanTag = PROFILE.clan.tag;
  await db.query(
    "update clan set type = 'inviteOnly', location_id = 57000006, description = 'Fun. Wars. POAPs.' where clan_tag = $1",
    [clanTag],
  );
  const full = await call("clans_roster", { clan_tag: clanTag });
  assert.equal(full.type, "inviteOnly");
  assert.equal(full.location_id, 57000006);
  assert.equal(full.description, "Fun. Wars. POAPs.");
  const compact = await call("clans_roster", {
    clan_tag: clanTag,
    verbosity: "compact",
  });
  assert.equal(compact.type, "inviteOnly");
  assert.equal(compact.description, "Fun. Wars. POAPs.");

  await db.query(
    `insert into clan_snapshot_daily (clan_tag, day, snapshot_kind, observed_at, clan_score, members, type, location_id)
     values ($1, current_date - 1, 'daily', now() - interval '1 day', 50000, 46, 'inviteOnly', 57000006)`,
    [clanTag],
  );
  const series = await call("clans_timeline", {
    clan_tag: clanTag,
    days: 3,
    metrics: ["members", "type", "location_id"],
  });
  assert.equal(series.series.length, 1);
  assert.equal(series.series[0].type, "inviteOnly");
  assert.equal(series.series[0].location_id, 57000006);
  const defaults = await call("clans_timeline", { clan_tag: clanTag, days: 3 });
  assert.ok(
    !("type" in defaults.series[0]),
    "an attribute is asked for, never default",
  );
});

// 6.16.0: the two fields 0151 started recording reach the wire. The duel
// one is the point - Elixir told players a duel's tower hitpoints were
// the final round's and that it had no differential, which described the
// record rather than the game.
test("a duel's per-round results reach the wire, with a per-round differential", async () => {
  const full = await call("battles_query", {
    player_tag: BOATS,
    mode: "war",
    limit: 25,
  });
  const duel = full.battles.find((b) => b.type === "riverRaceDuel");
  assert.ok(duel, "the fixture's duel is served");

  // The summed values still say what they always said.
  assert.equal(duel.me.elixir.differential, null, "a summed duel has none");
  assert.ok(duel.me.rounds_played >= 2);

  // And the rounds now answer for themselves.
  assert.ok(Array.isArray(duel.me.rounds), "rounds[] rides the duel row");
  assert.equal(duel.me.rounds.length, duel.me.rounds_played, "one per game");
  for (const r of duel.me.rounds) {
    assert.ok(Number.isInteger(r.round) && r.round >= 1);
    assert.ok("crowns" in r && "tower_hp" in r && "elixir" in r);
    assert.equal(
      r.elixir.caveat,
      undefined,
      "the caveat rides the row once, not every round",
    );
  }
  // The round numbers line up with the decks already served per round.
  assert.deepEqual(
    duel.me.rounds.map((r) => r.round),
    duel.me.deck.rounds.map((_, i) => i + 1),
    "round results and round decks share their numbering",
  );
  // The thing the docs said could not be computed.
  const withBoth = duel.me.rounds.filter(
    (r) => r.elixir.leaked !== null && r.elixir.opponent_leaked !== null,
  );
  assert.ok(withBoth.length > 0, "a round has both sides' leak");
  for (const r of withBoth)
    assert.equal(
      r.elixir.differential,
      Number((r.elixir.leaked - r.elixir.opponent_leaked).toFixed(2)),
      `round ${r.round} differential`,
    );
  // A non-duel row carries none of this.
  const boat = full.battles.find((b) => b.type === "boatBattle");
  assert.ok(!("rounds" in boat.me), "rounds[] is duel-only");
  // The note tells a reader to prefer it for a single game.
  assert.match(
    full.notes.join(" "),
    /rounds\[\] carries each GAME's own result/,
  );
});

test("global_rank rides every participant and is null when unranked", async () => {
  const full = await call("battles_query", {
    player_tag: BOATS,
    mode: "war",
    limit: 25,
  });
  for (const b of full.battles) {
    assert.ok("global_rank" in b.me, "on me");
    for (const o of b.opponents) assert.ok("global_rank" in o, "on opponents");
  }
  // The fixture's players are not globally ranked, so it reads null
  // rather than zero - the distinction the note insists on.
  assert.ok(full.battles.every((b) => b.me.global_rank === null));
  assert.match(full.notes.join(" "), /global_rank is the player's global/);
});

// 6.18.0: the comparisons the row always held both halves of, and what
// the signature proves about the battle's length. Jamie 2026-09-22:
// "elixir leaked for example is most meaningful in a comparison between".
test("me.vs carries the differences, as me minus the one opponent", async () => {
  const full = await call("battles_query", {
    player_tag: BOATS,
    limit: 25,
  });
  const h2h = full.battles.find(
    (b) =>
      b.opponents.length === 1 && !String(b.type).startsWith("riverRaceDuel"),
  );
  assert.ok(h2h, "a head-to-head row");
  assert.ok(h2h.me.vs, "vs rides the row");
  // Every field is me MINUS them, and reproduces from the two sides.
  const opp = h2h.opponents[0];
  assert.equal(h2h.me.vs.crowns, h2h.me.crowns - opp.crowns, "crown margin");
  const towers = (r) =>
    r.tower_hp
      ? (r.tower_hp.king ?? 0) +
        (r.tower_hp.princess ?? []).reduce((a, b) => a + b, 0)
      : null;
  if (towers(h2h.me) !== null && towers(opp) !== null)
    assert.equal(
      h2h.me.vs.tower_hp,
      towers(h2h.me) - towers(opp),
      "tower hitpoints remaining, as a margin",
    );
  // A duel has no single pairing to compare.
  const duel = full.battles.find((b) =>
    String(b.type).startsWith("riverRaceDuel"),
  );
  if (duel) assert.equal(duel.me.vs, null, "a duel has no single differential");
  assert.match(full.notes.join(" "), /me\.vs is every comparison/);
});

test("inferred.duration bounds the battle from its crown pair, and says which rule fired", async () => {
  const full = await call("battles_query", {
    player_tag: BOATS,
    limit: 25,
  });
  const h2h = full.battles.filter(
    (b) =>
      ["PvP", "pathOfLegend", "riverRacePvP"].includes(b.type) &&
      b.opponents.length === 1,
  );
  assert.ok(h2h.length > 0, "head-to-head rows to reason about");
  for (const b of h2h) {
    const d = b.inferred.duration;
    assert.ok(d && d.basis, `${b.battle_id} carries a basis`);
    const mine = b.me.crowns;
    const theirs = b.opponents[0].crowns;
    if (mine === 3 || theirs === 3) {
      // A King Tower fell: it ended then, and nothing bounds it below.
      assert.equal(d.at_least_s, null);
      assert.equal(d.at_most_s, 300);
      assert.equal(d.basis, "king_tower_fell");
    } else if (mine === theirs) {
      assert.equal(d.exact_s, 300, "level crowns is exactly five minutes");
      assert.equal(d.basis, "overtime_expired");
    } else {
      assert.equal(d.at_least_s, 180, "no King Tower means regulation ran");
      assert.equal(d.at_most_s, 300);
      assert.equal(d.exact_s, null);
    }
  }
  // Not claimed where the rules do not hold.
  const duel = full.battles.find((b) =>
    String(b.type).startsWith("riverRaceDuel"),
  );
  if (duel) assert.equal(duel.inferred.duration, null, "a duel sums crowns");
  const boat = full.battles.find((b) => b.type === "boatBattle");
  if (boat)
    assert.equal(boat.inferred.duration, null, "a boat battle has no overtime");
  assert.match(
    full.notes.join(" "),
    /inferred\.duration is what the battle's signature PROVES/,
  );
});
