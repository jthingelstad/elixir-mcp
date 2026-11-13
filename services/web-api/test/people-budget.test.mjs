/**
 * What the people reads cost the database (2026-11-13): Home's starter
 * set and its People to follow panel, and Find's Suggested, From your
 * battles and clan lists, for a new account in a seeded clan whose rows are a small
 * part of each table (`clan-landing-seed.mjs`), with friendly battles
 * and a 2v2 added. Each read is held to a statement count, every
 * statement's plan to never scanning a large table whole nor reading
 * far more of it than the person's own rows, and no battle read is
 * batched over many players at once. Counts and plan shapes, never
 * milliseconds. Set PEOPLE_BUFFERS=1 to print each read's buffers.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { seedClanLanding } from "./clan-landing-seed.mjs";
import { makeHandler } from "../src/handler.mjs";
import { makeDatabase } from "@elixir-mcp/http/database";

const LARGE = ["battle", "battle_participant", "player"];

/** Statements each read may make, as of this change: a ceiling to come
 *  down, never to rise without a reason in its pull request. */
const BUDGET = {
  "/api/me/people/starter": 11,
  "/api/me/people/suggested": 11,
  "/api/me/people/find": 11,
  "/api/me/people/battles": 8,
  "/api/me/people/clan": 11,
};

// Invented: a friendly opponent and a 2v2 teammate's pair of opponents.
const FRIEND = "#0G2ULUJP";
const FOES = ["#0JCCC08Q", "#0Q2UQ2YR"];

let seed, handler, database;
const sizes = {};
const als = new AsyncLocalStorage();
const original = pg.Client.prototype.query;

before(async () => {
  seed = await seedClanLanding("people_budget", { weeks: 3, others: 4 });
  const { db, leaderTag } = seed;
  // A teammate from the clan (so the 2v2 is known from the roster) and a
  // friendly with someone outside it.
  const {
    rows: [mate],
  } = await db.query(
    `select player_tag from clan_membership
      where clan_tag = $1 and player_tag <> $2 and left_observed_at is null
      order by player_tag limit 1`,
    [seed.clanTag, leaderTag],
  );
  for (const tag of [FRIEND, ...FOES])
    await db.query(
      `insert into player (player_tag, name) values ($1, 'Invented Friend')
       on conflict do nothing`,
      [tag],
    );
  const add = async (id, type, hours, sides) => {
    const at = new Date(Date.now() - hours * 3_600_000);
    await db.query(
      `insert into battle (battle_id, battle_time, type, type_class)
       values ($1, $2, $3, 'pvp')`,
      [id, at, type],
    );
    for (const [side, tags] of sides.entries())
      for (const tag of tags)
        await db.query(
          `insert into battle_participant
             (battle_id, player_tag, side, battle_time, type, type_class, outcome)
           values ($1, $2, $3, $4, $5, 'pvp', $6)`,
          [id, tag, side, at, type, side === 0 ? "win" : "loss"],
        );
  };
  await add("people-budget-friendly", "friendly", 2, [[leaderTag], [FRIEND]]);
  await add("people-budget-2v2", "trail", 3, [
    [leaderTag, mate.player_tag],
    FOES,
  ]);
  await db.query("analyze battle; analyze battle_participant");
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
  handler = makeHandler({ database, secret: "test" });
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

async function call(path) {
  const seen = [];
  const r = await als.run(seen, () =>
    handler({
      path,
      method: "GET",
      headers: { cookie: seed.cookie, "x-elixir-client": "web" },
      queryStringParameters: {},
    }),
  );
  return { status: r.statusCode, body: JSON.parse(r.body), seen };
}

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

async function plans(seen) {
  const out = [];
  for (const s of seen) {
    if (!/^\s*(with|select)\b/i.test(s.text)) continue;
    const r = await seed.db.query(
      `explain (analyze, buffers, format json) ${s.text}`,
      s.values,
    );
    const plan = r.rows[0]["QUERY PLAN"][0].Plan;
    out.push({
      text: s.text.replace(/\s+/g, " ").slice(0, 100),
      scans: scans(plan),
      buffers:
        (plan["Shared Hit Blocks"] ?? 0) + (plan["Shared Read Blocks"] ?? 0),
    });
  }
  return out;
}

test("the people reads stay in their budgets and read the person's battles by range", async (t) => {
  t.mock.method(console, "info", () => {});
  t.mock.method(console, "warn", () => {});
  for (const path of Object.keys(BUDGET)) {
    const r = await call(path);
    assert.equal(r.status, 200, path);
    assert.equal(r.body.ok, true, path);
    assert.ok(
      r.seen.length <= BUDGET[path],
      `${path}: ${r.seen.length} statements, budget ${BUDGET[path]}`,
    );
    // Never one statement over many players' battles: each player's are
    // read by its own index range.
    for (const s of r.seen)
      if (/battle_participant/.test(s.text))
        assert.ok(
          !/player_tag\s*=\s*any\s*\(/i.test(s.text),
          `${path}: a battle read batched over players: ${s.text.slice(0, 120)}`,
        );
    const planned = await plans(r.seen);
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
    if (process.env.PEOPLE_BUFFERS)
      console.log(
        path,
        r.seen.length,
        "statements,",
        planned.reduce((n, p) => n + p.buffers, 0),
        "buffers",
      );
  }
});

test("the seeded starter set puts the friendly and the teammate before the clan's fill", async (t) => {
  t.mock.method(console, "info", () => {});
  const r = await call("/api/me/people/starter");
  assert.equal(r.body.offer, true);
  const tags = r.body.people.map((p) => p.tag);
  assert.ok(tags.includes(FRIEND));
  for (const foe of FOES) assert.ok(!tags.includes(foe), foe);
  // The seeded clan is recorded whole, so every clanmate is free and
  // comes first; the friendly follows them.
  const firstPaid = r.body.people.findIndex((p) => !p.free);
  assert.equal(r.body.people[firstPaid]?.tag, FRIEND);
});

test("Find's Suggested lists the friendly, says why, and leaves out the 2v2's opponents", async (t) => {
  t.mock.method(console, "info", () => {});
  const r = await call("/api/me/people/find");
  assert.equal(r.body.days, 30);
  assert.ok(r.body.people.length <= 30);
  assert.equal(typeof r.body.more, "number");
  const friend = r.body.people.find((p) => p.tag === FRIEND);
  assert.ok(friend, "the friendly opponent is suggested");
  const met = friend.why.find((w) => w.kind === "battles");
  assert.ok(met?.friendly >= 1, "its why says a friendly battle");
  const tags = r.body.people.map((p) => p.tag);
  for (const foe of FOES) assert.ok(!tags.includes(foe), foe);
  // Sources take turns, battles first: the friendly leads.
  assert.equal(tags[0], FRIEND);
});
