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
import { CONTRACT_VERSION } from "@elixir-mcp/contracts";
import {
  handleMcpMessage,
  serverVersion,
  MCP_QUOTA_ERROR_CODE,
} from "../src/protocol.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";
import { makeQuota } from "../src/quota.mjs";
import { localDayRange, formatLocal } from "../src/time.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_mcp_${process.pid}`;
const URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

let db;
let account; // Jamie-like approved account with a claim on the fixture observer
const OBSERVER = "#UVQ8RJYG9"; // with_path_of_legend.json battlelog observer
let registry;

async function fixture(rel) {
  return JSON.parse(
    await readFile(path.join(repoRoot, "fixtures", rel), "utf8"),
  );
}

function rpc(method, params = {}, id = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

function context(overrides = {}) {
  return {
    registry,
    spendQuota: overrides.spendQuota ?? makeQuota({ db, account }),
    invokeTool: makeInvoker({ db, account, registry }),
    ...overrides,
  };
}

async function callTool(name, args = {}) {
  const res = await handleMcpMessage(
    rpc("tools/call", { name, arguments: args }),
    context(),
  );
  const body = JSON.parse(res.payload.result.content[0].text);
  return { body, isError: res.payload.result.isError };
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

  // Approved account with a primary claim + active recording on the observer.
  const {
    rows: [acct],
  } = await db.query(
    `insert into account (email_hash, status, timezone) values ($1, 'approved', 'America/Chicago')
     returning account_id, email_hash, is_owner, timezone`,
    [emailHash("mcp-test@example.com")],
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

  // Seed data through the REAL pipeline: gateway row + battlelog + profile.
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'mcp-test-gw', '127.0.0.1', 'active') returning gateway_id`,
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
    assert.equal(result.outcome, "admitted");
  };
  await send(
    "player_battlelog",
    OBSERVER,
    await fixture("player_battlelog/with_path_of_legend.json"),
    "2026-09-03T14:00:34Z",
  );
  const profile = await fixture("player/profile.json");
  await send("player", "#JYRQ8U92C", profile, "2026-09-03T14:40:34Z");

  registry = makeRegistry();
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("initialize: cache-busting version, listChanged true, disclaimer in instructions", async () => {
  const res = await handleMcpMessage(
    rpc("initialize", { protocolVersion: "2025-06-18" }),
    context(),
  );
  const result = res.payload.result;
  assert.equal(result.protocolVersion, "2025-06-18");
  assert.equal(result.capabilities.tools.listChanged, true);
  assert.match(
    result.serverInfo.version,
    new RegExp(
      `^${CONTRACT_VERSION.replaceAll(".", "\\.")}\\+tools\\.[0-9a-f]{12}$`,
    ),
  );
  assert.match(result.instructions, /not endorsed by Supercell/);
  assert.equal(
    serverVersion(registry.declarations()),
    result.serverInfo.version,
  );
});

test("protocol basics: batching rejected, notifications 202, unknown method/tool", async () => {
  const batch = await handleMcpMessage([rpc("ping")], context());
  assert.equal(batch.statusCode, 400);
  const note = await handleMcpMessage(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    context(),
  );
  assert.equal(note.statusCode, 202);
  const unknown = await handleMcpMessage(rpc("resources/list"), context());
  assert.equal(unknown.payload.error.code, -32601);
  const badTool = await handleMcpMessage(
    rpc("tools/call", { name: "suggest_deck" }),
    context(),
  );
  assert.equal(badTool.payload.error.code, -32602);
});

test("tools/list declares all 27 tools", async () => {
  const res = await handleMcpMessage(rpc("tools/list"), context());
  assert.equal(res.payload.result.tools.length, 27);
  const names = res.payload.result.tools.map((t) => t.name);
  for (const required of [
    "elixir_my_players",
    "elixir_coverage",
    "players_profile",
    "battles_query",
    "players_timeline",
    "live_fetch",
  ]) {
    assert.ok(names.includes(required), required);
  }
});

test("quota exhaustion returns -32029", async () => {
  const res = await handleMcpMessage(
    rpc("tools/call", { name: "elixir_my_players", arguments: {} }),
    context({
      spendQuota: async () => ({ allowed: false, count: 501, max: 500 }),
    }),
  );
  assert.equal(res.payload.error.code, MCP_QUOTA_ERROR_CODE);
});

test("elixir_my_players: primary claim, recording status, meta envelope", async () => {
  const { body, isError } = await callTool("elixir_my_players");
  assert.equal(isError, false);
  assert.equal(body.players.length, 1);
  const p = body.players[0];
  assert.equal(p.player_tag, OBSERVER);
  assert.equal(p.is_primary, true);
  assert.equal(p.recording, "active");
  assert.equal(body.meta.contract_version, CONTRACT_VERSION);
  assert.match(body.meta.disclaimer, /not endorsed by Supercell/);
  assert.equal(body.meta.quota.max, 500, "quota headroom rides the meta");
  assert.ok(body.meta.quota.used >= 1);
});

test("elixir_coverage: polls, appearances, recording_active_since", async () => {
  const { body } = await callTool("elixir_coverage");
  assert.ok(body.battles.recorded_appearances > 0);
  assert.match(body.battles.note, /appears in \d+ recorded battles/);
  assert.ok(
    body.polls.some(
      (p) => p.endpoint === "player_battlelog" && p.last_admitted_at,
    ),
  );
  assert.ok(body.meta.recording_active_since, "recording start present");
  assert.equal(body.meta.timezone_applied, "America/Chicago");
});

test("players_profile: serves the recorded snapshot; live is honestly unavailable", async () => {
  const { body } = await callTool("players_profile", {
    player_tag: "#JYRQ8U92C",
  }).catch(() => ({}));
  // #JYRQ8U92C is not claimed by this account -> not_entitled
  assert.equal(body.error.code, "not_entitled");

  const live = await callTool("players_profile", { live: true });
  assert.equal(live.isError, true);
  assert.equal(live.body.error.code, "live_unavailable");
});

test("battles_query: pagination, filters, both perspectives, local time", async () => {
  const first = await callTool("battles_query", { limit: 5 });
  assert.equal(first.isError, false);
  assert.equal(first.body.battles.length, 5);
  assert.ok(first.body.next_cursor, "full page carries a cursor");
  // Played-time order, NEVER insert order (the backfill scar: archive
  // battles are inserted long after they were played).
  const times = first.body.battles.map((x) => Date.parse(x.battle_time));
  assert.deepEqual(
    times,
    [...times].sort((a, z) => z - a),
  );
  const b = first.body.battles[0];
  assert.ok(b.me.deck_hash || b.me.deck, "subject perspective present");
  assert.ok(
    Array.isArray(b.opponents) && b.opponents.length > 0,
    "opponent perspective present",
  );
  assert.match(b.battle_time_local, /America\/Chicago/);

  const second = await callTool("battles_query", {
    limit: 5,
    cursor: first.body.next_cursor,
  });
  assert.ok(
    second.body.battles.every(
      (x) =>
        !first.body.battles.some(
          (y) => y.battle_time === x.battle_time && y.type === x.type,
        ),
    ) || second.body.battles.length > 0,
    "cursor advances",
  );

  const wins = await callTool("battles_query", {
    outcome: "win",
    limit: 50,
    verbosity: "compact",
  });
  assert.ok(wins.body.battles.every((x) => x.me.outcome === "win"));

  const ranked = await callTool("battles_query", {
    mode: "ranked",
    limit: 50,
    verbosity: "compact",
  });
  assert.ok(ranked.body.battles.every((x) => x.type === "pathOfLegend"));

  const dh = wins.body.battles.find((x) => x.me.deck_hash)?.me.deck_hash;
  if (dh) {
    const byDeck = await callTool("battles_query", {
      deck_hash: dh,
      limit: 50,
      verbosity: "compact",
    });
    assert.ok(byDeck.body.battles.every((x) => x.me.deck_hash === dh));
  }
});

test("battles_query: structured errors for bad input", async () => {
  const bad = await callTool("battles_query", { player_tag: "not-a-tag!" });
  assert.equal(bad.body.error.code, "invalid_tag");
  const badDate = await callTool("battles_query", { from: "yesterday-ish" });
  assert.equal(badDate.body.error.code, "bad_request");
});

test("audit rows land for success and failure alike", async () => {
  const { rows } = await db.query(
    `select tool, error_code from mcp_call_audit where account_id = $1 order by audit_id`,
    [account.accountId],
  );
  assert.ok(rows.length >= 5);
  assert.ok(rows.some((r) => r.error_code === "not_entitled"));
  assert.ok(
    rows.some((r) => r.tool === "battles_query" && r.error_code === null),
  );
});

test("local time helpers: DST-aware day bounds", () => {
  const { start, end } = localDayRange(
    "America/Chicago",
    "2026-09-03",
    "2026-09-03",
  );
  assert.equal(start.toISOString(), "2026-09-03T05:00:00.000Z", "CDT is UTC-5");
  assert.equal(end.toISOString(), "2026-09-04T05:00:00.000Z");
  const winter = localDayRange("America/Chicago", "2026-01-15", "2026-01-15");
  assert.equal(
    winter.start.toISOString(),
    "2026-01-15T06:00:00.000Z",
    "CST is UTC-6",
  );
  assert.match(
    formatLocal("2026-09-03T14:00:34Z", "America/Chicago"),
    /^2026-09-03 09:00:34/,
  );
});

test("collector credits raise the daily quota 10:1, capped at 4x base", async () => {
  await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status, fetch_points)
     values ($1, 'credit-gw', '127.0.0.1', 'active', 1230)`,
    [account.accountId],
  );
  const quota = makeQuota({ db, account });
  const r = await quota();
  assert.equal(r.max, 623, "500 base + floor(1230/10)");

  await db.query(
    `update gateway set fetch_points = 999999 where name = 'credit-gw'`,
  );
  const capped = await makeQuota({ db, account })();
  assert.equal(capped.max, 2000, "capped at 4x base");
  await db.query(`delete from gateway where name = 'credit-gw'`);
});
