import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { processResult } from "../../ingest/src/pipeline.mjs";
import { emailHash } from "../../auth/src/index.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_tools2_${process.pid}`;
const URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

const OBSERVER = "#JYRQ8U92C"; // colosseum-duel battlelog + profile fixture subject
let db;
let account;
let invoke;

async function fixture(rel) {
  return JSON.parse(
    await readFile(path.join(repoRoot, "fixtures", rel), "utf8"),
  );
}

async function call(name, args = {}) {
  const { body, isError } = await invoke(name, args);
  return { body, isError };
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: URL });
  await db.connect();

  const {
    rows: [acct],
  } = await db.query(
    `insert into account (email_hash, status) values ($1, 'approved')
     returning account_id, email_hash, is_owner, timezone`,
    [emailHash("tools2@example.com")],
  );
  account = {
    accountId: acct.account_id,
    emailHash: acct.email_hash,
    isOwner: acct.is_owner,
    timezone: acct.timezone,
  };
  await db.query(`insert into player (player_tag) values ($1)`, [OBSERVER]);
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary) values ($1, $2, 'verified', true)`,
    [account.accountId, OBSERVER],
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by) values ('player', $1, $2)`,
    [OBSERVER, account.accountId],
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'tools2-gw', '127.0.0.1', 'active') returning gateway_id`,
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
    OBSERVER,
    await fixture("player_battlelog/with_colosseum_duel.json"),
    "2026-09-03T14:30:34Z",
  );
  await send(
    "player",
    OBSERVER,
    await fixture("player/profile.json"),
    "2026-09-01T14:40:34Z",
  );
  const day2 = structuredClone(await fixture("player/profile.json"));
  day2.trophies += 40;
  day2.battleCount += 12;
  await send("player", OBSERVER, day2, "2026-09-03T14:40:34Z");
  await send(
    "cards",
    "GLOBAL",
    await fixture("cards/catalog.json"),
    "2026-09-03T13:00:00Z",
  );

  const registry = makeRegistry();
  invoke = makeInvoker({ db, account, registry });
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("get_player_timeline: daily series with multiple metrics", async () => {
  const { body, isError } = await call("get_player_timeline", {
    metrics: ["trophies", "battle_count"],
  });
  assert.equal(isError, false);
  assert.equal(body.series.length, 2, "two snapshot days");
  assert.ok(body.series[1].trophies > body.series[0].trophies);
  assert.equal(body.series[1].battle_count - body.series[0].battle_count, 12);
});

test("get_performance: window totals reconcile and before_after splits", async () => {
  const { body } = await call("get_performance", {});
  const w = body.window;
  assert.ok(w.battles > 0);
  assert.equal(w.wins + w.losses + w.draws <= w.battles, true);
  assert.ok(typeof w.win_rate === "number");
  assert.ok(Number.isInteger(w.current_streak));

  const split = await call("get_performance", { before_after: "2026-09-01" });
  assert.ok(split.body.before && split.body.after && split.body.split_at);
  assert.equal(
    split.body.before.battles + split.body.after.battles,
    w.battles,
    "the two windows partition the record",
  );
});

test("get_card_performance: mine and opponent perspectives, duels excluded", async () => {
  const mine = await call("get_card_performance", { perspective: "mine" });
  assert.equal(mine.isError, false);
  assert.ok(mine.body.cards.length > 0, "cards attributed");
  for (const c of mine.body.cards) {
    assert.equal(c.battles, c.wins + c.losses);
    assert.ok(c.win_rate >= 0 && c.win_rate <= 1);
  }
  const opp = await call("get_card_performance", { perspective: "opponent" });
  assert.equal(opp.isError, false);
  assert.match(opp.body.note, /OPPONENT/);
});

test("get_deck_performance: grouped by deck_hash with samples", async () => {
  const { body, isError } = await call("get_deck_performance", {});
  assert.equal(isError, false);
  assert.ok(body.decks.length > 0);
  const d = body.decks[0];
  assert.ok(d.deck_hash);
  assert.ok(d.cards.length > 0, "sample deck rides along");
  assert.ok(d.battles >= d.wins + d.losses + d.draws);
  assert.ok(d.first_used <= d.last_used);
});

test("get_collection: API-shaped passthrough of the latest payload", async () => {
  const { body, isError } = await call("get_collection", {});
  assert.equal(isError, false);
  assert.ok(Array.isArray(body.cards) && body.cards.length > 50);
  assert.ok(body.cards[0].id && body.cards[0].name, "API shapes pass through");
  assert.ok(body.collection_level !== undefined);
  // Levels are display-scale: every card caps at 16, none exceeds it.
  assert.ok(body.cards.every((c) => c.maxLevel === 16));
  assert.ok(body.cards.every((c) => c.level <= 16));
  // The profile fixture holds at least one maxed non-common: raw level
  // below 16 that normalizes to exactly 16.
  assert.ok(
    body.cards.some((c) => c.level === 16),
    "maxed cards read 16 like the game shows",
  );
});

test("get_card_catalog: served from the recorded GLOBAL payload", async () => {
  const { body, isError } = await call("get_card_catalog", {});
  assert.equal(isError, false);
  assert.ok(Array.isArray(body.cards) && body.cards.length > 100);
  assert.ok(Array.isArray(body.tower_troops) && body.tower_troops.length > 0);
});

test("cr_api_live: allowlist validation, then honest live_unavailable", async () => {
  const bad = await call("cr_api_live", { path: "/locations/global/rankings" });
  assert.equal(bad.body.error.code, "bad_request");
  const badTag = await call("cr_api_live", { path: "/players/NOT-A-TAG!" });
  assert.equal(badTag.body.error.code, "invalid_tag");
  const crossed = await call("cr_api_live", {
    path: "/clans/#J2RGCRVG/battlelog",
  });
  assert.equal(crossed.body.error.code, "bad_request");
  const ok = await call("cr_api_live", { path: "/players/#20JJJ2CCRU" });
  assert.equal(ok.body.error.code, "live_unavailable");
});

test("the V1 tools remain declared among the full registry", () => {
  const names = makeRegistry()
    .declarations()
    .map((d) => d.name);
  for (const required of [
    "cr_api_live",
    "get_card_catalog",
    "get_card_performance",
    "get_collection",
    "get_coverage",
    "get_deck_performance",
    "get_performance",
    "get_player",
    "get_player_timeline",
    "query_battles",
    "list_my_players",
  ]) {
    assert.ok(names.includes(required), required);
  }
});

test("round-1 tester fixes: inverted windows refuse; compact drops decks; null cursor ends pages", async () => {
  const inverted = await call("query_battles", {
    from: "2026-09-10",
    to: "2026-09-01",
  });
  assert.equal(inverted.body.error.code, "bad_request");
  assert.match(inverted.body.error.message, /inverted/);

  const compactRes = await call("query_battles", {
    limit: 2,
    verbosity: "compact",
  });
  assert.equal(compactRes.isError, false);
  assert.ok(
    compactRes.body.battles[0].me.deck === undefined,
    "compact drops decks",
  );
  assert.ok(compactRes.body.battles[0].me.deck_hash, "hash stays");

  const short = await call("query_battles", { limit: 50 });
  assert.equal(short.body.next_cursor, null, "explicit null on final page");

  const perf = await call("get_performance", {
    before_after: "2026-09-01",
    compare_from: "2026-08-01",
  });
  assert.match(perf.body.note, /compare_from\/compare_to were ignored/);
  assert.ok(perf.body.filters_applied, "filters echoed");

  const tl = await call("get_player_timeline", { from: "2026-05-01" });
  assert.ok(tl.body.snapshots_available_from, "epoch disclosed");
});
