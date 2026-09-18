import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "../../migrate/src/migrate.mjs";
import { makeInvoker } from "../src/invoker.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { seedPlayedDeck, seedDeck, hashFor } from "./deck-rows.mjs";
import { makeHandler } from "../src/handler.mjs";
import { createHash } from "node:crypto";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_query_budget_${process.pid}`;
let db;
let account;

before(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = adminUrl.replace(/\/postgres$/, `/${name}`);
  await migrate({
    databaseUrl: url,
    migrationsDir: path.join(root, "db/migrations"),
  });
  db = new pg.Client({ connectionString: url });
  await db.connect();
  const { rows } = await db.query(
    "insert into account (email_hash, status) values ('query-budget', 'approved') returning account_id",
  );
  account = { accountId: rows[0].account_id };
});

after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database ${name} with (force)`);
  await admin.end();
});

test("slow aggregation is canceled, answered with a reportable timeout, and audited", async () => {
  const invoke = makeInvoker({
    db,
    account,
    queryBudgetMs: 150,
    registry: {
      invoke: async (_name, ctx) => {
        await ctx.db.query("select pg_sleep(1)");
        return { ok: true };
      },
    },
  });
  const start = Date.now();
  const result = await invoke("battles_meta_decks", { limit: 5 });
  assert.equal(result.isError, true);
  assert.equal(result.body.error.code, "query_timeout");
  assert.equal(result.body.error.class, "retry");
  assert.match(result.body.error.hint, /battles_meta_decks\(/);
  assert.ok(
    Date.now() - start < 900,
    "the server cancels the query rather than merely abandoning its promise",
  );
  const { rows } = await db.query(
    "select request_id, error_code from mcp_call_audit order by created_at desc limit 1",
  );
  assert.equal(rows[0].error_code, "query_timeout");
  assert.equal(rows[0].request_id, result.body.meta.request_id);
  assert.equal(
    (await db.query("show statement_timeout")).rows[0].statement_timeout,
    "0",
  );
  assert.equal((await db.query("select 1 as n")).rows[0].n, 1);
});

test("the budget covers the whole aggregation, not one independent allowance per query", async () => {
  const invoke = makeInvoker({
    db,
    account,
    queryBudgetMs: 300,
    registry: {
      invoke: async (_name, ctx) => {
        await ctx.db.query("select pg_sleep(0.18)");
        await ctx.db.query("select pg_sleep(0.18)");
        return { ok: true };
      },
    },
  });
  const result = await invoke("battles_meta_cards", {});
  assert.equal(result.body.error.code, "query_timeout");
});

test("successful aggregation restores the connection timeout", async () => {
  const invoke = makeInvoker({
    db,
    account,
    queryBudgetMs: 1000,
    registry: {
      invoke: async (_name, ctx) =>
        (await ctx.db.query("select 1 as n")).rows[0],
    },
  });
  assert.equal((await invoke("clans_standings", {})).isError, false);
  assert.equal(
    (await db.query("show statement_timeout")).rows[0].statement_timeout,
    "0",
  );
});

test("the analytical budget never interrupts an account mutation", async () => {
  const statements = [];
  const fake = {
    query: async (sql) => {
      statements.push(sql);
      return { rows: [] };
    },
  };
  const invoke = makeInvoker({
    db: fake,
    account,
    queryBudgetMs: 1,
    registry: {
      invoke: async (_name, ctx) => {
        await ctx.db.query("account write");
        return { ok: true };
      },
    },
  });
  assert.equal((await invoke("elixir_nickname", {})).isError, false);
  assert.ok(statements.every((sql) => !sql.includes("statement_timeout")));
});

test("the Lambda deadline answers a slow read tool with query_timeout and audits it as timeout", async () => {
  const invoke = makeInvoker({
    db,
    account,
    deadlineMs: 150,
    registry: {
      invoke: async (_name, ctx) => {
        await ctx.db.query("select pg_sleep(1)");
        return { ok: true };
      },
    },
  });
  const start = Date.now();
  // Not an analytical tool: before 3.14.0 nothing cancelled it and the
  // client saw a bare HTTP 500 (review 2026-09-19, defect 1).
  const result = await invoke("war_current", {});
  assert.equal(result.isError, true);
  assert.equal(result.body.error.code, "query_timeout");
  assert.ok(result.body.meta.request_id);
  assert.ok(Date.now() - start < 900, "cancelled in PostgreSQL, not abandoned");
  const { rows } = await db.query(
    "select request_id, error_code from mcp_call_audit order by created_at desc limit 1",
  );
  assert.equal(rows[0].error_code, "timeout");
  assert.equal(rows[0].request_id, result.body.meta.request_id);
  assert.equal(
    (await db.query("show statement_timeout")).rows[0].statement_timeout,
    "0",
  );
  assert.equal((await db.query("select 1 as n")).rows[0].n, 1);
});

test("the deadline covers work outside the database, such as a live-lane wait", async () => {
  const invoke = makeInvoker({
    db,
    account,
    deadlineMs: 100,
    registry: {
      invoke: async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        return { ok: true };
      },
    },
  });
  const start = Date.now();
  const result = await invoke("clans_roster", { live: true });
  assert.equal(result.body.error.code, "query_timeout");
  assert.ok(Date.now() - start < 500);
  const { rows } = await db.query(
    "select error_code from mcp_call_audit order by created_at desc limit 1",
  );
  assert.equal(rows[0].error_code, "timeout");
});

test("the deadline never races an account write", async () => {
  const invoke = makeInvoker({
    db,
    account,
    deadlineMs: 50,
    registry: {
      invoke: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { ok: true };
      },
    },
  });
  const result = await invoke("elixir_nickname", {});
  assert.equal(result.isError, false);
});

test("an analytical tool under both guards audits the one that fired", async () => {
  const invoke = makeInvoker({
    db,
    account,
    queryBudgetMs: 5000,
    deadlineMs: 120,
    registry: {
      invoke: async (_name, ctx) => {
        await ctx.db.query("select pg_sleep(1)");
        return { ok: true };
      },
    },
  });
  const result = await invoke("war_history", {
    season_id: 1,
    section_index: 0,
  });
  assert.equal(result.body.error.code, "query_timeout");
  const { rows } = await db.query(
    "select error_code from mcp_call_audit order by created_at desc limit 1",
  );
  assert.equal(rows[0].error_code, "timeout");
});

test("the real MCP handler shortens the budget to leave Lambda reply time", async () => {
  const key = "svt_query_budget_fixture";
  await db.query(
    "insert into service_token (account_id, name, token_hash) values ($1, 'query-budget-test', $2)",
    [account.accountId, createHash("sha256").update(key).digest("hex")],
  );
  const handler = makeHandler({
    databaseUrl: adminUrl.replace(/\/postgres$/, `/${name}`),
  });
  const res = await handler(
    {
      rawPath: "/mcp",
      requestContext: { http: { method: "POST" } },
      headers: { authorization: `Bearer ${key}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "battles_meta_decks", arguments: {} },
      }),
    },
    { getRemainingTimeInMillis: () => 6500 },
  );
  assert.equal(res.statusCode, 200);
  const result = JSON.parse(res.body).result;
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, "query_timeout");
  assert.ok(result.structuredContent.meta.request_id);
});

test("an unrecorded rival roster names the exact live retry without changing recording", async () => {
  const result = await makeInvoker({ db, account, registry: makeRegistry() })(
    "clans_roster",
    { clan_tag: "#YYYYYYYY", verbosity: "compact" },
  );
  assert.equal(result.body.error.code, "not_recorded");
  assert.match(
    result.body.error.hint,
    /clans_roster\(\{"clan_tag":"#YYYYYYYY","verbosity":"compact","live":true\}\)/,
  );
  assert.equal(
    (await db.query("select count(*)::int as n from recording")).rows[0].n,
    0,
  );
});

test("corpus meta reuses its population scan for the unchanged shrinkage prior", async () => {
  for (const tool of ["battles_meta_decks", "battles_meta_cards"]) {
    const scans = [];
    const observed = {
      query: async (sql, params) => {
        if (sql.includes("from battle_participant bp")) scans.push(sql);
        return db.query(sql, params);
      },
    };
    const result = await makeInvoker({
      db: observed,
      account,
      registry: makeRegistry(),
    })(tool, {});
    assert.equal(result.isError, false);
    assert.equal(result.body.prior_basis, "neutral_0.5");
    assert.equal(
      scans.length,
      2,
      "one population/prior scan plus one grouping scan, not a third corpus scan",
    );
    assert.ok(
      scans.every((sql) => !sql.includes("array_agg(bp.deck ")),
      "deck exemplars must not aggregate every full deck JSON before the result limit",
    );
  }
});

test("limited deck meta renders the identity from deck_card and the catalog, never from any participant's JSON", async () => {
  const owner = "#YYYYYYYY";
  const other = "#22222222";
  await db.query("insert into player (player_tag) values ($1),($2)", [
    owner,
    other,
  ]);
  for (const [id, tag, ago, label] of [
    ["exemplar-old", owner, 24, "Old name"],
    ["exemplar-latest", owner, 1, "Scope latest"],
    ["exemplar-outsider", other, 0, "Outside segment"],
  ]) {
    const at = new Date(Date.now() - ago * 3600_000);
    await db.query(
      "insert into battle (battle_id, battle_time, type, type_class) values ($1,$2,'PvP','pvp')",
      [id, at],
    );
    // Three participants play the one deck; the label each carried is
    // not the answer - the catalog names the identity's cards.
    const cards = [{ id: 26000000, name: label, evolutionLevel: 1 }];
    const supportCards = [{ id: 159000000, name: "Tower Princess" }];
    await seedDeck(db, { battle_time: at, cards, supportCards });
    await db.query(
      "insert into battle_participant (battle_id, player_tag, battle_time, side, outcome, deck_hash, type, type_class) values ($1,$2,$3,0,'win',$4,'PvP','pvp')",
      [id, tag, at, hashFor(cards, supportCards[0].id)],
    );
    await seedPlayedDeck(db, {
      battle_id: id,
      player_tag: tag,
      battle_time: at,
      cards,
      supportCards,
    });
  }
  await db.query(
    `insert into card (card_id, name, kind) values (26000000, 'Knight', 'card'), (159000000, 'Tower Princess', 'support')
     on conflict (card_id) do update set name = excluded.name, catalog_seen_at = now()`,
  );
  const result = await makeRegistry().invoke(
    "battles_meta_decks",
    { db, account },
    { segment: { player_tag: owner }, min_battles: 1, limit: 1 },
  );
  assert.equal(result.decks.length, 1);
  assert.equal(result.decided_battles, 2);
  assert.deepEqual(result.decks[0].cards, [
    { id: 26000000, name: "Knight", evolution: 1 },
  ]);
  assert.deepEqual(result.decks[0].tower_troop, {
    id: 159000000,
    name: "Tower Princess",
  });
  assert.ok(
    !("exemplar" in result.decks[0]),
    "internal participant keys never leak into the response",
  );
});
