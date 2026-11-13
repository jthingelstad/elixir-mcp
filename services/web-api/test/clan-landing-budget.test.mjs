/**
 * What Clan's landing costs the database (2026-11-13), over a seeded clan
 * whose rows are a small part of each table (`clan-landing-seed.mjs`):
 * every read the Feed page makes on load, through the web API's own
 * handler, each held to a statement count, and every statement's plan
 * held to never scanning a large table whole and never reading far
 * more of it than the clan's own rows. Counts and plan shapes, never
 * milliseconds. Invented names and tags, but for King Thing and POAP
 * KINGS.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { buildTimeline } from "@elixir-mcp/tools/activity/entries";
import { seedClanLanding } from "./clan-landing-seed.mjs";
import { makeHandler } from "../src/handler.mjs";
import { createClanRequest } from "../src/clan.mjs";
import { makeDatabase } from "@elixir-mcp/http/database";

/** The tables a clan's page must read by range, never whole. */
const LARGE = [
  "battle",
  "battle_participant",
  "player",
  "player_snapshot_daily",
  "player_daily_battle_rollup",
];

/**
 * The statements each landing read may make, as of this change: a
 * ceiling to come down, never to rise without a reason in its pull
 * request. The Feed page asks for these on load: the clan and who you
 * are in it first, then the rest together.
 */
const BUDGET = {
  "/api/clan/me": 15,
  "/api/clan/roster": 16,
  "/race": 21,
  "/actions": 40,
  "/me": 50,
  "/week": 70,
  "/feed": 30,
  // The other tabs' first reads: Standings, War and Policy. Standings is
  // 13 while the clan's evaluation is cached and 61 when it evaluates.
  "/standing": 61,
  "/season": 54,
  "/policy": 23,
};

let seed, handler, database;
const sizes = {};
const als = new AsyncLocalStorage();
const original = pg.Client.prototype.query;

before(async () => {
  seed = await seedClanLanding("clan_landing_budget", { weeks: 3, others: 4 });
  pg.Client.prototype.query = function (config, values, cb) {
    const seen = als.getStore();
    const text = typeof config === "string" ? config : config?.text;
    if (seen && typeof text === "string")
      seen.push({
        text,
        values: Array.isArray(values) ? values : config?.values,
      });
    return original.call(this, config, values, cb);
  };
  database = makeDatabase({ connectionString: seed.scratch.url });
  handler = makeHandler({
    database,
    secret: "test",
    clan: createClanRequest({ origin: "https://elixir.poapkings.com" }),
  });
  for (const t of LARGE)
    sizes[t] = (
      await seed.db.query(`select count(*)::int as n from ${t}`)
    ).rows[0].n;
});
after(async () => {
  pg.Client.prototype.query = original;
  await database?.close();
  await seed?.scratch.drop();
});

const bare = () => seed.clanTag.slice(1);

/** One request through the handler, with the statements it made. */
async function call(path, query = {}) {
  const seen = [];
  const r = await als.run(seen, () =>
    handler({
      path,
      method: "GET",
      headers: { cookie: seed.cookie },
      queryStringParameters: query,
      rawQueryString: new URLSearchParams(query).toString(),
    }),
  );
  return { status: r.statusCode, seen };
}

/** Every scan in a plan, with the rows it read: what it returned and what
 *  its filter removed, over all its loops. */
function scans(plan) {
  const out = [];
  const walk = (n) => {
    if (n["Relation Name"])
      out.push({
        node: n["Node Type"],
        table: n["Relation Name"],
        index: n["Index Name"] ?? null,
        read:
          ((n["Actual Rows"] ?? 0) + (n["Rows Removed by Filter"] ?? 0)) *
          (n["Actual Loops"] ?? 1),
      });
    for (const c of n.Plans ?? []) walk(c);
  };
  walk(plan);
  return out;
}

/** The plan of every read statement, run as it was run. */
async function plans(seen) {
  const out = [];
  for (const s of seen) {
    if (!/^\s*(with|select)\b/i.test(s.text)) continue;
    const r = await seed.db.query(
      `explain (analyze, format json) ${s.text}`,
      s.values,
    );
    out.push({
      text: s.text.replace(/\s+/g, " ").slice(0, 100),
      scans: scans(r.rows[0]["QUERY PLAN"][0].Plan),
    });
  }
  return out;
}

/** No large table scanned whole, and none read past a quarter of its
 *  rows: the clan's own rows are far fewer (here about a fifth of
 *  battle_participant, in production a few thousandths). */
function assertBounded(path, planned) {
  for (const p of planned)
    for (const s of p.scans) {
      if (!LARGE.includes(s.table)) continue;
      assert.notEqual(
        s.node,
        "Seq Scan",
        `${path}: a whole-table scan of ${s.table}: ${p.text}`,
      );
      assert.ok(
        s.read <= sizes[s.table] / 4,
        `${path}: ${s.read} of ${sizes[s.table]} ${s.table} rows read (${s.index}): ${p.text}`,
      );
    }
}

test("the Feed page's reads stay in their statement budgets and read the clan by range", async (t) => {
  t.mock.method(console, "info", () => {});
  t.mock.method(console, "warn", () => {});
  const base = `/api/clan/clans/${bare()}`;
  const first = await call("/api/clan/me");
  assert.equal(first.status, 200);
  const rest = await Promise.all([
    call("/api/clan/roster", { clan: bare() }),
    call(`${base}/race`),
    call(`${base}/actions`),
    call(`${base}/me`),
    call(`${base}/week`),
    call(`${base}/feed`),
  ]);
  const keys = [
    "/api/clan/roster",
    "/race",
    "/actions",
    "/me",
    "/week",
    "/feed",
  ];
  const all = [["/api/clan/me", first], ...keys.map((k, i) => [k, rest[i]])];
  for (const [key, r] of all) {
    assert.equal(r.status, 200, key);
    assert.ok(
      r.seen.length <= BUDGET[key],
      `${key}: ${r.seen.length} statements, budget ${BUDGET[key]}`,
    );
    assertBounded(key, await plans(r.seen));
  }
});

test("the Feed never walks the week's learned battles for late captures, and its items are the full read's", async (t) => {
  t.mock.method(console, "info", () => {});
  const r = await call(`/api/clan/clans/${bare()}/feed`);
  assert.equal(r.status, 200);
  // The late count is the only statement that reads battle by its
  // created_at range: every battle of every clan learned in the window.
  assert.ok(
    !r.seen.some((s) =>
      /b\.battle_time < b\.created_at - interval '1 day'/.test(s.text),
    ),
    "the Feed read the late-capture count",
  );
  const now = Date.now();
  const read = (lateCounts) =>
    buildTimeline(
      seed.db,
      [{ kind: "clan", tag: seed.clanTag, scope: "comprehensive" }],
      {
        fromMs: now - 7 * 86_400_000,
        toMs: now,
        accountId: seed.accountId,
        interactive: true,
        filter: (it) => it.section !== "account",
        lateCounts,
      },
    );
  const [full, lean] = [await read(true), await read(false)];
  assert.ok(full.timeline.length > 0, "the seeded week has items");
  assert.deepEqual(lean.timeline, full.timeline);
});

test("the other tabs' first reads stay in their budgets and read the clan by range", async (t) => {
  t.mock.method(console, "info", () => {});
  t.mock.method(console, "warn", () => {});
  for (const key of ["/standing", "/season", "/policy"]) {
    const r = await call(`/api/clan/clans/${bare()}${key}`);
    assert.equal(r.status, 200, key);
    assert.ok(
      r.seen.length <= BUDGET[key],
      `${key}: ${r.seen.length} statements, budget ${BUDGET[key]}`,
    );
    assertBounded(key, await plans(r.seen));
  }
});
